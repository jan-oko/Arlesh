"""Bearer tokens: every route needs one, and the token decides which client is asking."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from arlesh.server.entrypoints.fastapi.exceptions import AuthenticationFailed
from arlesh.server.ports.tokens.token_store import TokenStore

_BEARER = HTTPBearer(
    auto_error=False,
    description="A token from `arlesh-server token add <client>`. It names the client: the "
    "undo journal records that client on every write the token makes.",
)


class BearerTokenSecurityScheme:
    """Resolves a request's bearer token to its client, and puts the client in
    ``client_context`` for the routes."""

    def __init__(self, tokens: TokenStore, client_context: ContextVar[str]) -> None:
        # Async, so the ContextVar it sets is the one the route then reads.
        async def validate_auth(
            credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_BEARER)],
        ) -> str:
            if credentials is None:
                raise AuthenticationFailed("missing_token")
            client = tokens.client_for(credentials.credentials)
            if client is None:
                raise AuthenticationFailed("bad_token")
            client_context.set(client)
            return client

        self.validate_auth: Callable[..., Awaitable[str]] = validate_auth
