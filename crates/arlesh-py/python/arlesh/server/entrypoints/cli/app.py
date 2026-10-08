"""``arlesh-server``: the command-line entrypoint, and the composition root.

::

    arlesh-server --db ~/arlesh.db                      # 127.0.0.1:4750, plain HTTP
    arlesh-server --db ~/arlesh.db --host 100.64.0.7    # a Tailscale address
    arlesh-server --db ~/arlesh.db --host 0.0.0.0 --tls-cert cert.pem --tls-key key.pem
    arlesh-server --db ~/arlesh.db --force              # beside the running app, on purpose

    arlesh-server token add phone --db ~/arlesh.db      # prints phone's token, once
    arlesh-server token list --db ~/arlesh.db
    arlesh-server token revoke phone --db ~/arlesh.db

Every flag can come from the environment instead (``ARLESH_DATABASE__PATH`` and so on; see
:mod:`arlesh.server.config`); a flag given wins.
"""

from __future__ import annotations

from importlib.metadata import version
from pathlib import Path
from typing import Annotated, Any

import typer
from pydantic import ValidationError

import arlesh
from arlesh.server.business_logic.board import Board, OpenAs, TakeHold
from arlesh.server.config import Config
from arlesh.server.entrypoints.fastapi import run
from arlesh.server.entrypoints.fastapi.app import ArleshServer
from arlesh.server.logger import setup_logger
from arlesh.server.ports.tokens.file_token_store import FileTokenStore
from arlesh.server.ports.tokens.token_store import ClientAlreadyHasToken, UnknownClient

PROGRAM = "arlesh-server"

app = typer.Typer(
    name=PROGRAM,
    help="Serve an Arlesh board over HTTP. With no command, serves it.",
    add_completion=False,
    no_args_is_help=False,
)
token_app = typer.Typer(help="Manage the bearer tokens, one per client.", no_args_is_help=True)
app.add_typer(token_app, name="token")

Db = Annotated[
    Path | None, typer.Option("--db", help="The database file (or $ARLESH_DATABASE__PATH).")
]


@app.callback(invoke_without_command=True)
def serve(
    context: typer.Context,
    db: Db = None,
    force: Annotated[
        bool | None,
        typer.Option(
            "--force",
            help="Start even while the app or another server holds the database, taking no hold.",
        ),
    ] = None,
    host: Annotated[
        str | None, typer.Option(help="The address to listen on (default 127.0.0.1).")
    ] = None,
    port: Annotated[int | None, typer.Option(help="The port (default 4750).")] = None,
    tls_cert: Annotated[
        Path | None, typer.Option(help="Serve HTTPS with this certificate.")
    ] = None,
    tls_key: Annotated[Path | None, typer.Option(help="… and this key.")] = None,
) -> None:
    """Serves the board until stopped."""
    if context.invoked_subcommand is not None:
        return
    config = _config(
        database={"path": db, "force": force},
        server={"host": host, "port": port, "tls_cert": tls_cert, "tls_key": tls_key},
    )
    setup_logger()
    tokens = FileTokenStore.beside(config.database.path)
    if not tokens.issued():
        typer.echo(
            f"{PROGRAM}: no tokens yet: add one with `{PROGRAM} token add <client>`", err=True
        )
    path = config.database.path
    board = Board(opener(path), holder(path), force=config.database.force)
    run.run(ArleshServer(board=board, tokens=tokens, version=version("arlesh")), config.server)


@token_app.command("add")
def add_token(
    client: Annotated[str, typer.Argument(help="Who the token is for.")], db: Db = None
) -> None:
    """Issues CLIENT a token and prints it. It is shown this once."""
    try:
        typer.echo(_tokens(db).add(client))
    except ClientAlreadyHasToken as refusal:
        _fail(refusal)


@token_app.command("list")
def list_tokens(db: Db = None) -> None:
    """The clients holding a token, and when each was issued."""
    for issued in _tokens(db).issued():
        typer.echo(f"{issued.client}\t{issued.created:%Y-%m-%d %H:%M}")


@token_app.command("revoke")
def revoke_token(
    client: Annotated[str, typer.Argument(help="Whose token.")], db: Db = None
) -> None:
    """Revokes CLIENT's token. It stops working at once."""
    try:
        _tokens(db).revoke(client)
    except UnknownClient as refusal:
        _fail(refusal)


def main() -> None:
    """The ``arlesh-server`` console script."""
    app(prog_name=PROGRAM)


def opener(path: Path) -> OpenAs:
    """Opens the database at ``path`` with the ``arlesh`` package's own implementation.

    Always past the hold check: the server either holds the database itself or was forced.
    """

    async def open_as(client: str) -> arlesh.Database:
        return await arlesh.open(path, client=client, force=True)

    return open_as


def holder(path: Path) -> TakeHold:
    """Takes the hold on the database at ``path``, as the desktop app does."""
    return lambda: arlesh.hold(path)


def _tokens(db: Path | None) -> FileTokenStore:
    return FileTokenStore.beside(_config(database={"path": db}).database.path)


def _config(**sections: dict[str, Any]) -> Config:
    """The configuration: the environment's, with the flags given on top of it."""
    given: dict[str, Any] = {}
    for name, values in sections.items():
        flags = {key: value for key, value in values.items() if value is not None}
        if flags:
            given[name] = flags
    try:
        return Config(**given)
    except ValidationError as error:
        raise typer.BadParameter(_explain(error)) from None


def _explain(error: ValidationError) -> str:
    first = error.errors()[0]
    location = ".".join(str(part) for part in first["loc"])
    if location == "database" or location.startswith("database.path"):
        return "name the database with --db or ARLESH_DATABASE__PATH"
    return f"{location}: {first['msg']}"


def _fail(refusal: Exception) -> None:
    typer.echo(f"{PROGRAM}: {refusal}", err=True)
    raise typer.Exit(1)
