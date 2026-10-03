"""Where the HTTP server listens, and with what certificate."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, model_validator

LOOPBACK = "127.0.0.1"


class ServerConfig(BaseModel):
    """The server's address and optional TLS."""

    host: str = LOOPBACK
    """Loopback by default. Any other address — a LAN or Tailscale one — is an explicit choice."""
    port: int = 4750
    tls_cert: Path | None = None
    """A certificate to serve HTTPS with, together with ``tls_key``. Without both, plain HTTP."""
    tls_key: Path | None = None

    @model_validator(mode="after")
    def _tls_whole_or_absent(self) -> ServerConfig:
        if (self.tls_cert is None) != (self.tls_key is None):
            raise ValueError("TLS needs both a certificate and its key")
        return self

    @property
    def tls(self) -> bool:
        """Whether it serves HTTPS."""
        return self.tls_cert is not None

    @property
    def sends_tokens_in_clear(self) -> bool:
        """Plain HTTP on an address other machines can reach."""
        return not self.tls and self.host not in (LOOPBACK, "localhost", "::1")
