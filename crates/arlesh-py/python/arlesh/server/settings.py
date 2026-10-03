"""What the service is told when it starts: which database, and whether to force past the app."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DB_ENV = "ARLESH_DB"
"""The environment variable naming the database file."""

FORCE_ENV = "ARLESH_API_FORCE"
"""The environment variable that, set to ``1``, forces a write-open past the app's hold."""

SERVICE_CLIENT = "arlesh-api"
"""The client the service's own startup open writes as. It never writes: every write goes out
under the client its request names."""


@dataclass(frozen=True)
class Settings:
    """The service's configuration."""

    db_path: Path
    """The Arlesh database file. A write-open creates it when it is missing."""

    force: bool = False
    """Open for writing even while the desktop app holds the database. Two writers then share
    the file; the service says so plainly when it starts."""

    @classmethod
    def from_env(cls, db_path: str | None = None, force: bool | None = None) -> Settings:
        """Settings from explicit values, falling back to the environment."""
        path = db_path if db_path is not None else os.environ.get(DB_ENV)
        if not path:
            raise ValueError(f"name the database with --db or {DB_ENV}")
        forced = force if force else os.environ.get(FORCE_ENV) == "1"
        return cls(db_path=Path(path), force=forced)
