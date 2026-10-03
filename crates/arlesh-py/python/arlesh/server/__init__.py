"""Arlesh over HTTP: a FastAPI service over the ``arlesh`` bindings.

Every endpoint is a thin translation between HTTP and one binding call. The rules, the writes'
atomicity and their refusals are the Rust core's own; nothing here decides anything about the
board.

- :func:`create_app` builds the application for a :class:`Settings`.
- ``arlesh-api`` (:mod:`arlesh_api.cli`) serves it on localhost.
"""

from arlesh_api.app import create_app
from arlesh_api.settings import Settings

__all__ = ["Settings", "create_app"]
