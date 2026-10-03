"""Tokens in a JSON file beside the database (``<db>.tokens``), stored hashed."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import tempfile
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel

from arlesh.server.ports.tokens.token_store import (
    ClientAlreadyHasToken,
    IssuedToken,
    TokenStore,
    UnknownClient,
)


class _Entry(BaseModel):
    sha256: str
    created: datetime


class _File(BaseModel):
    clients: dict[str, _Entry] = {}


def _hash(token: str) -> str:
    # A token is 256 random bits, so a plain digest is enough: there is nothing to brute-force.
    return hashlib.sha256(token.encode()).hexdigest()


class FileTokenStore(TokenStore):
    """The token store as one file, readable and writable by its owner only. It is read on every
    lookup, so a token revoked from the command line stops working without a restart."""

    def __init__(self, path: Path) -> None:
        self._path = path

    @classmethod
    def beside(cls, database: Path) -> FileTokenStore:
        """The store for the database at ``database``: ``<database>.tokens``."""
        return cls(database.with_name(database.name + ".tokens"))

    def add(self, client: str) -> str:
        stored = self._read()
        if client in stored.clients:
            raise ClientAlreadyHasToken(client)
        token = secrets.token_urlsafe(32)
        stored.clients[client] = _Entry(sha256=_hash(token), created=datetime.now())
        self._write(stored)
        return token

    def revoke(self, client: str) -> None:
        stored = self._read()
        if client not in stored.clients:
            raise UnknownClient(client)
        del stored.clients[client]
        self._write(stored)

    def issued(self) -> list[IssuedToken]:
        return [
            IssuedToken(client=client, created=entry.created)
            for client, entry in sorted(self._read().clients.items())
        ]

    def client_for(self, token: str) -> str | None:
        digest = _hash(token)
        for client, entry in self._read().clients.items():
            if secrets.compare_digest(entry.sha256, digest):
                return client
        return None

    def _read(self) -> _File:
        if not self._path.exists():
            return _File()
        return _File.model_validate_json(self._path.read_text())

    def _write(self, stored: _File) -> None:
        handle, scratch = tempfile.mkstemp(dir=self._path.parent, prefix=self._path.name)
        with os.fdopen(handle, "w") as file:
            file.write(json.dumps(stored.model_dump(mode="json"), indent=2))
        os.chmod(scratch, 0o600)
        os.replace(scratch, self._path)
