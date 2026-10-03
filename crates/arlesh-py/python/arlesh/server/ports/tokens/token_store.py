"""The token store port: which bearer token stands for which client."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

from pydantic import BaseModel


class IssuedToken(BaseModel):
    """A client a token has been issued to. The token itself is never kept, only its hash."""

    client: str
    created: datetime


class ClientAlreadyHasToken(Exception):
    """``add`` named a client that already holds a token: revoke it first."""

    def __init__(self, client: str) -> None:
        super().__init__(f"{client} already has a token; revoke it first")
        self.client = client


class UnknownClient(Exception):
    """``revoke`` named a client that holds no token."""

    def __init__(self, client: str) -> None:
        super().__init__(f"{client} has no token")
        self.client = client


class TokenStore(ABC):
    """Issues, lists and revokes one bearer token per client, and says whose a token is."""

    @abstractmethod
    def add(self, client: str) -> str:
        """Issues ``client`` a new token and answers it. It is shown this once and never again.

        Raises :class:`ClientAlreadyHasToken` if ``client`` holds one.
        """

    @abstractmethod
    def revoke(self, client: str) -> None:
        """Revokes ``client``'s token. Raises :class:`UnknownClient` if it has none."""

    @abstractmethod
    def issued(self) -> list[IssuedToken]:
        """Every client holding a token, by name."""

    @abstractmethod
    def client_for(self, token: str) -> str | None:
        """The client ``token`` was issued to, or ``None`` for a token nobody holds."""
