"""Arlesh from Python: the board, its rules and its writes, run by Arlesh's own Rust core.

::

    import arlesh
    from arlesh.models import CreateTaskRequest

    async with await arlesh.open("arlesh.db", client="notebook") as db:
        board = await db.board()
        task = await db.create_task(CreateTaskRequest(title="Write it", parent_type="domain",
                                                      parent_id=7))

- :class:`Arlesh` is the façade over a backend you choose: ``Arlesh(backend=SqliteBackend(path,
  client=…))`` or ``Arlesh(backend=HttpBackend(url, token=…))``, the app's own two backends.
  ``async for change in board.changes()`` follows the board.
- :func:`open` opens a database: read-only by default, for writing when you name a ``client``.
- :class:`Database` is the port holding every operation, each a coroutine;
  :class:`SqliteDatabase`, which :func:`open` returns, is its implementation over the core.
- :func:`hold` takes the hold on a database, as the desktop app does, for a writer that means
  to be the only one while it runs.
- :mod:`arlesh.rules` holds the pure rules, as plain functions.
- :mod:`arlesh.models` holds the pydantic models, generated from the Rust types' JSON Schema.
- :mod:`arlesh.errors` holds the exceptions, one per ``WireError`` kind.
"""

from arlesh import errors, models, pairing, rules
from arlesh._native import json_schema
from arlesh.backends import (
    Backend,
    BoardHead,
    BoardRevision,
    CurrentBoard,
    HttpBackend,
    ServerStatus,
    SqliteBackend,
)
from arlesh.database import Arlesh, Database, NodeId, SqliteDatabase, open, set_time_zone
from arlesh.errors import (
    AmbiguousId,
    ArleshError,
    ContainmentViolated,
    DatabaseError,
    InternalError,
    InvalidRequest,
    NeedsConfirmation,
    NeedsTimeScope,
    NotFound,
    NotPermitted,
    StatusChanged,
)
from arlesh.hold import Hold, hold

__all__ = [
    "AmbiguousId",
    "Arlesh",
    "ArleshError",
    "Backend",
    "BoardHead",
    "BoardRevision",
    "ContainmentViolated",
    "CurrentBoard",
    "Database",
    "DatabaseError",
    "Hold",
    "HttpBackend",
    "InternalError",
    "InvalidRequest",
    "NeedsConfirmation",
    "NeedsTimeScope",
    "NodeId",
    "NotFound",
    "NotPermitted",
    "ServerStatus",
    "SqliteBackend",
    "SqliteDatabase",
    "StatusChanged",
    "errors",
    "hold",
    "json_schema",
    "models",
    "open",
    "pairing",
    "rules",
    "set_time_zone",
]
