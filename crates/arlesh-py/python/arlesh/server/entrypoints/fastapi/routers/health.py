"""``/health``: whether the server is up, and which API it speaks — the app's version handshake."""

from __future__ import annotations

import os

from fastapi import APIRouter
from pydantic import BaseModel

API_VERSION = 1
"""The HTTP API's version: an integer bumped **only** on a breaking change. The app refuses to
write to a server whose ``api_version`` differs from its own, and says which side to update.
Pinned to the app's by ``conformance/client-mode.json``."""

COMMIT_VARIABLE = "ARLESH_COMMIT"
"""The environment variable a build sets to the commit it was built from."""


class Health(BaseModel):
    """What ``GET /health`` answers."""

    api_version: int
    """The API's version; see :data:`API_VERSION`."""
    version: str
    """The ``arlesh`` package's version."""
    commit: str
    """The commit the server was built from, or ``unknown``."""


class HealthRouter(APIRouter):
    """``/health``. Behind the token like every other route, so a client checking it checks its
    token at the same time."""

    def __init__(self, version: str) -> None:
        super().__init__(tags=["health"])
        self._health = Health(
            api_version=API_VERSION,
            version=version,
            commit=os.environ.get(COMMIT_VARIABLE, "unknown"),
        )
        self.get("")(self._get)

    async def _get(self) -> Health:
        """The server is up: its API version, package version and build commit."""
        return self._health
