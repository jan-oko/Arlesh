"""The server's lifespan: the startup guard opens the database; shutdown closes it."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from fastapi import FastAPI
from loguru import logger

from arlesh import ArleshError
from arlesh.server.ports.board.databases import Databases


def lifespan(databases: Databases) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Opens ``databases`` for writing as the server starts — refused while the desktop app holds
    the database, unless forced — and closes them as it stops."""

    @asynccontextmanager
    async def run(app: FastAPI) -> AsyncIterator[None]:
        try:
            await databases.open()
        except ArleshError as refusal:
            logger.critical("Refusing to start", reason=refusal.message, details=refusal.details)
            raise
        logger.info("Started up", title=app.title, version=app.version)
        try:
            yield
        finally:
            await databases.close()
            logger.info("Shut down")

    return run
