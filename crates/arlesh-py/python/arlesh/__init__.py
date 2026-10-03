"""Arlesh from Python: the board, its rules and its writes, run by Arlesh's own Rust core.

::

    import arlesh
    from arlesh.models import CreateTaskRequest

    async with await arlesh.open("arlesh.db", client="notebook") as db:
        board = await db.board()
        task = await db.create_task(CreateTaskRequest(title="Write it", parent_type="domain",
                                                      parent_id=7))

- :func:`open` opens a database: read-only by default, for writing when you name a ``client``.
- :class:`Database` holds every operation; each is a coroutine.
- :mod:`arlesh.rules` holds the pure rules, as plain functions.
- :mod:`arlesh.models` holds the pydantic models, generated from the Rust types' JSON Schema.
- :mod:`arlesh.errors` holds the exceptions, one per ``WireError`` kind.
"""

from arlesh import errors, models, rules
from arlesh._native import json_schema
from arlesh.database import Database, NodeId, open
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

__all__ = [
    "AmbiguousId",
    "ArleshError",
    "ContainmentViolated",
    "Database",
    "DatabaseError",
    "InternalError",
    "InvalidRequest",
    "NeedsConfirmation",
    "NeedsTimeScope",
    "NodeId",
    "NotFound",
    "NotPermitted",
    "StatusChanged",
    "errors",
    "json_schema",
    "models",
    "open",
    "rules",
]
