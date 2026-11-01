"""The server's configuration: flags on the command line, or ``ARLESH_*`` variables.

Nested settings take ``__`` in their variable: ``ARLESH_DATABASE__PATH``,
``ARLESH_DATABASE__FORCE``, ``ARLESH_SERVER__HOST``, ``ARLESH_SERVER__PORT``.

The database can instead be named by a URL, as a container expects: ``ARLESH_DATABASE_URL``
(``sqlite:///relative.db`` or ``sqlite:////absolute/arlesh.db``), or ``ARLESH_DATABASE_URL_FILE``,
a file holding the URL, for a secret mounted as a file. ``--db`` and ``ARLESH_DATABASE__PATH``
are the shorthand and win over both. SQLite is the only scheme for now.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, model_validator
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

    database_url: str | None = None
    """The database as a URL: ``ARLESH_DATABASE_URL``. Used only when no path is given."""
    database_url_file: Path | None = None
    """A file holding the database URL: ``ARLESH_DATABASE_URL_FILE``."""

    model_config = SettingsConfigDict(env_prefix="ARLESH_", env_nested_delimiter="__")

    @model_validator(mode="before")
    @classmethod
    def _path_from_url(cls, values: Any) -> Any:
        """Fills ``database.path`` from the URL when no path was given."""
        if not isinstance(values, dict):
            return values
        database = values.get("database")
        database = dict(database) if isinstance(database, dict) else {}
        if database.get("path") is not None:
            return values
        url = _url(values.get("database_url"), values.get("database_url_file"))
        if url is None:
            return values
        values = dict(values)
        values["database"] = {**database, "path": sqlite_path(url)}
        return values


SQLITE_SCHEME = "sqlite:///"


def sqlite_path(url: str) -> Path:
    """The file a ``sqlite:///`` URL names: ``sqlite:///arlesh.db`` is relative to the working
    directory, ``sqlite:////data/arlesh.db`` absolute. Raises ``ValueError`` for any other
    scheme."""
    if not url.startswith(SQLITE_SCHEME):
        raise ValueError(f"only {SQLITE_SCHEME}… database URLs are supported, not {url!r}")
    path = url.removeprefix(SQLITE_SCHEME).split("?", 1)[0]
    if not path:
        raise ValueError("the database URL names no file")
    return Path(path)


def _url(url: Any, url_file: Any) -> str | None:
    if url is not None and url_file is not None:
        raise ValueError("give ARLESH_DATABASE_URL or ARLESH_DATABASE_URL_FILE, not both")
    if url_file is not None:
        return Path(url_file).read_text().strip()
    return str(url) if url is not None else None
