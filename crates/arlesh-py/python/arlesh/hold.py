"""Holding a database: being its one writer for as long as you run.

A script's write-open (:func:`arlesh.open` with a ``client``) only *checks* whether the desktop
app holds the database. A long-lived writer that means to be the only one — ``arlesh-server`` —
*takes* the hold, the same operating-system lock on ``<database>.lock`` the app takes while it
runs. While it is held, the app cannot take it, another server is refused, and a script's
write-open is refused unless forced. The lock dies with its process, so a crash leaves nothing
stale behind.
"""

from __future__ import annotations

import os
from types import TracebackType
from typing import Self

from arlesh import _native
from arlesh.errors import from_native


class Hold:
    """A taken hold. Release it with :meth:`release`, or use it as a context manager."""

    def __init__(self, native: _native.NativeHold) -> None:
        self._native = native

    @property
    def held(self) -> bool:
        """Whether it is still held."""
        return self._native.held

    def release(self) -> None:
        """Releases the hold. Releasing it twice does nothing."""
        self._native.release()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.release()


def hold(path: str | os.PathLike[str]) -> Hold:
    """Takes the hold on the database at ``path``, at once or not at all.

    Raises :class:`arlesh.NotPermitted` (``details.reason == "held"``) when the desktop app or
    another holder already has it.
    """
    try:
        return Hold(_native.hold(path))
    except _native.NativeError as error:
        raise from_native(error) from None
