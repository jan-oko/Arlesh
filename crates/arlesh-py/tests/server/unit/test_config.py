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
