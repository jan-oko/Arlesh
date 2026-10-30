"""Tokens in the database itself: the ``server_tokens`` table (migration 0097), stored hashed.

The calls go through the ``arlesh`` bindings, so the table is read with the same SQLite library
the server's other opens use (see ``crates/arlesh-py/src/tokens.rs`` for why a second copy, such
as Python's ``sqlite3``, must not touch the file). It is read on every lookup, so a token revoked
from the command line stops working at once, without a restart.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any

from arlesh import _native
from arlesh.errors import from_native
from arlesh.server.ports.tokens.file_token_store import FileTokenStore
from arlesh.server.ports.tokens.token_store import (
    ClientAlreadyHasToken,
    IssuedToken,
    TokenStore,
    UnknownClient,
)


def _hash(token: str) -> str:
    # A token is 256 random bits, so a plain digest is enough: there is nothing to brute-force.
    return hashlib.sha256(token.encode()).hexdigest()


class DatabaseTokenStore(TokenStore):
    """The token store as the ``server_tokens`` table of the database at ``path``. The first call
    opens the database for writing (migrating it if it is behind), past the hold: it is the
    server's own."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def add(self, client: str) -> str:
        token = secrets.token_urlsafe(32)
        if not self._record(client, _hash(token), datetime.now()):
            raise ClientAlreadyHasToken(client)
        return token

    def revoke(self, client: str) -> None:
        if not self._call("revoke", client=client):
            raise UnknownClient(client)

    def issued(self) -> list[IssuedToken]:
        return [
            IssuedToken(client=entry["client"], created=datetime.fromisoformat(entry["created_at"]))
            for entry in self._call("issued")
        ]

    def client_for(self, token: str) -> str | None:
        client = self._call("client_for", sha256=_hash(token))
        return str(client) if client is not None else None

    def carry_over(self, old: FileTokenStore) -> list[str]:
        """Moves the tokens of an old ``<db>.tokens`` file into the table, and answers the clients
        it moved. A client the table already has keeps its token there. The file is renamed to
        ``<db>.tokens.imported`` afterwards, so it is read only once and a token revoked later
        cannot come back from it."""
        if not old.path.exists():
            return []
        moved = [
            client
            for client, digest, created in old.digests()
            if self._record(client, digest, created)
        ]
        old.path.rename(old.path.with_name(old.path.name + ".imported"))
        return moved

    def _record(self, client: str, digest: str, created: datetime) -> bool:
        return bool(self._call("add", client=client, sha256=digest, created_at=created.isoformat()))

    def _call(self, op: str, **arguments: Any) -> Any:
        try:
            raw = _native.token_call(self._path, json.dumps({"op": op, **arguments}))
        except _native.NativeError as error:
            raise from_native(error) from None
        return json.loads(raw)
