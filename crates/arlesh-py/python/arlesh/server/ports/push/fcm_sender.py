"""Sending through Firebase Cloud Messaging's HTTP v1 API, as a service account.

The server is told its service account with ``ARLESH_FCM_CREDENTIALS_FILE`` (the JSON a Firebase
project issues). An OAuth access token is minted from it with a signed JWT (the two-legged flow,
scope ``firebase.messaging``) and reused until a minute before it expires. Every message is a
**data** message: the app's own service builds the notification, so the channel and the tap are
the app's.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx
import jwt
from loguru import logger
from pydantic import BaseModel, ValidationError

from arlesh.server.ports.push.push_sender import Delivery, PushSender
from arlesh.server.ports.push.push_store import PushEvent

SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"
SEND_URL = "https://fcm.googleapis.com/v1/projects/{project}/messages:send"
GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer"
JWT_LIFETIME_SECONDS = 3600
RENEW_BEFORE_SECONDS = 60
TIMEOUT_SECONDS = 15.0


class CredentialsError(ValueError):
    """The credentials file cannot be used to send."""


class ServiceAccount(BaseModel):
    """The parts of a Firebase service-account key the sender uses."""

    project_id: str
    client_email: str
    private_key: str
    token_uri: str = DEFAULT_TOKEN_URI

    @classmethod
    def read(cls, path: Path) -> ServiceAccount:
        """The service account in the JSON file at ``path``. Raises :class:`CredentialsError`
        when it cannot be read or is not a service-account key."""
        try:
            return cls.model_validate(json.loads(path.read_text()))
        except OSError as error:
            raise CredentialsError(f"cannot read {path}: {error.strerror}") from None
        except (json.JSONDecodeError, ValidationError):
            raise CredentialsError(
                f"{path} is not a service-account key (project_id, client_email, private_key)"
            ) from None


class FcmSender(PushSender):
    """Sends through FCM HTTP v1 as ``account``."""

    def __init__(self, account: ServiceAccount, http: httpx.AsyncClient | None = None) -> None:
        self._account = account
        self._http = http if http is not None else httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
        self._access: tuple[str, float] | None = None

    @property
    def project_id(self) -> str:
        return self._account.project_id

    async def aclose(self) -> None:
        await self._http.aclose()

    async def send(self, fcm_token: str, event: PushEvent) -> Delivery:
        try:
            access = await self._access_token()
            response = await self._http.post(
                SEND_URL.format(project=self._account.project_id),
                headers={"Authorization": f"Bearer {access}"},
                json=_message(fcm_token, event),
            )
        except (httpx.HTTPError, jwt.PyJWTError, OSError, KeyError, ValueError) as error:
            logger.warning("A push could not be sent", reason=repr(error))
            return Delivery.failed
        return self._delivery(response)

    def _delivery(self, response: httpx.Response) -> Delivery:
        if response.is_success:
            return Delivery.accepted
        status = _status(response)
        if response.status_code == 404 or status in {"UNREGISTERED", "INVALID_ARGUMENT"}:
            return Delivery.unregistered
        if response.status_code in (401, 403):
            self._access = None
        logger.warning("FCM refused a push", http=response.status_code, status=status)
        return Delivery.failed

    async def _access_token(self) -> str:
        now = time.time()
        if self._access is not None and now < self._access[1] - RENEW_BEFORE_SECONDS:
            return self._access[0]
        assertion = jwt.encode(
            {
                "iss": self._account.client_email,
                "scope": SCOPE,
                "aud": self._account.token_uri,
                "iat": int(now),
                "exp": int(now) + JWT_LIFETIME_SECONDS,
            },
            self._account.private_key,
            algorithm="RS256",
        )
        response = await self._http.post(
            self._account.token_uri, data={"grant_type": GRANT, "assertion": assertion}
        )
        response.raise_for_status()
        body = response.json()
        token = str(body["access_token"])
        self._access = (token, now + float(body.get("expires_in", JWT_LIFETIME_SECONDS)))
        return token


def _message(fcm_token: str, event: PushEvent) -> dict[str, Any]:
    return {
        "message": {
            "token": fcm_token,
            "data": event.data(),
            # High priority is what lets a data message reach a phone in Doze.
            "android": {"priority": "HIGH"},
        }
    }


def _status(response: httpx.Response) -> str | None:
    try:
        error = response.json().get("error", {})
        details = error.get("details") or []
        for detail in details:
            if isinstance(detail, dict) and detail.get("errorCode"):
                return str(detail["errorCode"])
        return str(error["status"]) if "status" in error else None
    except (ValueError, AttributeError):
        return None
