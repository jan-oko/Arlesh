"""Push registrations in the database itself: the ``push_devices`` and ``push_sent`` tables
(migration 0099), reached through the ``arlesh`` bindings for the reason the token table is (see
:mod:`arlesh.server.ports.tokens.database_token_store`). What is owed is decided by the core's
rules (``arlesh_core::push::rules``) over the derived board; nothing is decided here."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from arlesh import _native
from arlesh.errors import from_native
from arlesh.server.ports.push.push_store import DevicePlan, PushDevice, PushStore, SentEntry

_DEVICES = TypeAdapter(list[PushDevice])
_PLANS = TypeAdapter(list[DevicePlan])


def _at(moment: datetime | None) -> str | None:
    return moment.isoformat(timespec="seconds") if moment is not None else None


class DatabasePushStore(PushStore):
    """The push store as the push tables of the database at ``path``."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def register(self, client: str, fcm_token: str, *, now: datetime | None = None) -> bool:
        return bool(self._call("register", client=client, fcm_token=fcm_token, now=_at(now)))

    def unregister(self, client: str) -> bool:
        return bool(self._call("unregister", client=client))

    def devices(self) -> list[PushDevice]:
        return _DEVICES.validate_python(self._call("devices"))

    def plan(self, *, now: datetime | None = None) -> list[DevicePlan]:
        return _PLANS.validate_python(self._call("plan", now=_at(now)))

    def record(self, client: str, entries: list[SentEntry], *, now: datetime | None = None) -> None:
        self._call(
            "record",
            client=client,
            entries=[entry.model_dump() for entry in entries],
            at=_at(now),
        )

    def _call(self, op: str, **arguments: Any) -> Any:
        try:
            raw = _native.push_call(self._path, json.dumps({"op": op, **arguments}))
        except _native.NativeError as error:
            raise from_native(error) from None
        return json.loads(raw)
