"""The configuration: ``ARLESH_*`` variables, nested with ``__``."""

from __future__ import annotations

from pathlib import Path

import pytest
from arlesh.server.config import Config
from pydantic import ValidationError


def test_the_environment_names_the_database_and_the_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ARLESH_DATABASE__PATH", "/data/arlesh.db")
    monkeypatch.setenv("ARLESH_DATABASE__FORCE", "true")
    monkeypatch.setenv("ARLESH_SERVER__HOST", "100.64.0.7")
    monkeypatch.setenv("ARLESH_SERVER__PORT", "8080")

    config = Config()

    assert config.database.path == Path("/data/arlesh.db")
    assert config.database.force is True
    assert (config.server.host, config.server.port) == ("100.64.0.7", 8080)


def test_without_a_database_it_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ARLESH_DATABASE__PATH", raising=False)

    with pytest.raises(ValidationError):
        Config()


def test_a_database_url_names_the_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ARLESH_DATABASE__PATH", raising=False)
    monkeypatch.setenv("ARLESH_DATABASE_URL", "sqlite:////data/arlesh.db")

    assert Config().database.path == Path("/data/arlesh.db")


def test_a_relative_database_url_is_relative(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ARLESH_DATABASE__PATH", raising=False)
    monkeypatch.setenv("ARLESH_DATABASE_URL", "sqlite:///arlesh.db")

    assert Config().database.path == Path("arlesh.db")


def test_the_url_can_come_from_a_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    secret = tmp_path / "database-url"
    secret.write_text("sqlite:////srv/board.db\n")
    monkeypatch.delenv("ARLESH_DATABASE__PATH", raising=False)
    monkeypatch.setenv("ARLESH_DATABASE_URL_FILE", str(secret))

    assert Config().database.path == Path("/srv/board.db")


def test_a_path_wins_over_the_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARLESH_DATABASE__PATH", "/flag/arlesh.db")
    monkeypatch.setenv("ARLESH_DATABASE_URL", "sqlite:////url/arlesh.db")

    assert Config().database.path == Path("/flag/arlesh.db")


def test_a_scheme_other_than_sqlite_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ARLESH_DATABASE__PATH", raising=False)
    monkeypatch.setenv("ARLESH_DATABASE_URL", "postgresql://db/arlesh")

    with pytest.raises(ValidationError, match="sqlite"):
        Config()


def test_a_url_and_a_url_file_together_are_refused(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    secret = tmp_path / "database-url"
    secret.write_text("sqlite:////a.db")
    monkeypatch.delenv("ARLESH_DATABASE__PATH", raising=False)
    monkeypatch.setenv("ARLESH_DATABASE_URL", "sqlite:////b.db")
    monkeypatch.setenv("ARLESH_DATABASE_URL_FILE", str(secret))

    with pytest.raises(ValidationError, match="not both"):
        Config()
