"""Pairing requests in the database's ``pairing_pins`` table."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
from arlesh.server.ports.pairing.database_pairing_store import DatabasePairingStore
from arlesh.server.ports.pairing.pairing_store import PairingRequest

NOW = datetime(2026, 11, 1, 10, 0, 0)


@pytest.fixture
def store(server_db: Path) -> DatabasePairingStore:
    return DatabasePairingStore(server_db)


def request(pin: str, expires: datetime = datetime(2026, 11, 1, 10, 10, 0)) -> PairingRequest:
    return PairingRequest(id_sha256=f"id-{pin}", pin=pin, name="phone", created=NOW, expires=expires)


def test_a_request_is_stored_and_read_back(store: DatabasePairingStore) -> None:
    assert store.create(request("123456"))

    assert store.all() == [request("123456")]


def test_a_pin_in_use_is_refused(store: DatabasePairingStore) -> None:
    store.create(request("123456"))

    assert not store.create(PairingRequest(**{**request("123456").model_dump(), "id_sha256": "x"}))


def test_approving_names_the_request_once(store: DatabasePairingStore) -> None:
    store.create(request("123456"))

    assert store.approve("123456", "pixel")
    assert not store.approve("123456", "other")
    assert store.all()[0].approved_name == "pixel"


def test_attempts_are_counted_per_request(store: DatabasePairingStore) -> None:
    store.create(request("123456"))

    assert [store.count_attempt("id-123456"), store.count_attempt("id-123456")] == [1, 2]
    assert store.count_attempt("nobody") is None


def test_only_lapsed_requests_are_purged(store: DatabasePairingStore) -> None:
    store.create(request("111111", datetime(2026, 11, 1, 10, 5, 0)))
    store.create(request("222222"))

    assert store.purge_expired(datetime(2026, 11, 1, 10, 5, 0)) == 1
    assert [r.pin for r in store.all()] == ["222222"]


def test_a_deleted_request_is_gone(store: DatabasePairingStore) -> None:
    store.create(request("123456"))

    assert store.delete("id-123456")
    assert not store.delete("id-123456")
    assert store.all() == []
