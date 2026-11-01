"""Pairing requests in the database itself: the ``pairing_pins`` table (migration 0098).

Reached through the ``arlesh`` bindings for the reason the token table is (see
:mod:`arlesh.server.ports.tokens.database_token_store`)."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from arlesh import _native
from arlesh.errors import from_native
from arlesh.server.ports.pairing.pairing_store import PairingRequest, PairingStore


def stamp(moment: datetime) -> str:
    """A time as the table stores it: ISO 8601 to the second, so text order is time order."""
    return moment.isoformat(timespec="seconds")


class DatabasePairingStore(PairingStore):
    """The pairing store as the ``pairing_pins`` table of the database at ``path``."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def create(self, request: PairingRequest) -> bool:
        return bool(
            self._call(
                "pairing_create",
                id_sha256=request.id_sha256,
                pin=request.pin,
                name=request.name,
                created_at=stamp(request.created),
                expires_at=stamp(request.expires),
            )
        )

    def all(self) -> list[PairingRequest]:
        return [
            PairingRequest(
                id_sha256=row["id_sha256"],
                pin=row["pin"],
                name=row["name"],
                approved_name=row["approved_name"],
                attempts=row["attempts"],
                created=datetime.fromisoformat(row["created_at"]),
                expires=datetime.fromisoformat(row["expires_at"]),
            )
            for row in self._call("pairing_all")
        ]

    def purge_expired(self, now: datetime) -> int:
        return int(self._call("pairing_purge", now=stamp(now)))

    def count_attempt(self, id_sha256: str) -> int | None:
        count = self._call("pairing_attempt", id_sha256=id_sha256)
        return int(count) if count is not None else None

    def approve(self, pin: str, name: str) -> bool:
        return bool(self._call("pairing_approve", pin=pin, name=name))

    def delete(self, id_sha256: str) -> bool:
        return bool(self._call("pairing_delete", id_sha256=id_sha256))

    def _call(self, op: str, **arguments: Any) -> Any:
        try:
            raw = _native.token_call(self._path, json.dumps({"op": op, **arguments}))
        except _native.NativeError as error:
            raise from_native(error) from None
        return json.loads(raw)
