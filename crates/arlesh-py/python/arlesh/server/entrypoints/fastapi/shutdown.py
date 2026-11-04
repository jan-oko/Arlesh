"""Telling long-lived streams that the server is going down.

uvicorn closes its listener on SIGTERM and then waits for every open request to finish. A
Server-Sent Events stream never does, so it has to be told to end itself.
"""

from __future__ import annotations

import uvicorn

GRACEFUL_SHUTDOWN_SECONDS = 5
"""How long uvicorn waits for open requests after SIGTERM before it cancels them."""

_going_down = False


def going_down() -> bool:
    """Whether the server has begun shutting down."""
    return _going_down


class GracefulServer(uvicorn.Server):
    """A uvicorn server that raises the ``going_down`` flag as soon as it stops listening."""

    async def shutdown(self, sockets: list[object] | None = None) -> None:  # type: ignore[override]
        global _going_down
        _going_down = True
        await super().shutdown(sockets)  # type: ignore[arg-type]
