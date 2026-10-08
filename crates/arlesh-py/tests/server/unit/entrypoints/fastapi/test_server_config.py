"""Where the server listens, and whether its tokens cross the network in the clear."""

from __future__ import annotations

from pathlib import Path

import pytest
from arlesh.server.entrypoints.fastapi.config import ServerConfig
from pydantic import ValidationError


def test_it_listens_on_loopback_by_default() -> None:
    config = ServerConfig()

    assert config.host == "127.0.0.1"
    assert not config.tls
    assert not config.sends_tokens_in_clear


def test_plain_http_on_a_reachable_address_sends_tokens_in_the_clear() -> None:
    assert ServerConfig(host="0.0.0.0").sends_tokens_in_clear


def test_tls_on_a_reachable_address_does_not() -> None:
    config = ServerConfig(host="0.0.0.0", tls_cert=Path("c.pem"), tls_key=Path("k.pem"))

    assert config.tls
    assert not config.sends_tokens_in_clear


@pytest.mark.parametrize("given", [{"tls_cert": Path("c.pem")}, {"tls_key": Path("k.pem")}])
def test_half_of_tls_is_refused(given: dict[str, Path]) -> None:
    with pytest.raises(ValidationError):
        ServerConfig.model_validate(given)
