"""The server's lifespan: the startup guard opens the database; shutdown closes it."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from fastapi import FastAPI
from loguru import logger

from arlesh import ArleshError
from arlesh.server.business_logic.board import Board
from arlesh.server.business_logic.notifier import Notifier


def lifespan(
    board: Board,
    closers: Sequence[Callable[[], Awaitable[None]]] = (),
    notifier: Notifier | None = None,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Opens the ``board`` for writing as the server starts — refused while the desktop app holds
    the database, unless forced — starts the ``notifier`` once it is open, and, as it stops, stops
    it, runs ``closers`` and closes the board (which stops every MCP endpoint it serves)."""

    @asynccontextmanager
    async def run(app: FastAPI) -> AsyncIterator[None]:
        try:
            await board.open()
        except ArleshError as refusal:
            logger.critical("Refusing to start", reason=refusal.message, details=refusal.details)
            raise
        if notifier is not None:
            notifier.start()
        logger.info("Started up", title=app.title, version=app.version)
        try:
            yield
        finally:
            if notifier is not None:
                await notifier.stop()
            for close in closers:
                await close()
            await board.close()
            logger.info("Shut down")

    return run
