"""Fixtures for the server's unit tests: fakes of the ``arlesh`` package's
:class:`arlesh.Database` port."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from unittest.mock import AsyncMock, create_autospec

import arlesh
import pytest
from arlesh.server.business_logic.board import OpenAs


def fake_database(client: str, mcp_port: int = 5000) -> Any:
    """A fake open database: every operation of the port, recorded; ``serve_mcp`` answers
    ``mcp_port``."""
    database = create_autospec(arlesh.Database, instance=True)
    database.client = client
    database.serve_mcp = AsyncMock(return_value=mcp_port)
    return database


class FakeOpener:
    """Opens fake databases, one per call, and records each call's client."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.opened: list[Any] = []

    async def __call__(self, client: str) -> arlesh.Database:
        self.calls.append(client)
        database = fake_database(client, mcp_port=5000 + len(self.opened))
        self.opened.append(database)
        opened: arlesh.Database = database
        return opened


@pytest.fixture
def refusing() -> Callable[[arlesh.ArleshError], OpenAs]:
    """Makes an opener that refuses every open with the error given."""

    def make(error: arlesh.ArleshError) -> OpenAs:
        async def open_as(_client: str) -> arlesh.Database:
            raise error

        return open_as

    return make


@pytest.fixture
def fake_opener() -> FakeOpener:
    """An opener of fake databases."""
    return FakeOpener()


class FakeHolds:
    """Takes fake holds, recording each; refuses with ``refusal`` when one is set."""

    def __init__(self) -> None:
        self.taken: list[Any] = []
        self.refusal: arlesh.ArleshError | None = None

    def __call__(self) -> arlesh.Hold:
        if self.refusal is not None:
            raise self.refusal
        hold = create_autospec(arlesh.Hold, instance=True)
        self.taken.append(hold)
        taken: arlesh.Hold = hold
        return taken


@pytest.fixture
def fake_holds() -> FakeHolds:
    """A taker of fake holds."""
    return FakeHolds()
