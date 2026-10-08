"""Arlesh over HTTP: the ``arlesh-server`` service, installed with ``arlesh[server]``.

The ``arlesh`` bindings are the business logic: every rule, every write's atomicity and every
refusal is the Rust core's own. Around them:

- :mod:`arlesh.server.business_logic` holds the :class:`~.business_logic.board.Board`: which open
  database a request reads and writes through, one write-open per client, and the startup guard.
- :mod:`arlesh.server.entrypoints` holds the ways in: ``cli`` (the ``arlesh-server`` command and
  the composition root), ``fastapi`` (the HTTP routes) and ``mcp`` (``/mcp``, proxied to each
  client's own MCP endpoint).
- :mod:`arlesh.server.ports` holds the ways out: ``data_access`` (the database file) and
  ``tokens`` (the token file).
"""
