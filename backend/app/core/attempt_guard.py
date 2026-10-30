"""
Atomic brute-force protection for the three secrets that guard a customer's money:
the login password, the 4-digit payment PIN and the withdrawal password.

WHY THIS EXISTS (security finding S-01)
---------------------------------------
The old code read the failure counter into Python, added one, and wrote it back
(`user.failed_attempts += 1`). With no row lock, an attacker who fires 100 guesses
IN PARALLEL makes every request read the same starting value, so 100 wrong guesses
were counted as ONE. For a 4-digit PIN (10,000 possibilities) that turns a "5 tries
then lock" rule into a brute-force that finishes in seconds.

The fix is to RESERVE an attempt before the secret is checked, with a single atomic
UPDATE ... RETURNING. The database hands every parallel request a different number
(1, 2, 3 ...). Only the first MAX numbers are allowed to actually test a secret; the
rest are refused outright. So no matter how many requests arrive at once, at most
MAX real guesses are ever evaluated before the account locks.

Flow for a caller:
    n = await reserve(db, user_id, GUARD)        # raises AttemptLocked if locked / over the limit
    ... check the secret ...
    wrong  -> await register_failure(db, user_id, GUARD, n)   # always commits; returns Outcome
    right  -> await clear(db, user_id, GUARD)
    other error (service down) -> await release(db, user_id, GUARD)
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings


class AttemptLocked(Exception):
    """The account is locked for this secret (or the attempt limit was just exceeded)."""

    def __init__(self, until: datetime, level: int = 0):
        super().__init__(f"locked until {until.isoformat()}")
        self.until = until
        self.level = level

    def minutes_left(self) -> int:
        return max(1, int((self.until - datetime.now(timezone.utc)).total_seconds() // 60))


@dataclass(frozen=True)
class Guard:
    count_col: str
    lock_col: str
    level_col: str | None = None   # only the login lockout escalates


# Column names are fixed constants here — never taken from a request — so building the
# SQL text with them is safe.
LOGIN = Guard("login_failed_attempts", "login_locked_until", "login_lockout_level")
PIN = Guard("pin_failed_attempts", "pin_locked_until")
WITHDRAWAL = Guard("withdrawal_password_failed_attempts", "withdrawal_password_locked_until")


@dataclass(frozen=True)
class Outcome:
    locked: bool
    attempts_left: int          # 0 once locked
    until: datetime | None = None
    level: int = 0


def _max_attempts() -> int:
    return get_settings().MAX_LOGIN_ATTEMPTS


def _lock_duration(guard: Guard, level_before: int) -> timedelta:
    s = get_settings()
    if guard is LOGIN:
        return timedelta(hours=s.LOGIN_LOCKOUT_INITIAL_HOURS if level_before == 0 else s.LOGIN_LOCKOUT_ESCALATED_HOURS)
    return timedelta(minutes=s.LOCKOUT_MINUTES)


def _aware(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _apply_lock(db: AsyncSession, user_id, guard: Guard) -> AttemptLocked:
    """Lock now: reset the counter, set the expiry, escalate the level. One atomic statement."""
    now = datetime.now(timezone.utc)
    level_sel = f", {guard.level_col}" if guard.level_col else ""
    row = (await db.execute(text(f"SELECT 1{level_sel} FROM users WHERE id = :id"), {"id": str(user_id)})).first()
    level_before = int(row[1]) if (row and guard.level_col) else 0
    until = now + _lock_duration(guard, level_before)
    level_set = f", {guard.level_col} = {guard.level_col} + 1" if guard.level_col else ""
    await db.execute(
        text(f"UPDATE users SET {guard.count_col} = 0, {guard.lock_col} = :until{level_set} WHERE id = :id"),
        {"until": until, "id": str(user_id)},
    )
    await db.commit()
    return AttemptLocked(until, level_before + 1 if guard.level_col else 0)


async def reserve(db: AsyncSession, user_id, guard: Guard) -> int:
    """Atomically take the next attempt number. Raises AttemptLocked when locked or over the limit."""
    now = datetime.now(timezone.utc)
    res = await db.execute(
        text(
            f"UPDATE users SET {guard.count_col} = COALESCE({guard.count_col}, 0) + 1 "
            f"WHERE id = :id AND ({guard.lock_col} IS NULL OR {guard.lock_col} <= :now) "
            f"RETURNING {guard.count_col}"
        ),
        {"id": str(user_id), "now": now},
    )
    row = res.first()
    if row is None:
        # Either still locked or no such user. Report the lock if there is one.
        lk = (await db.execute(text(f"SELECT {guard.lock_col} FROM users WHERE id = :id"), {"id": str(user_id)})).first()
        until = _aware(lk[0]) if lk else None
        await db.commit()
        if until and until > now:
            raise AttemptLocked(until)
        raise AttemptLocked(now + timedelta(minutes=1))
    n = int(row[0])
    await db.commit()   # the reservation must survive even if the request later errors
    if n > _max_attempts():
        # More guesses are in flight than the limit allows: someone is hammering. Lock now.
        raise await _apply_lock(db, user_id, guard)
    return n


async def register_failure(db: AsyncSession, user_id, guard: Guard, n: int) -> Outcome:
    """Call after a WRONG secret. Locks on the final allowed attempt. Always commits."""
    limit = _max_attempts()
    if n >= limit:
        locked = await _apply_lock(db, user_id, guard)
        return Outcome(True, 0, locked.until, locked.level)
    await db.commit()
    return Outcome(False, max(0, limit - n))


async def clear(db: AsyncSession, user_id, guard: Guard) -> None:
    """Call after the RIGHT secret: forget earlier failures."""
    await db.execute(
        text(f"UPDATE users SET {guard.count_col} = 0, {guard.lock_col} = NULL WHERE id = :id"),
        {"id": str(user_id)},
    )
    await db.commit()


async def release(db: AsyncSession, user_id, guard: Guard) -> None:
    """Give an attempt back when the check never really happened (e.g. the auth service was down)."""
    await db.execute(
        text(f"UPDATE users SET {guard.count_col} = CASE WHEN {guard.count_col} > 0 THEN {guard.count_col} - 1 ELSE 0 END WHERE id = :id"),
        {"id": str(user_id)},
    )
    await db.commit()
