"""What every board router shares: the board, and the client the request's token names."""

from __future__ import annotations

from contextvars import ContextVar

from typing import Any

from fastapi import APIRouter
from fastapi.routing import APIRoute

import arlesh
from arlesh.server.business_logic.board import Board
from arlesh.server.entrypoints.fastapi.exception_handling.exception_handlers import (
    ERROR_RESPONSES,
)


def node_id(raw: str) -> arlesh.NodeId:
    """A path's node id as the core reads it: a stored row's integer id, or a derived node's
    (a Habit occurrence's) UUID."""
    return int(raw) if raw.isdecimal() else raw


class WireRoute(APIRoute):
    """A route that answers as the core writes: a value that is absent is left out of the JSON.

    The core reads a missing field as its default, but ``null`` for a ``bool`` or a ``Vec`` as a
    failure; the generated models spell an absent value ``None``, and a real database has plenty.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["response_model_exclude_none"] = True
        super().__init__(*args, **kwargs)


class BoardRouter(APIRouter):
    """A router whose routes are each one call on the ``arlesh`` bindings."""

    def __init__(self, board: Board, client_context: ContextVar[str], tag: str) -> None:
        super().__init__(tags=[tag], responses=ERROR_RESPONSES, route_class=WireRoute)
        self._board = board
        self._client_context = client_context
        self._register_routes()

    def _register_routes(self) -> None:
        raise NotImplementedError

    @property
    def _reader(self) -> arlesh.Database:
        return self._board.reader

    async def _writer(self) -> arlesh.Database:
        """The database open for writing as the client the request's token names."""
        return await self._board.writer(self._client_context.get())
