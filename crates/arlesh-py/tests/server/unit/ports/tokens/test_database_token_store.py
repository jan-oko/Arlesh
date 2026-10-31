"""Tokens in the database's ``server_tokens`` table."""

from __future__ import annotations

from pathlib import Path

import pytest
from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore
from arlesh.server.ports.tokens.file_token_store import FileTokenStore
from arlesh.server.ports.tokens.token_store import ClientAlreadyHasToken, UnknownClient


@pytest.fixture
def store(server_db: Path) -> DatabaseTokenStore:
    return DatabaseTokenStore(server_db)


def test_a_token_names_the_client_it_was_issued_to(store: DatabaseTokenStore) -> None:
    token = store.add("phone")

    assert store.client_for(token) == "phone"
    assert store.client_for("not-a-token") is None


def test_only_the_digest_is_kept(store: DatabaseTokenStore, server_db: Path) -> None:
    token = store.add("phone")

    assert token.encode() not in server_db.read_bytes()


def test_a_client_holds_one_token_at_a_time(store: DatabaseTokenStore) -> None:
    store.add("phone")

    with pytest.raises(ClientAlreadyHasToken):
        store.add("phone")


def test_a_revoked_token_names_nobody(store: DatabaseTokenStore) -> None:
    token = store.add("phone")

    store.revoke("phone")

    assert store.client_for(token) is None
    assert store.issued() == []


def test_revoking_a_client_without_a_token_is_refused(store: DatabaseTokenStore) -> None:
    with pytest.raises(UnknownClient):
        store.revoke("laptop")


def test_issued_lists_the_clients_by_name(store: DatabaseTokenStore) -> None:
    store.add("phone")
    store.add("laptop")

    assert [issued.client for issued in store.issued()] == ["laptop", "phone"]


def test_carrying_over_keeps_a_client_the_table_already_has(
    store: DatabaseTokenStore, server_db: Path
) -> None:
    old = FileTokenStore.beside(server_db)
    old_phone = old.add("phone")
    old_laptop = old.add("laptop")
    new_phone = store.add("phone")

    moved = store.carry_over(old)

    assert moved == ["laptop"]
    assert store.client_for(old_laptop) == "laptop"
    assert store.client_for(new_phone) == "phone"
    assert store.client_for(old_phone) is None
    assert store.carry_over(old) == []
