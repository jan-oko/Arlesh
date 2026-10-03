"""The board, the scope and lifecycle rules — answering what the Rust tests assert — and the
OpenAPI schema they publish."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from typing import Any

import arlesh
from fastapi.testclient import TestClient


def test_the_board_is_every_node_in_one_request_with_its_lifecycle(
    server: TestClient,
    domain: int,
    new_task: Callable[..., int],
    one_day: Callable[[str], dict[str, Any]],
) -> None:
    identifier = new_task(domain, time_scope=one_day("2026-06-10"))

    board = server.get("/board", params={"now": "2026-06-10T12:00:00"}).json()

    assert identifier in [node["id"] for node in board["tasks"]]
    assert domain in [node["id"] for node in board["domains"]]
    lifecycle = next(
        entry
        for entry in board["lifecycles"]
        if entry["node_type"] == "task" and entry["node_id"] == identifier
    )
    assert lifecycle["timing"] == "active"


def test_a_resolved_week_is_its_sunday_02_00_to_the_next(server: TestClient) -> None:
    # scopes/resolve/tests.rs: canonical_week_ends_at_02_after_its_last_day, and
    # an_instant_after_midnight_still_belongs_to_the_previous_day.
    response = server.post(
        "/scopes/resolve",
        params={"now": "2026-06-21T01:30:00"},
        json={"kind": "week", "date": "2026-06-14"},
    )

    assert response.json() == {
        "start": "2026-06-14T02:00:00",
        "end": "2026-06-21T02:00:00",
        "active": True,
    }


def test_a_january_day_is_in_the_winter_that_began_in_december(server: TestClient) -> None:
    # scopes/rules/derive/tests.rs: bounds_season_winter_january_traces_to_december.
    response = server.get("/scopes/containing", params={"kind": "season", "date": "2027-01-15"})

    assert (response.json()["start_date"], response.json()["end_date"]) == (
        "2026-12-01",
        "2027-02-28",
    )


def test_a_backlogged_task_lapsing_under_archive_is_missed_with_a_conflict(
    server: TestClient,
) -> None:
    # tasks/rules/lifecycle/tests.rs:
    # a_scoped_backlogged_task_that_lapses_unfinished_archives_as_missed_with_a_conflict.
    response = server.post(
        "/rules/item-state",
        json={
            "window": ["2026-01-05T00:00:00", "2026-01-12T00:00:00"],
            "on_exit": "archive",
            "resolved": False,
            "stored": "backlog",
            "now": "2026-01-20T00:00:00",
        },
    )

    state = response.json()
    assert (state["resolution"], state["archival"], state["archival_conflict"]) == (
        "missed",
        "archived",
        True,
    )


def test_an_unscoped_backlogged_task_is_never_forced_into_anything(server: TestClient) -> None:
    # tasks/rules/lifecycle/tests.rs: an_unscoped_backlogged_task_is_never_forced_into_anything.
    response = server.post(
        "/rules/item-state", json={"stored": "backlog", "now": "2030-01-01T00:00:00"}
    )

    assert response.json()["archival"] == "backlog"
    assert response.json()["archival_conflict"] is False


def test_a_commitments_state_is_the_bindings_answer(server: TestClient) -> None:
    window = ("2026-01-05T00:00:00", "2026-01-12T00:00:00")
    response = server.post(
        "/rules/commitment-state",
        json={"window": window, "verdict": "kept", "now": "2026-01-20T00:00:00"},
    )

    expected = arlesh.rules.derive_commitment_state(
        (datetime.fromisoformat(window[0]), datetime.fromisoformat(window[1])),
        arlesh.models.Verdict.kept,
        None,
        datetime.fromisoformat("2026-01-20T00:00:00"),
    )
    assert response.status_code == 200, response.text
    assert response.json() == expected.model_dump(mode="json")


def test_the_openapi_schema_takes_its_models_from_the_core(server: TestClient) -> None:
    published = server.get("/openapi.json").json()["components"]["schemas"]
    core = json.loads(arlesh.json_schema())["$defs"]

    for name in ("Task", "CreateTaskRequest", "UpdateTaskRequest", "MindmapLoad"):
        assert set(published[name]["properties"]) == set(core[name]["properties"]), name
    assert published["ErrorBody"]["properties"]["kind"]["$ref"].endswith("WireErrorKind")
