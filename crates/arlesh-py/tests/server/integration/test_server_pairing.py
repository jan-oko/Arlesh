"""Pairing over HTTP: a device with no token asks for a PIN, a signed-in device approves it, and
the device's poll receives its own token, once. Then the Devices routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from arlesh.server.business_logic.pairing import MAX_WRONG_ATTEMPTS
from arlesh.server.entrypoints.fastapi.routers.pair import PAIRS_PER_WINDOW
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore
from fastapi.testclient import TestClient

Pair = Callable[..., dict[str, Any]]


@pytest.fixture
def anonymous(server: TestClient) -> TestClient:
    """A device with no token, reaching the same server."""
    return TestClient(server.app)


@pytest.fixture
def pair(anonymous: TestClient) -> Pair:
    def start(name: str | None = "pixel") -> dict[str, Any]:
        response = anonymous.post("/pair", json={"name": name})
        assert response.status_code == 201, response.text
        started: dict[str, Any] = response.json()
        return started

    return start


def poll(client: TestClient, started: dict[str, Any], pin: str | None = None) -> Any:
    return client.post("/pair/poll", json={"id": started["id"], "pin": pin or started["pin"]})


def test_pair_needs_no_token_but_everything_else_still_does(anonymous: TestClient) -> None:
    assert anonymous.post("/pair", json={}).status_code == 201
    assert anonymous.get("/devices").status_code == 401
    assert anonymous.get("/pairings/123456").status_code == 401
    assert anonymous.get("/board").status_code == 401


def test_a_device_pairs_end_to_end(
    server: TestClient, anonymous: TestClient, pair: Pair, tokens: DatabaseTokenStore
) -> None:
    started = pair("Pixel 8")
    assert len(started["pin"]) == 6
    assert started["name"] == "Pixel-8"
    assert poll(anonymous, started).json() == {"status": "pending"}

    waiting = server.get(f"/pairings/{started['pin']}")
    assert waiting.json()["name"] == "Pixel-8"
    approved = server.post(f"/pairings/{started['pin']}/approve", json={"name": "jans-pixel"})
    assert approved.json() == {"name": "jans-pixel"}

    polled = poll(anonymous, started).json()
    assert polled["status"] == "approved"
    assert polled["name"] == "jans-pixel"
    assert tokens.client_for(polled["token"]) == "jans-pixel"
    reached = anonymous.get("/health", headers={"Authorization": f"Bearer {polled['token']}"})
    assert reached.status_code == 200


def test_the_token_is_given_once(server: TestClient, anonymous: TestClient, pair: Pair) -> None:
    started = pair()
    server.post(f"/pairings/{started['pin']}/approve", json={})
    assert poll(anonymous, started).json()["token"]

    again = poll(anonymous, started)

    assert again.status_code == 404
    assert again.json()["details"]["reason"] == "unknown_pairing"
    assert server.get(f"/pairings/{started['pin']}").status_code == 404


def test_the_suggested_name_is_used_when_the_approver_gives_none(
    server: TestClient, anonymous: TestClient, pair: Pair
) -> None:
    started = pair("tablet")

    assert server.post(f"/pairings/{started['pin']}/approve").json() == {"name": "tablet"}
    assert poll(anonymous, started).json()["name"] == "tablet"


def test_a_name_in_use_gets_a_suffix(server: TestClient, anonymous: TestClient, pair: Pair) -> None:
    first, second = pair("tests"), pair("tests")

    assert server.post(f"/pairings/{first['pin']}/approve").json() == {"name": "tests-2"}
    assert server.post(f"/pairings/{second['pin']}/approve").json() == {"name": "tests-3"}
    assert poll(anonymous, second).json()["name"] == "tests-3"


def test_an_unknown_pin_cannot_be_approved(server: TestClient) -> None:
    refused = server.post("/pairings/999999/approve", json={})

    assert refused.status_code == 404
    assert refused.json()["details"]["reason"] == "unknown_pin"


def test_five_wrong_pins_invalidate_the_request(
    server: TestClient, anonymous: TestClient, pair: Pair
) -> None:
    started = pair()
    wrong = "000000" if started["pin"] != "000000" else "111111"

    for left in range(MAX_WRONG_ATTEMPTS - 1, 0, -1):
        refused = poll(anonymous, started, wrong)
        assert refused.status_code == 403
        assert refused.json()["details"] == {"reason": "wrong_pin", "remaining": left}
    last = poll(anonymous, started, wrong)
    assert last.json()["details"]["reason"] == "pin_invalidated"

    assert poll(anonymous, started).status_code == 404
    assert server.post(f"/pairings/{started['pin']}/approve", json={}).status_code == 404


def test_pair_is_rate_limited_per_address(anonymous: TestClient) -> None:
    for _ in range(PAIRS_PER_WINDOW):
        assert anonymous.post("/pair", json={}).status_code == 201

    limited = anonymous.post("/pair", json={})

    assert limited.status_code == 429
    assert limited.json()["details"]["reason"] == "rate_limited"
    assert int(limited.headers["Retry-After"]) > 0


def test_devices_are_listed_with_the_current_one_marked(
    server: TestClient, tokens: DatabaseTokenStore
) -> None:
    tokens.add("phone")

    devices = {d["name"]: d for d in server.get("/devices").json()}

    assert devices["tests"]["current"] is True
    assert devices["phone"]["current"] is False
    assert devices["tests"]["last_seen_at"] is not None
    assert "last_seen_at" not in devices["phone"]


def test_a_device_is_revoked_and_its_token_stops_working(
    server: TestClient, tokens: DatabaseTokenStore
) -> None:
    token = tokens.add("phone")

    assert server.delete("/devices/phone").status_code == 204

    refused = server.get("/health", headers={"Authorization": f"Bearer {token}"})
    assert refused.status_code == 401
    assert "phone" not in {d["name"] for d in server.get("/devices").json()}


def test_the_asking_device_cannot_be_revoked(server: TestClient) -> None:
    refused = server.delete("/devices/tests")

    assert refused.status_code == 403
    assert refused.json()["details"]["reason"] == "current_device"
    assert server.get("/health").status_code == 200


def test_revoking_an_unknown_device_is_404(server: TestClient) -> None:
    refused = server.delete("/devices/ghost")

    assert refused.status_code == 404
    assert refused.json()["details"]["reason"] == "unknown_device"
