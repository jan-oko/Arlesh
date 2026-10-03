"""The board port: the databases a request reads and writes through.

The ``arlesh`` bindings are the business logic; this port only says which open
:class:`arlesh.Database` a request gets.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import arlesh


class Databases(ABC):
    """One database to read through, and one open for writing per client."""

    @abstractmethod
    async def open(self) -> None:
        """Opens the database for writing: the startup guard. Raises what the open raises."""

    @abstractmethod
    async def close(self) -> None:
        """Closes every open database."""

    @property
    @abstractmethod
    def reader(self) -> arlesh.Database:
        """The database, for reads."""

    @abstractmethod
    async def writer(self, client: str) -> arlesh.Database:
        """The database open for writing as ``client``."""
