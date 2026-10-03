"""What a route is handed: the database to read or write through, and node ids from the path."""

from __future__ import annotations

from typing import Annotated

import arlesh
from fastapi import Depends, Header, Request

from arlesh_api.connections import Connections

CLIENT_HEADER = "X-Arlesh-Client"
"""The header a write names its client in. A label, not a credential: there is no auth."""


def _connections(request: Request) -> Connections:
    connections: Connections = request.app.state.connections
    return connections


def _reader(request: Request) -> arlesh.Database:
    return _connections(request).reader


async def _writer(
    request: Request,
    client: Annotated[
        str,
        Header(
            alias=CLIENT_HEADER,
            description="Who is writing: letters, digits, '.', '_' and '-'. The undo journal "
            "records it on every entry. Required on every write.",
        ),
    ],
) -> arlesh.Database:
    return await _connections(request).writer(client)


Reader = Annotated[arlesh.Database, Depends(_reader)]
"""The database, for a read. Needs no client."""

Writer = Annotated[arlesh.Database, Depends(_writer)]
"""The database open for writing as the request's ``X-Arlesh-Client``. A write without the header
is refused 400 ``invalid_request``."""


def node_id(raw: str) -> arlesh.NodeId:
    """A path's node id as the core reads it: a stored row's integer id, or a derived node's
    (a Habit occurrence's) UUID."""
    return int(raw) if raw.isdecimal() else raw
