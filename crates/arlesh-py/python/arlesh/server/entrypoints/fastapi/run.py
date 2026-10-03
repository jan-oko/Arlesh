"""Serving the application with uvicorn."""

from __future__ import annotations

import uvicorn
from fastapi import FastAPI
from loguru import logger

from arlesh.server.entrypoints.fastapi.config import ServerConfig


def run(app: FastAPI, config: ServerConfig) -> None:
    """Serves ``app`` where ``config`` says, until stopped."""
    if config.sends_tokens_in_clear:
        logger.warning(
            "Plain HTTP on a reachable address: bearer tokens cross the network in the clear. "
            "Tailscale encrypts its own traffic; on a plain LAN, pass --tls-cert and --tls-key",
            host=config.host,
        )
    scheme = "https" if config.tls else "http"
    logger.info("Serving", url=f"{scheme}://{config.host}:{config.port}")
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        ssl_certfile=config.tls_cert,
        ssl_keyfile=config.tls_key,
        log_config=None,
        log_level="warning",
    )
