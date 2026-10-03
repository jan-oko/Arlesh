"""Arlesh over HTTP: the ``arlesh-server`` service, installed with ``arlesh[server]``.

Every route is a thin translation between HTTP and one call on the ``arlesh`` bindings; the
rules, the writes' atomicity and their refusals are the Rust core's own.

- :mod:`arlesh.server.cli` is the composition root and the ``arlesh-server`` command.
- :mod:`arlesh.server.entrypoints.fastapi` holds the application, its routers, its security
  scheme and its error answers.
- :mod:`arlesh.server.ports` holds what it stands on: the databases, and the token store.
"""
