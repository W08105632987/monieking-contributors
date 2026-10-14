"""Circuit breaker, one per service (nin, bvn). Pure state transitions; the DB
row is read/written by service.py.

closed ──3 consecutive provider failures──▶ open (customers see "temporarily
unavailable", nobody is charged, directors are alerted once)
open ──5 minutes pass──▶ trial (the screen is allowed to try again; the next
real lookup is the retest). Trial success ▶ closed. Trial failure ▶ open again
with a fresh 5 minute timer (no second alert)."""
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from app.verification.constants import BREAKER_COOLDOWN_SECONDS, BREAKER_THRESHOLD


@dataclass(frozen=True)
class Breaker:
    failures: int = 0
    opened_at: datetime | None = None
    last_reason: str | None = None
    alerted: bool = False

    @property
    def is_open(self) -> bool:
        return self.opened_at is not None


def allows_call(b: Breaker, now: datetime) -> bool:
    """True when closed, or open but past the retest time (trial)."""
    if b.opened_at is None:
        return True
    return now - b.opened_at >= timedelta(seconds=BREAKER_COOLDOWN_SECONDS)


def retry_at(b: Breaker) -> datetime | None:
    if b.opened_at is None:
        return None
    return b.opened_at + timedelta(seconds=BREAKER_COOLDOWN_SECONDS)


def on_success(b: Breaker) -> tuple[Breaker, bool]:
    """Returns (new_state, recovered). `recovered` is True when this success
    closed a previously open breaker."""
    return Breaker(), b.is_open


def on_failure(b: Breaker, now: datetime, reason: str) -> tuple[Breaker, bool]:
    """Returns (new_state, just_tripped). `just_tripped` is True only the first
    time the breaker opens (so directors get one alert, not one per retest)."""
    if b.opened_at is not None:
        # Failed trial: restart the cooldown, keep alert state.
        return replace(b, opened_at=now, failures=b.failures + 1, last_reason=reason), False
    failures = b.failures + 1
    if failures >= BREAKER_THRESHOLD:
        return Breaker(failures=failures, opened_at=now, last_reason=reason, alerted=True), True
    return Breaker(failures=failures, opened_at=None, last_reason=reason, alerted=False), False
