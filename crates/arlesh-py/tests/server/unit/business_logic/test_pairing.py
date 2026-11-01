"""The pairing rules, over in-memory stores and a clock the test moves."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from arlesh.server.business_logic.pairing import (
    MAX_NAME,
    MAX_PENDING,
    MAX_WRONG_ATTEMPTS,
    PIN_LIFETIME,
    Pairing,
    PairingRefused,
    client_name,
)
from arlesh.server.ports.pairing.pairing_store import PairingRequest, PairingStore
from arlesh.server.ports.tokens.token_store import (
    ClientAlreadyHasToken,
    IssuedToken,
    TokenStore,
    UnknownClient,
)


class MemoryPairs(PairingStore):
    def __init__(self) -> None:
        self.rows: dict[str, PairingRequest] = {}

    def create(self, request: PairingRequest) -> bool:
        if request.id_sha256 in self.rows or any(r.pin == request.pin for r in self.rows.values()):
            return False
        self.rows[request.id_sha256] = request
        return True

    def all(self) -> list[PairingRequest]:
        return sorted(self.rows.values(), key=lambda r: r.created)

    def purge_expired(self, now: datetime) -> int:
        gone = [key for key, row in self.rows.items() if row.expires <= now]
        for key in gone:
            del self.rows[key]
        return len(gone)

    def count_attempt(self, id_sha256: str) -> int | None:
        row = self.rows.get(id_sha256)
        if row is None:
            return None
        row.attempts += 1
        return row.attempts

    def approve(self, pin: str, name: str) -> bool:
        for row in self.rows.values():
            if row.pin == pin and row.approved_name is None:
                row.approved_name = name
                return True
        return False

    def delete(self, id_sha256: str) -> bool:
        return self.rows.pop(id_sha256, None) is not None


class MemoryTokens(TokenStore):
    def __init__(self) -> None:
        self.held: dict[str, str] = {}

    def add(self, client: str) -> str:
        if client in self.held:
            raise ClientAlreadyHasToken(client)
        self.held[client] = f"token-for-{client}"
        return self.held[client]

    def revoke(self, client: str) -> None:
        if self.held.pop(client, None) is None:
            raise UnknownClient(client)

    def issued(self) -> list[IssuedToken]:
        return [IssuedToken(client=c, created=datetime(2026, 1, 1)) for c in self.held]

    def client_for(self, token: str) -> str | None:
        return next((c for c, t in self.held.items() if t == token), None)


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 1, 10, 0, 0)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def tokens() -> MemoryTokens:
    return MemoryTokens()


@pytest.fixture
def pairing(clock: Clock, tokens: MemoryTokens) -> Pairing:
    return Pairing(MemoryPairs(), tokens, clock)


def test_a_request_gets_a_six_digit_pin_valid_ten_minutes(pairing: Pairing, clock: Clock) -> None:
    started = pairing.start("Pixel 8")

    assert len(started.pin) == 6
    assert started.pin.isdigit()
    assert started.name == "Pixel-8"
    assert started.expires == clock.now + PIN_LIFETIME


def test_a_name_is_reduced_to_a_client_name() -> None:
    assert client_name("Jan's  MacBook Pro") == "Jan-s-MacBook-Pro"
    assert client_name("   ") == "device"
    assert client_name(None) == "device"
    assert client_name("é") == "device"
    assert len(client_name("x" * 200)) == MAX_NAME


def test_polling_before_approval_is_pending(pairing: Pairing) -> None:
    started = pairing.start("phone")

    assert pairing.poll(started.id, started.pin).status == "pending"


def test_the_token_comes_with_the_poll_after_approval_and_only_once(
    pairing: Pairing, tokens: MemoryTokens
) -> None:
    started = pairing.start("phone")
    assert pairing.approve(started.pin, None) == "phone"

    polled = pairing.poll(started.id, started.pin)

    assert (polled.status, polled.name, polled.token) == ("approved", "phone", "token-for-phone")
    assert tokens.client_for("token-for-phone") == "phone"
    with pytest.raises(PairingRefused) as again:
        pairing.poll(started.id, started.pin)
    assert again.value.reason == "unknown_pairing"


def test_the_approver_can_rename_the_device(pairing: Pairing) -> None:
    started = pairing.start("phone")

    assert pairing.approve(started.pin, "Jan's phone") == "Jan-s-phone"
    assert pairing.poll(started.id, started.pin).name == "Jan-s-phone"


def test_a_name_in_use_gets_a_suffix(pairing: Pairing, tokens: MemoryTokens) -> None:
    tokens.add("phone")
    first, second = pairing.start("phone"), pairing.start("phone")

    assert pairing.approve(first.pin, None) == "phone-2"
    assert pairing.approve(second.pin, None) == "phone-3"
    assert pairing.poll(first.id, first.pin).name == "phone-2"
    assert pairing.poll(second.id, second.pin).name == "phone-3"


def test_names_clash_regardless_of_case(pairing: Pairing, tokens: MemoryTokens) -> None:
    tokens.add("Phone")

    assert pairing.approve(pairing.start("phone").pin, None) == "phone-2"


def test_a_name_taken_between_approval_and_the_poll_is_suffixed_then(
    pairing: Pairing, tokens: MemoryTokens
) -> None:
    started = pairing.start("phone")
    pairing.approve(started.pin, None)
    tokens.add("phone")

    assert pairing.poll(started.id, started.pin).name == "phone-2"


def test_a_pin_lapses_after_ten_minutes(pairing: Pairing, clock: Clock) -> None:
    started = pairing.start("phone")
    clock.now += PIN_LIFETIME

    with pytest.raises(PairingRefused) as late:
        pairing.poll(started.id, started.pin)
    assert late.value.reason == "unknown_pairing"
    with pytest.raises(PairingRefused):
        pairing.approve(started.pin, None)


def test_an_approved_pin_that_is_never_claimed_lapses_too(pairing: Pairing, clock: Clock) -> None:
    started = pairing.start("phone")
    pairing.approve(started.pin, None)
    clock.now += PIN_LIFETIME + timedelta(seconds=1)

    with pytest.raises(PairingRefused):
        pairing.poll(started.id, started.pin)


def test_an_expired_request_is_purged(clock: Clock, tokens: MemoryTokens) -> None:
    pairs = MemoryPairs()
    pairing = Pairing(pairs, tokens, clock)
    pairing.start("phone")
    clock.now += PIN_LIFETIME

    assert pairing.pending() == []
    assert pairs.rows == {}


def test_wrong_pins_count_and_the_fifth_invalidates_the_request(pairing: Pairing) -> None:
    started = pairing.start("phone")
    wrong = "000000" if started.pin != "000000" else "111111"

    for attempt in range(1, MAX_WRONG_ATTEMPTS):
        with pytest.raises(PairingRefused) as refused:
            pairing.poll(started.id, wrong)
        assert refused.value.reason == "wrong_pin"
        assert refused.value.details == {"remaining": MAX_WRONG_ATTEMPTS - attempt}
    with pytest.raises(PairingRefused) as last:
        pairing.poll(started.id, wrong)
    assert last.value.reason == "pin_invalidated"

    with pytest.raises(PairingRefused) as after:
        pairing.poll(started.id, started.pin)
    assert after.value.reason == "unknown_pairing"
    with pytest.raises(PairingRefused):
        pairing.approve(started.pin, None)


def test_the_right_pin_does_not_reset_the_count(pairing: Pairing) -> None:
    started = pairing.start("phone")
    wrong = "000000" if started.pin != "000000" else "111111"
    for _ in range(MAX_WRONG_ATTEMPTS - 1):
        with pytest.raises(PairingRefused):
            pairing.poll(started.id, wrong)

    assert pairing.poll(started.id, started.pin).status == "pending"
    with pytest.raises(PairingRefused) as refused:
        pairing.poll(started.id, wrong)
    assert refused.value.reason == "pin_invalidated"


def test_an_unknown_id_is_unknown_whatever_the_pin(pairing: Pairing) -> None:
    started = pairing.start("phone")

    with pytest.raises(PairingRefused) as refused:
        pairing.poll("not-the-id", started.pin)
    assert refused.value.reason == "unknown_pairing"


def test_a_pin_is_approved_once(pairing: Pairing) -> None:
    started = pairing.start("phone")
    pairing.approve(started.pin, None)

    with pytest.raises(PairingRefused) as refused:
        pairing.approve(started.pin, "other")
    assert refused.value.reason == "unknown_pin"


def test_pending_lists_only_requests_not_yet_approved(pairing: Pairing) -> None:
    waiting, approved = pairing.start("tablet"), pairing.start("phone")
    pairing.approve(approved.pin, None)

    assert [p.pin for p in pairing.pending()] == [waiting.pin]
    assert pairing.lookup(waiting.pin).name == "tablet"


def test_only_so_many_requests_wait_at_once(pairing: Pairing) -> None:
    for _ in range(MAX_PENDING):
        pairing.start("phone")

    with pytest.raises(PairingRefused) as refused:
        pairing.start("phone")
    assert refused.value.reason == "too_many_pending"


def test_a_pin_still_free_is_found_when_the_first_draw_collides(
    pairing: Pairing, monkeypatch: pytest.MonkeyPatch
) -> None:
    draws = iter([5, 5, 7])
    monkeypatch.setattr(
        "arlesh.server.business_logic.pairing.secrets.randbelow", lambda _: next(draws)
    )
    first = pairing.start("a")

    second = pairing.start("b")

    assert (first.pin, second.pin) == ("000005", "000007")
