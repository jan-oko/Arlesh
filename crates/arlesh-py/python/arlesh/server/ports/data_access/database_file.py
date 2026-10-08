"""The data-access port: opening the Arlesh database file.

This is the server's way out to its storage. What comes back — an :class:`arlesh.Database` and its
operations — is the business logic; this port only says how a database is reached.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import arlesh


class DatabaseFile(ABC):
    """One Arlesh database, opened for writing as a named client."""

    @abstractmethod
    async def open(self, client: str, *, force: bool) -> arlesh.Database:
        """The database, open for writing as ``client``.

        Raises :class:`arlesh.NotPermitted` (``held_by_app``) while the desktop app holds it,
        unless ``force``; :class:`arlesh.InvalidRequest` for a client name the core refuses or a
        schema newer than this build. A missing file is created, and a schema behind is migrated.
        """
