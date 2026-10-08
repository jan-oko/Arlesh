"""Logging: loguru, to stderr, with each record's structured fields beside its message."""

from __future__ import annotations

import sys

from loguru import logger


def setup_logger(level: str = "INFO") -> None:
    """Replaces loguru's default handler with one that prints the bound fields too."""
    logger.remove()
    logger.add(
        sys.stderr,
        level=level,
        format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | "
        "<level>{message}</level> {extra}",
    )
