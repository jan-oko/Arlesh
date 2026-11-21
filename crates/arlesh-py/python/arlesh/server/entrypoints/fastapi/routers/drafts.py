"""Staged answers (ADR 0021): sending the batch. Saving and clearing a draft are on ``/waits``."""

from __future__ import annotations

from arlesh.models import SendOutcome, SendRequest
from arlesh.server.entrypoints.fastapi.routers.base import BoardRouter


class DraftsRouter(BoardRouter):
    """``/drafts``."""

    def _register_routes(self) -> None:
        self.post("/send")(self._send)

    async def _send(self, request: SendRequest) -> SendOutcome:
        """Sends every staged answer on the board, releasing the waits in one write. Answers which
        were sent and which skipped, and why."""
        return await (await self._writer()).send_answer_drafts(request)
