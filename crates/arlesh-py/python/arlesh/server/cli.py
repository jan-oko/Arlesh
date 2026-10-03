"""``arlesh-server``: the composition root.

::

    arlesh-server --db ~/arlesh.db                      # 127.0.0.1:4750, plain HTTP
    arlesh-server --db ~/arlesh.db --host 100.64.0.7    # a Tailscale address
    arlesh-server --db ~/arlesh.db --host 0.0.0.0 --tls-cert cert.pem --tls-key key.pem
    arlesh-server --db ~/arlesh.db --force              # beside the running app, on purpose

    arlesh-server token add phone --db ~/arlesh.db      # prints phone's token, once
    arlesh-server token list --db ~/arlesh.db
    arlesh-server token revoke phone --db ~/arlesh.db
"""

from __future__ import annotations

import argparse
import sys
from importlib.metadata import version
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from arlesh.server.config import Config
from arlesh.server.entrypoints.fastapi import run
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.logger import setup_logger
from arlesh.server.ports.board.arlesh_databases import ArleshDatabases
from arlesh.server.ports.mcp.arlesh_mcp_backend import ArleshMcpBackend
from arlesh.server.ports.tokens.file_token_store import FileTokenStore
from arlesh.server.ports.tokens.token_store import (
    ClientAlreadyHasToken,
    TokenStore,
    UnknownClient,
)

PROGRAM = "arlesh-server"


def main(argv: list[str] | None = None) -> int:
    """Runs ``arlesh-server`` with ``argv``: ``token …`` manages tokens, anything else serves."""
    arguments = sys.argv[1:] if argv is None else argv
    if arguments[:1] == ["token"]:
        return _token(arguments[1:])
    return _serve(arguments)


def _serve(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog=PROGRAM, description="Serve an Arlesh board over HTTP.")
    _database_flag(parser)
    parser.add_argument(
        "--force",
        action="store_true",
        default=None,
        help="write even while the desktop app holds the database",
    )
    parser.add_argument("--host", help="the address to listen on (default 127.0.0.1)")
    parser.add_argument("--port", type=int, help="the port (default 4750)")
    parser.add_argument("--tls-cert", type=Path, help="serve HTTPS with this certificate")
    parser.add_argument("--tls-key", type=Path, help="… and this key")
    options = parser.parse_args(argv)
    config = _config(parser, options)
    setup_logger()
    databases = ArleshDatabases(config.database.path, force=config.database.force)
    tokens = FileTokenStore.beside(config.database.path)
    if not tokens.issued():
        print(
            f"{PROGRAM}: no tokens yet: add one with `{PROGRAM} token add <client>`",
            file=sys.stderr,
        )
    app = ArleshServer(
        databases=databases,
        tokens=tokens,
        mcp=ArleshMcpBackend(databases),
        version=version("arlesh"),
    )
    run.run(app, config.server)
    return 0


def _token(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog=f"{PROGRAM} token", description="Manage bearer tokens.")
    actions = parser.add_subparsers(dest="action", required=True)
    for action, help_text in (("add", "issue a client a token"), ("revoke", "revoke a client's")):
        sub = actions.add_parser(action, help=help_text)
        sub.add_argument("client")
        _database_flag(sub)
    _database_flag(actions.add_parser("list", help="the clients holding a token"))
    options = parser.parse_args(argv)
    config = _config(parser, options)
    return _run_token_action(FileTokenStore.beside(config.database.path), options)


def _run_token_action(tokens: TokenStore, options: argparse.Namespace) -> int:
    try:
        if options.action == "add":
            print(tokens.add(options.client))
        elif options.action == "revoke":
            tokens.revoke(options.client)
        else:
            for issued in tokens.issued():
                print(f"{issued.client}\t{issued.created:%Y-%m-%d %H:%M}")
    except (ClientAlreadyHasToken, UnknownClient) as refusal:
        print(f"{PROGRAM}: {refusal}", file=sys.stderr)
        return 1
    return 0


def _database_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--db", type=Path, help="the database file (or $ARLESH_DATABASE__PATH)")


def _config(parser: argparse.ArgumentParser, options: argparse.Namespace) -> Config:
    """The configuration: the environment's, with the flags given on top of it."""
    flags = {
        "database": _given(options, path="db", force="force"),
        "server": _given(options, host="host", port="port", tls_cert="tls_cert", tls_key="tls_key"),
    }
    given: dict[str, Any] = {section: values for section, values in flags.items() if values}
    try:
        return Config(**given)
    except ValidationError as error:
        parser.error(_explain(error))


def _given(options: argparse.Namespace, **names: str) -> dict[str, Any]:
    """The flags among ``names`` that were given, keyed by their setting."""
    return {
        setting: getattr(options, flag)
        for setting, flag in names.items()
        if getattr(options, flag, None) is not None
    }


def _explain(error: ValidationError) -> str:
    first = error.errors()[0]
    location = ".".join(str(part) for part in first["loc"])
    if location == "database":
        return "name the database with --db or ARLESH_DATABASE__PATH"
    return f"{location}: {first['msg']}"
