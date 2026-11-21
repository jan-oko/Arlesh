"""The seed a request's writes mint their ids under (``X-Arlesh-Request-Id``).

A client that predicts a write sends the id it seeded the prediction with, so the server mints the
rows the client never named (a copy, a Flow start) under the same ids. The server's entry point
puts the header's UUID here; :class:`arlesh.Arlesh` adds it to the call it makes to the core.
"""

from __future__ import annotations

from contextvars import ContextVar
from uuid import UUID

request_seed: ContextVar[str | None] = ContextVar("arlesh_request_seed", default=None)
"""The current request's seed, spelled as a hyphenated UUID, or ``None`` when it has none."""


def read_seed(header: str | None) -> str | None:
    """The seed a header value spells, or ``None`` when it is absent or not a UUID.

    A seed only decides which ids a write mints, so a header that is not a UUID is ignored: the
    write is correct unseeded."""
    if header is None:
        return None
    try:
        return str(UUID(header))
    except ValueError:
        return None
