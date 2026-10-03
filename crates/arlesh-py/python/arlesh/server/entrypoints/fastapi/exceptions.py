"""The server's own refusals, beside the core's ``ArleshError``."""

from __future__ import annotations


class AuthenticationFailed(Exception):
    """A request without a token the server issued: answered 401."""

    def __init__(self, reason: str) -> None:
        super().__init__("a bearer token issued by this server is required")
        self.reason = reason
