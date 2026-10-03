"""The file token store: one hashed token per client, beside the database."""

from __future__ import annotations

import stat
from pathlib import Path

import pytest
from arlesh.server.ports.tokens.file_token_store import FileTokenStore
from arlesh.server.ports.tokens.token_store import ClientAlreadyHasToken, UnknownClient


@pytest.fixture
def store(tmp_path: Path) -> FileTokenStore:
    return FileTokenStore.beside(tmp_path / "arlesh.db")


def test_it_lives_beside_the_database(tmp_path: Path, store: FileTokenStore) -> None:
    store.add("phone")

    assert (tmp_path / "arlesh.db.tokens").exists()


def test_an_added_token_names_its_client(store: FileTokenStore) -> None:
    token = store.add("phone")

    assert store.client_for(token) == "phone"


def test_a_token_nobody_holds_names_nobody(store: FileTokenStore) -> None:
    store.add("phone")

    assert store.client_for("forged") is None


def test_an_empty_store_names_nobody_and_lists_nothing(store: FileTokenStore) -> None:
    assert store.client_for("anything") is None
    assert store.issued() == []


def test_the_token_is_kept_hashed_and_the_file_is_the_owners_alone(
    tmp_path: Path, store: FileTokenStore
) -> None:
    token = store.add("phone")
    path = tmp_path / "arlesh.db.tokens"

    assert token not in path.read_text()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_each_client_gets_its_own_token(store: FileTokenStore) -> None:
    phone, laptop = store.add("phone"), store.add("laptop")

    assert phone != laptop
    assert (store.client_for(phone), store.client_for(laptop)) == ("phone", "laptop")
    assert [issued.client for issued in store.issued()] == ["laptop", "phone"]


def test_a_second_token_for_one_client_is_refused(store: FileTokenStore) -> None:
    store.add("phone")

    with pytest.raises(ClientAlreadyHasToken):
        store.add("phone")


def test_a_revoked_token_names_nobody(store: FileTokenStore) -> None:
    token = store.add("phone")

    store.revoke("phone")

    assert store.client_for(token) is None
    assert store.issued() == []


def test_revoking_a_client_without_a_token_is_refused(store: FileTokenStore) -> None:
    with pytest.raises(UnknownClient):
        store.revoke("phone")
