"""The bearer scheme: a token names a client, which the routes then read."""

from __future__ import annotations

from contextvars import ContextVar

import pytest
from arlesh.server.entrypoints.fastapi.exceptions import AuthenticationFailed
from arlesh.server.entrypoints.fastapi.security_scheme import BearerTokenSecurityScheme
from arlesh.server.ports.tokens.token_store import IssuedToken, TokenStore
from fastapi.security import HTTPAuthorizationCredentials


class FakeTokens(TokenStore):
    def __init__(self, holders: dict[str, str]) -> None:
        self._holders = holders

    def add(self, client: str) -> str:
        raise NotImplementedError

    def revoke(self, client: str) -> None:
        raise NotImplementedError

    def issued(self) -> list[IssuedToken]:
        raise NotImplementedError

    def client_for(self, token: str) -> str | None:
        return self._holders.get(token)


def _bearer(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


async def test_a_known_token_answers_its_client_and_sets_the_context() -> None:
    context: ContextVar[str] = ContextVar("client")
    scheme = BearerTokenSecurityScheme(FakeTokens({"secret": "phone"}), context)

    assert await scheme.validate_auth(_bearer("secret")) == "phone"
    assert context.get() == "phone"


async def test_no_token_is_refused_as_missing() -> None:
    scheme = BearerTokenSecurityScheme(FakeTokens({}), ContextVar("client"))

    with pytest.raises(AuthenticationFailed) as refusal:
        await scheme.validate_auth(None)

    assert refusal.value.reason == "missing_token"


async def test_an_unknown_token_is_refused_as_bad() -> None:
    scheme = BearerTokenSecurityScheme(FakeTokens({"secret": "phone"}), ContextVar("client"))

    with pytest.raises(AuthenticationFailed) as refusal:
        await scheme.validate_auth(_bearer("forged"))

    assert refusal.value.reason == "bad_token"
