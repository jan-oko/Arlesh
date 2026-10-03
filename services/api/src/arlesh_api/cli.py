"""``arlesh-api``: serves the board on localhost.

::

    arlesh-api --db ~/arlesh-copy.db            # refuses while the desktop app holds it
    arlesh-api --db ~/arlesh.db --force         # two writers, on purpose; warns plainly
"""

from __future__ import annotations

import argparse
import logging
import sys

import uvicorn

from arlesh_api.app import create_app
from arlesh_api.settings import DB_ENV, FORCE_ENV, Settings

HOST = "127.0.0.1"
"""Localhost only. Remote access, auth and TLS belong with the multi-device work."""

DEFAULT_PORT = 4750


def parse(argv: list[str]) -> tuple[Settings, int]:
    """The settings and port ``argv`` asks for."""
    parser = argparse.ArgumentParser(prog="arlesh-api", description=__doc__.splitlines()[0])
    parser.add_argument("--db", help=f"the database file (default: ${DB_ENV})")
    parser.add_argument(
        "--force",
        action="store_true",
        help=f"write even while the desktop app holds the database (or {FORCE_ENV}=1)",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    arguments = parser.parse_args(argv)
    try:
        settings = Settings.from_env(arguments.db, arguments.force)
    except ValueError as error:
        parser.error(str(error))
    return settings, arguments.port


def main(argv: list[str] | None = None) -> int:
    """Serves until stopped. Exits non-zero, saying why, when the database cannot be opened for
    writing — while the desktop app holds it, for one."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings, port = parse(sys.argv[1:] if argv is None else argv)
    uvicorn.run(create_app(settings), host=HOST, port=port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
