"""The server against ``conformance/client-mode.json``: every route the app's ``HttpBackend`` calls
is served, and the API version is the one the app expects. The port's side — that every Backend
method is listed — is ``src-tauri/src/backend/tests.rs``."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from arlesh.server.entrypoints.fastapi.routers.health import API_VERSION
from fastapi.testclient import TestClient

CONTRACT = Path(__file__).parents[5] / "conformance" / "client-mode.json"


def _contract() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(CONTRACT.read_text())
    return loaded


def _shape(path: str) -> str:
    """A path with its parameters' names dropped: ``/tasks/{id}`` and ``/tasks/{task}`` agree."""
    return re.sub(r"\{[^}]+\}", "{}", path)


def test_every_route_the_app_calls_is_served(server: TestClient) -> None:
    served = {
        (method.upper(), _shape(path))
        for path, operations in server.app.openapi()["paths"].items()  # type: ignore[attr-defined]
        for method in operations
    }
    wanted = {
        (route.split(" ", 1)[0], _shape(route.split(" ", 1)[1]))
        for routes in (*_contract()["routes"].values(), *_contract()["pairing"].values())
        for route in routes
    }

    assert sorted(wanted - served) == []


def test_the_api_version_is_the_apps(server: TestClient) -> None:
    assert _contract()["api_version"] == API_VERSION
    assert server.get("/health").json()["api_version"] == API_VERSION


def test_people_and_the_knowledge_base_have_no_routes(server: TestClient) -> None:
    paths = server.app.openapi()["paths"]  # type: ignore[attr-defined]

    # `/events` is the change stream, not the knowledge base's Events.
    assert [path for path in paths if re.search(r"people|person|thread|knowledge", path)] == []
