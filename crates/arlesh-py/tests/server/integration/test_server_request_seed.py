"""``X-Arlesh-Request-Id``: a write that carries a seed mints the ids of the rows it creates from
it, so a client that predicted the write under the same seed holds the same ids."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

from arlesh.server.ports.tokens.database_token_store import DatabaseTokenStore
from fastapi.testclient import TestClient

from arlesh.server.entrypoints.fastapi.app import ArleshServer

ROOT_ASPECT = "4440ccd1-f5c6-5057-898c-f89df62d6f60"
Start = Callable[..., ArleshServer]
SEED_HEADER = "X-Arlesh-Request-Id"


def _copy_of_a_domain_with_a_task(
    start: Start, migrated: Path, directory: Path, name: str, headers: dict[str, str]
) -> str:
    """The id of the copy a duplicate makes on a fresh server of its own."""
    path = directory / name
    shutil.copyfile(migrated, path)
    token = DatabaseTokenStore(path).add("tests")
    with TestClient(start(path=path), headers={"Authorization": f"Bearer {token}"}) as client:
        domain = client.post(
            "/domains", json={"title": "Home", "subtype": "domain", "parent_id": ROOT_ASPECT}
        ).json()["id"]
        client.post(
            "/tasks", json={"title": "Inside", "parent_type": "domain", "parent_id": domain}
        )
        duplicated = client.post(
            f"/domains/{domain}/duplicate",
            params={"target_id": ROOT_ASPECT, "position": 9},
            headers=headers,
        )
        assert duplicated.status_code == 201, duplicated.text
        copy: str = duplicated.json()["copy"]["id"]
        return copy


def test_two_servers_given_the_same_seed_mint_the_same_ids(
    start: Start, migrated: Path, tmp_path: Path
) -> None:
    headers = {SEED_HEADER: str(uuid4())}

    first = _copy_of_a_domain_with_a_task(start, migrated, tmp_path, "first.db", headers)
    second = _copy_of_a_domain_with_a_task(start, migrated, tmp_path, "second.db", headers)

    assert first == second


def test_without_a_seed_or_with_one_that_is_not_a_uuid_ids_are_random(
    start: Start, migrated: Path, tmp_path: Path
) -> None:
    for header in ({}, {SEED_HEADER: "not-a-uuid"}):
        first = _copy_of_a_domain_with_a_task(start, migrated, tmp_path, "first.db", header)
        second = _copy_of_a_domain_with_a_task(start, migrated, tmp_path, "second.db", header)

        assert first != second
        (tmp_path / "first.db").unlink()
        (tmp_path / "second.db").unlink()
