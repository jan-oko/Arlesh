"""The server's lifespan: the startup guard opens the database; shutdown closes it."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from fastapi import FastAPI
from loguru import logger

from arlesh import ArleshError
from arlesh.server.business_logic.board import Board


def lifespan(
    board: Board, closers: Sequence[Callable[[], Awaitable[None]]] = ()
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Opens the ``board`` for writing as the server starts — refused while the desktop app holds
    the database, unless forced — and, as it stops, runs ``closers`` and closes it (which stops
    every MCP endpoint they serve)."""

    @asynccontextmanager
    async def run(app: FastAPI) -> AsyncIterator[None]:
        try:
            await board.open()
        except ArleshError as refusal:
            logger.critical("Refusing to start", reason=refusal.message, details=refusal.details)
            raise
        logger.info("Started up", title=app.title, version=app.version)
        try:
            yield
        finally:
            for close in closers:
                await close()
            await board.close()
            logger.info("Shut down")

    return run
