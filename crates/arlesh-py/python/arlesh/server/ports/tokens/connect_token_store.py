"""The server's connect token: the one low-privilege token every MCP session connects with.

It admits a session to ``/mcp`` and lets it call the attach tool, and nothing else; an agent then
attaches with a one-time PIN and sees only its Claim. It is kept as a digest in the database
(``connect_tokens``, migration 0101), through the same synchronous native calls as the device
tokens, and is read on every lookup so a token replaced from the command line stops working at
once. The rules (digesting, replacing) are the core's.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from arlesh import _native
from arlesh.errors import from_native

_TIME = "%Y-%m-%dT%H:%M:%S"


class ConnectTokenInfo(BaseModel):
    """When the connect token was issued and last used."""

    created: datetime
    last_used: datetime | None = None


class ConnectTokens:
    """The connect token of the database at ``path``."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def issue(self) -> str:
        """Issues a new connect token, replacing the old one, and answers it. Shown this once."""
        return str(self._call("connect_issue", now=_now()))

    def revoke(self) -> bool:
        """Removes the connect token; no session can connect until a new one is issued. Answers
        whether there was one."""
        return bool(self._call("connect_revoke"))

    def info(self) -> ConnectTokenInfo | None:
        """When it was issued and last used, or ``None`` if there is none."""
        found = self._call("connect_info")
        if not found:
            return None
        created, last_used = found
        return ConnectTokenInfo(
            created=datetime.fromisoformat(created),
            last_used=datetime.fromisoformat(last_used) if last_used else None,
        )

    def is_valid(self, token: str) -> bool:
        """Whether ``token`` is the connect token. A use is recorded."""
        return bool(self._call("connect_check", token=token, now=_now()))

    def agent_known(self, token: str) -> bool:
        """Whether ``token`` is the token of an agent that still exists."""
        return bool(self._call("agent_token_known", token=token))

    def _call(self, op: str, **arguments: Any) -> Any:
        try:
            raw = _native.token_call(self._path, json.dumps({"op": op, **arguments}))
        except _native.NativeError as error:
            raise from_native(error) from None
        return json.loads(raw)


def _now() -> str:
    return datetime.now().strftime(_TIME)
