"""The server's configuration: flags on the command line, or ``ARLESH_*`` variables.

Nested settings take ``__`` in their variable: ``ARLESH_DATABASE__PATH``,
``ARLESH_DATABASE__FORCE``, ``ARLESH_SERVER__HOST``, ``ARLESH_SERVER__PORT``.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

from arlesh.server.entrypoints.fastapi.config import ServerConfig


class DatabaseConfig(BaseModel):
    """Which database, and whether to write to it while the desktop app holds it."""

    path: Path
    """The Arlesh database file. The startup write-open creates it when it is missing."""
    force: bool = False
    """Open for writing even while the desktop app holds the database: two writers, on purpose.
    The server says so plainly when it starts."""


class Config(BaseSettings):
    """Everything the server is told."""

    database: DatabaseConfig
    server: ServerConfig = ServerConfig()

    model_config = SettingsConfigDict(env_prefix="ARLESH_", env_nested_delimiter="__")
