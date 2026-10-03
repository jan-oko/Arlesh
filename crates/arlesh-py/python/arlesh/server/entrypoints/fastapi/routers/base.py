"""What every board router shares: the databases, and the client the request's token names."""

from __future__ import annotations

from contextvars import ContextVar

from fastapi import APIRouter

import arlesh
from arlesh.server.entrypoints.fastapi.exception_handling.exception_handlers import (
    ERROR_RESPONSES,
)
from arlesh.server.ports.board.databases import Databases


def node_id(raw: str) -> arlesh.NodeId:
    """A path's node id as the core reads it: a stored row's integer id, or a derived node's
    (a Habit occurrence's) UUID."""
    return int(raw) if raw.isdecimal() else raw


class BoardRouter(APIRouter):
    """A router whose routes are each one call on the ``arlesh`` bindings."""

    def __init__(self, databases: Databases, client_context: ContextVar[str], tag: str) -> None:
        super().__init__(tags=[tag], responses=ERROR_RESPONSES)
        self._databases = databases
        self._client_context = client_context
        self._register_routes()

    def _register_routes(self) -> None:
        raise NotImplementedError

    @property
    def _reader(self) -> arlesh.Database:
        return self._databases.reader

    async def _writer(self) -> arlesh.Database:
        """The database open for writing as the client the request's token names."""
        return await self._databases.writer(self._client_context.get())
