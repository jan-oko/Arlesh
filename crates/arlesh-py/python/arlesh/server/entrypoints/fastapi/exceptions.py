"""The server's own refusals, beside the core's ``ArleshError``."""

from __future__ import annotations


class AuthenticationFailed(Exception):
    """A request without a token the server issued: answered 401."""

    def __init__(self, reason: str) -> None:
        super().__init__("a bearer token issued by this server is required")
        self.reason = reason


class RateLimited(Exception):
    """Too many requests from one address: answered 429."""

    def __init__(self, retry_after: int) -> None:
        super().__init__("too many requests from this address; try again later")
        self.retry_after = retry_after
