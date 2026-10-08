"""Serving: uvicorn with the address and TLS asked for, and a plain warning when tokens would
cross the network in the clear."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from arlesh.server.entrypoints.fastapi import run
from arlesh.server.entrypoints.fastapi.config import ServerConfig
from fastapi import FastAPI
from loguru import logger


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    options: dict[str, Any] = {}

    def serve(_app: object, **given: Any) -> None:
        options.update(given)

    monkeypatch.setattr("uvicorn.run", serve)
    return options


@pytest.fixture
def logged() -> Iterator[list[str]]:
    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(str(message)), level="DEBUG")
    yield lines
    logger.remove(sink)


def test_it_serves_where_the_config_says(served: dict[str, Any]) -> None:
    run.run(FastAPI(), ServerConfig(port=9000))

    assert (served["host"], served["port"], served["ssl_certfile"]) == ("127.0.0.1", 9000, None)


def test_it_serves_https_with_the_certificate_given(served: dict[str, Any]) -> None:
    config = ServerConfig(host="0.0.0.0", tls_cert=Path("c.pem"), tls_key=Path("k.pem"))

    run.run(FastAPI(), config)

    assert (served["ssl_certfile"], served["ssl_keyfile"]) == (Path("c.pem"), Path("k.pem"))


def test_plain_http_on_a_reachable_address_warns(served: dict[str, Any], logged: list[str]) -> None:
    run.run(FastAPI(), ServerConfig(host="0.0.0.0"))

    assert any("in the clear" in line for line in logged)


def test_loopback_does_not_warn(served: dict[str, Any], logged: list[str]) -> None:
    run.run(FastAPI(), ServerConfig())

    assert not any("in the clear" in line for line in logged)
