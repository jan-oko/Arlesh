"""Logging setup."""

from __future__ import annotations

import pytest
from arlesh.server.logger import setup_logger
from loguru import logger


def test_records_go_to_stderr_with_their_fields(capsys: pytest.CaptureFixture[str]) -> None:
    setup_logger()

    logger.info("Started up", version="1")

    assert "Started up" in capsys.readouterr().err
