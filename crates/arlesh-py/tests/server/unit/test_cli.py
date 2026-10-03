"""``arlesh-server``: serving with the flags given, and managing tokens."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from arlesh.server import cli
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.entrypoints.fastapi.config import ServerConfig
from arlesh.server.ports.tokens.file_token_store import FileTokenStore


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("ARLESH_DATABASE__PATH", "ARLESH_DATABASE__FORCE", "ARLESH_SERVER__HOST"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """What ``arlesh-server`` would have served, instead of serving it."""
    seen: dict[str, Any] = {}

    def serve(app: ArleshServer, config: ServerConfig) -> None:
        seen.update(app=app, config=config)

    monkeypatch.setattr("arlesh.server.entrypoints.fastapi.run.run", serve)
    return seen


def test_it_serves_the_database_on_loopback_by_default(
    tmp_path: Path, served: dict[str, Any]
) -> None:
    assert cli.main(["--db", str(tmp_path / "arlesh.db")]) == 0

    assert served["config"] == ServerConfig()
    assert isinstance(served["app"], ArleshServer)


def test_flags_choose_the_address_and_tls(tmp_path: Path, served: dict[str, Any]) -> None:
    cli.main(
        [
            "--db", str(tmp_path / "arlesh.db"),
            "--host", "0.0.0.0",
            "--port", "9000",
            "--tls-cert", "c.pem",
            "--tls-key", "k.pem",
        ]
    )  # fmt: skip

    config: ServerConfig = served["config"]
    assert (config.host, config.port, config.tls_cert) == ("0.0.0.0", 9000, Path("c.pem"))


def test_the_database_may_come_from_the_environment(
    tmp_path: Path, served: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ARLESH_DATABASE__PATH", str(tmp_path / "arlesh.db"))

    assert cli.main([]) == 0


def test_no_database_is_a_usage_error(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        cli.main([])

    assert "--db" in capsys.readouterr().err


def test_half_of_tls_is_a_usage_error(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        cli.main(["--db", str(tmp_path / "arlesh.db"), "--tls-cert", "c.pem"])


def test_it_says_when_no_token_has_been_issued(
    tmp_path: Path, served: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    cli.main(["--db", str(tmp_path / "arlesh.db")])

    assert "token add" in capsys.readouterr().err


def test_token_add_prints_a_token_that_names_the_client(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    database = tmp_path / "arlesh.db"

    assert cli.main(["token", "add", "phone", "--db", str(database)]) == 0

    token = capsys.readouterr().out.strip()
    assert FileTokenStore.beside(database).client_for(token) == "phone"


def test_token_list_and_revoke(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    database = str(tmp_path / "arlesh.db")
    cli.main(["token", "add", "phone", "--db", database])
    capsys.readouterr()

    cli.main(["token", "list", "--db", database])
    listed = capsys.readouterr().out
    cli.main(["token", "revoke", "phone", "--db", database])
    cli.main(["token", "list", "--db", database])

    assert listed.startswith("phone\t")
    assert capsys.readouterr().out == ""


def test_a_second_token_or_an_unknown_revoke_fails_plainly(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    database = str(tmp_path / "arlesh.db")
    cli.main(["token", "add", "phone", "--db", database])

    assert cli.main(["token", "add", "phone", "--db", database]) == 1
    assert cli.main(["token", "revoke", "laptop", "--db", database]) == 1
    assert "already has a token" in capsys.readouterr().err
