"""``arlesh-server``: serving with the flags given, and managing tokens."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from arlesh.server.entrypoints.cli.app import app
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.entrypoints.fastapi.config import ServerConfig
from arlesh.server.ports.tokens.file_token_store import FileTokenStore
from typer.testing import CliRunner

runner = CliRunner()


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("ARLESH_DATABASE__PATH", "ARLESH_DATABASE__FORCE", "ARLESH_SERVER__HOST"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """What ``arlesh-server`` would have served, instead of serving it."""
    seen: dict[str, Any] = {}

    def serve(server: ArleshServer, config: ServerConfig) -> None:
        seen.update(app=server, config=config)

    monkeypatch.setattr("arlesh.server.entrypoints.fastapi.run.run", serve)
    return seen


def test_it_serves_the_database_on_loopback_by_default(
    tmp_path: Path, served: dict[str, Any]
) -> None:
    result = runner.invoke(app, ["--db", str(tmp_path / "arlesh.db")])

    assert result.exit_code == 0, result.output
    assert served["config"] == ServerConfig()
    assert isinstance(served["app"], ArleshServer)


def test_flags_choose_the_address_and_tls(tmp_path: Path, served: dict[str, Any]) -> None:
    runner.invoke(
        app,
        [
            "--db", str(tmp_path / "arlesh.db"),
            "--host", "0.0.0.0",
            "--port", "9000",
            "--tls-cert", "c.pem",
            "--tls-key", "k.pem",
        ],
    )  # fmt: skip

    config: ServerConfig = served["config"]
    assert (config.host, config.port, config.tls_cert) == ("0.0.0.0", 9000, Path("c.pem"))


def test_the_database_may_come_from_the_environment(
    tmp_path: Path, served: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ARLESH_DATABASE__PATH", str(tmp_path / "arlesh.db"))

    assert runner.invoke(app, []).exit_code == 0
    assert "config" in served


def test_no_database_is_a_usage_error() -> None:
    result = runner.invoke(app, [])

    assert result.exit_code == 2
    assert "--db" in result.output


def test_half_of_tls_is_a_usage_error(tmp_path: Path) -> None:
    result = runner.invoke(app, ["--db", str(tmp_path / "arlesh.db"), "--tls-cert", "c.pem"])

    assert result.exit_code == 2


def test_it_says_when_no_token_has_been_issued(tmp_path: Path, served: dict[str, Any]) -> None:
    result = runner.invoke(app, ["--db", str(tmp_path / "arlesh.db")])

    assert "token add" in result.output


def test_token_add_prints_a_token_that_names_the_client(tmp_path: Path) -> None:
    database = tmp_path / "arlesh.db"

    result = runner.invoke(app, ["token", "add", "phone", "--db", str(database)])

    assert result.exit_code == 0, result.output
    assert FileTokenStore.beside(database).client_for(result.stdout.strip()) == "phone"


def test_token_list_and_revoke(tmp_path: Path) -> None:
    database = str(tmp_path / "arlesh.db")
    runner.invoke(app, ["token", "add", "phone", "--db", database])

    listed = runner.invoke(app, ["token", "list", "--db", database]).stdout
    revoked = runner.invoke(app, ["token", "revoke", "phone", "--db", database])
    after = runner.invoke(app, ["token", "list", "--db", database]).stdout

    assert listed.startswith("phone\t")
    assert revoked.exit_code == 0
    assert after == ""


def test_a_second_token_or_an_unknown_revoke_fails_plainly(tmp_path: Path) -> None:
    database = str(tmp_path / "arlesh.db")
    runner.invoke(app, ["token", "add", "phone", "--db", database])

    again = runner.invoke(app, ["token", "add", "phone", "--db", database])
    unknown = runner.invoke(app, ["token", "revoke", "laptop", "--db", database])

    assert (again.exit_code, unknown.exit_code) == (1, 1)
    assert "already has a token" in again.output
    assert "has no token" in unknown.output


def test_token_without_a_database_is_a_usage_error() -> None:
    assert runner.invoke(app, ["token", "list"]).exit_code == 2
