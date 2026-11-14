"""The FCM sender: the OAuth exchange, the HTTP v1 message and how FCM's answers are read."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import jwt
import pytest
from arlesh.server.ports.push.fcm_sender import (
    CredentialsError,
    FcmSender,
    ServiceAccount,
)
from arlesh.server.ports.push.push_sender import Delivery
from arlesh.server.ports.push.push_store import Channel, PushEvent
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


@pytest.fixture(scope="module")
def keys() -> tuple[str, str]:
    """A private key (PEM) and its public key (PEM)."""
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return pem, public.decode()


@pytest.fixture
def account(keys: tuple[str, str]) -> ServiceAccount:
    return ServiceAccount(
        project_id="control-7457b",
        client_email="push@control-7457b.iam.gserviceaccount.com",
        private_key=keys[0],
    )


EVENT = PushEvent(
    key="question:7",
    value="",
    channel=Channel.agent_question,
    task="task-3",
    title="Pick a name",
)


class Google:
    """A fake Google: the token endpoint and FCM."""

    def __init__(self, fcm: httpx.Response | None = None) -> None:
        self.requests: list[httpx.Request] = []
        self.fcm = fcm or httpx.Response(200, json={"name": "projects/p/messages/1"})
        self.tokens_minted = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "oauth2.googleapis.com":
            self.tokens_minted += 1
            return httpx.Response(200, json={"access_token": "ya29.token", "expires_in": 3600})
        return self.fcm


def sender(account: ServiceAccount, google: Google) -> FcmSender:
    return FcmSender(account, httpx.AsyncClient(transport=httpx.MockTransport(google)))


async def test_a_message_is_a_high_priority_data_message_with_a_signed_in_token(
    account: ServiceAccount, keys: tuple[str, str]
) -> None:
    google = Google()

    delivery = await sender(account, google).send("device-token", EVENT)

    assert delivery is Delivery.accepted
    oauth, fcm = google.requests
    form = parse_qs(oauth.content.decode())
    claims = jwt.decode(
        form["assertion"][0], keys[1], algorithms=["RS256"], audience=account.token_uri
    )
    assert claims["iss"] == account.client_email
    assert claims["scope"] == "https://www.googleapis.com/auth/firebase.messaging"
    assert str(fcm.url) == "https://fcm.googleapis.com/v1/projects/control-7457b/messages:send"
    assert fcm.headers["Authorization"] == "Bearer ya29.token"
    assert json.loads(fcm.content) == {
        "message": {
            "token": "device-token",
            "data": {
                "channel": "agent_question",
                "tag": "question:7",
                "task": "task-3",
                "title": "Pick a name",
            },
            "android": {"priority": "HIGH"},
        }
    }


async def test_the_access_token_is_reused_until_it_nears_its_end(account: ServiceAccount) -> None:
    google = Google()
    fcm = sender(account, google)

    await fcm.send("a", EVENT)
    await fcm.send("b", EVENT)

    assert google.tokens_minted == 1


@pytest.mark.parametrize(
    ("response", "delivery"),
    [
        (httpx.Response(404, json={"error": {"status": "NOT_FOUND"}}), Delivery.unregistered),
        (
            httpx.Response(
                404,
                json={"error": {"status": "NOT_FOUND", "details": [{"errorCode": "UNREGISTERED"}]}},
            ),
            Delivery.unregistered,
        ),
        (
            httpx.Response(400, json={"error": {"status": "INVALID_ARGUMENT"}}),
            Delivery.unregistered,
        ),
        (httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}}), Delivery.failed),
        (httpx.Response(429, text="slow down"), Delivery.failed),
        (httpx.Response(403, json={"error": {"status": "PERMISSION_DENIED"}}), Delivery.failed),
    ],
)
async def test_fcms_answer_is_read_as_a_delivery(
    account: ServiceAccount, response: httpx.Response, delivery: Delivery
) -> None:
    assert await sender(account, Google(fcm=response)).send("t", EVENT) is delivery


async def test_a_network_failure_is_a_failed_delivery_not_a_crash(account: ServiceAccount) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    fcm = FcmSender(account, httpx.AsyncClient(transport=httpx.MockTransport(down)))

    assert await fcm.send("t", EVENT) is Delivery.failed


def test_a_service_account_is_read_from_its_file(tmp_path: Path, account: ServiceAccount) -> None:
    file = tmp_path / "fcm.json"
    file.write_text(json.dumps({**account.model_dump(), "type": "service_account"}))

    assert ServiceAccount.read(file) == account


@pytest.mark.parametrize("content", [None, "not json", json.dumps({"project_id": "p"})])
def test_a_file_that_is_not_a_service_account_is_refused(
    tmp_path: Path, content: str | None
) -> None:
    file = tmp_path / "fcm.json"
    if content is not None:
        file.write_text(content)

    with pytest.raises(CredentialsError):
        ServiceAccount.read(file)


def test_the_event_data_leaves_out_what_it_does_not_have() -> None:
    lock = PushEvent(key="capacity", value="locked", channel=Channel.capacity_locked)

    assert lock.data() == {"channel": "capacity_locked", "tag": "capacity"}
