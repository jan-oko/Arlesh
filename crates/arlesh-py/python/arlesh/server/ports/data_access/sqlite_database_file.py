"""The data-access port over SQLite: the database file at a path, opened by the core."""

from __future__ import annotations

from pathlib import Path

import arlesh

from arlesh.server.ports.data_access.database_file import DatabaseFile


class SqliteDatabaseFile(DatabaseFile):
    """The SQLite database at ``path``, opened through ``arlesh.open``."""

    def __init__(self, path: Path) -> None:
        self.path = path

    async def open(self, client: str, *, force: bool) -> arlesh.Database:
        return await arlesh.open(self.path, client=client, force=force)
