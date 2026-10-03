"""The MCP backend: each client's own endpoint, started on its first request."""

from __future__ import annotations

from typing import Any

import arlesh
from arlesh.server.ports.board.databases import Databases
from arlesh.server.ports.mcp.arlesh_mcp_backend import ArleshMcpBackend


class FakeWriter:
    def __init__(self, port: int) -> None:
        self.port = port
        self.served: list[dict[str, Any]] = []

    async def serve_mcp(self, *, host: str, port: int) -> int:
        self.served.append({"host": host, "port": port})
        return self.port


class FakeDatabases(Databases):
    def __init__(self) -> None:
        self.writers: dict[str, FakeWriter] = {}

    async def open(self) -> None:
        pass

    async def close(self) -> None:
        pass

    @property
    def reader(self) -> arlesh.Database:
        raise AssertionError("the MCP backend never reads")

    async def writer(self, client: str) -> Any:
        return self.writers.setdefault(client, FakeWriter(5000 + len(self.writers)))


async def test_a_clients_endpoint_is_served_on_loopback_from_its_own_write_open() -> None:
    databases = FakeDatabases()

    url = await ArleshMcpBackend(databases).endpoint("phone")

    assert url == "http://127.0.0.1:5000/mcp"
    assert databases.writers["phone"].served == [{"host": "127.0.0.1", "port": 0}]


async def test_each_client_is_served_once_and_apart() -> None:
    databases = FakeDatabases()
    backend = ArleshMcpBackend(databases)

    phone = await backend.endpoint("phone")
    again = await backend.endpoint("phone")
    laptop = await backend.endpoint("laptop")

    assert phone == again != laptop
    assert len(databases.writers["phone"].served) == 1
