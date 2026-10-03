"""The application: the startup guard, the routes and the error answers."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import arlesh
from fastapi import FastAPI

from arlesh_api import errors
from arlesh_api.connections import Connections
from arlesh_api.routes import (
    board,
    commitments,
    domains,
    flows,
    goals,
    infos,
    nodes,
    scopes,
    tasks,
    waits,
)
from arlesh_api.settings import Settings

log = logging.getLogger(__name__)

DESCRIPTION = """\
Arlesh's board over HTTP, run by Arlesh's own Rust core through the `arlesh` bindings.

* **Reads** need nothing. **Writes** name their client in the `X-Arlesh-Client` header; one
  without it is refused 400.
* **Every error** carries the core's `kind` in its body. Branch on it, not on the status.
* **422** means *send it again with more*: `needs_confirmation` (add `?confirmed=true`, or for
  cycles a `reconcile`) or `needs_time_scope` (add a `time_scope`).
* An update's field left out is unchanged; `null` clears it.
* Local only: it listens on 127.0.0.1, with no auth and no TLS.
"""


def create_app(settings: Settings) -> FastAPI:
    """The service over the database ``settings`` names.

    Starting it write-opens the database — refused while the desktop app holds it, unless
    ``settings.force`` — so a service that is up is one that may write.
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        try:
            connections = await Connections.open(settings)
        except arlesh.ArleshError as refusal:
            log.critical("refusing to start: %s", refusal.message)
            raise
        app.state.connections = connections
        try:
            yield
        finally:
            await connections.close()

    app = FastAPI(title="Arlesh", description=DESCRIPTION, version="0.1.0", lifespan=lifespan)
    errors.install(app)
    for router in (
        board.router,
        tasks.router,
        goals.router,
        commitments.router,
        waits.router,
        infos.router,
        domains.router,
        flows.router,
        flows.items,
        nodes.router,
        scopes.router,
        scopes.derive,
    ):
        app.include_router(router)
    return app
