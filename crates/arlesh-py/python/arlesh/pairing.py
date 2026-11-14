"""Pairing a device with an ``arlesh-server``: a PIN to approve, then a token.

::

    started = await arlesh.pairing.start(url, "notebook")
    print("Approve this PIN on the server:", started.pin)
    token = await arlesh.pairing.wait(url, started)

The package stores the token nowhere; keeping it is the caller's.
"""

from __future__ import annotations

import asyncio
import json

from pydantic import BaseModel

from arlesh import _native
from arlesh.errors import ArleshError, from_native


class PairStarted(BaseModel):
    """A pairing the server is waiting to have approved."""

    id: str
    pin: str
    name: str
    expires_at: str


async def start(url: str, name: str | None = None) -> PairStarted:
    """Asks the server at ``url`` for a PIN for a device suggesting ``name``."""
    try:
        return PairStarted.model_validate_json(await _native.pair_start(url, name))
    except _native.NativeError as error:
        raise from_native(error) from None


async def wait(url: str, started: PairStarted, *, interval: float = 2.0) -> str:
    """Polls until the PIN is approved and answers the device's token."""
    while True:
        try:
            polled = json.loads(await _native.pair_poll(url, started.id, started.pin))
        except _native.NativeError as error:
            raise from_native(error) from None
        if polled["status"] == "approved":
            token = polled.get("token")
            if not isinstance(token, str):
                raise ArleshError("the server approved the PIN without a token")
            return token
        await asyncio.sleep(interval)
