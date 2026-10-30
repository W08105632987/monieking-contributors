"""Brute-force lockout must hold even when guesses arrive in parallel (finding S-01)."""
import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core import attempt_guard as ag

UID = str(uuid.uuid4())


@pytest_asyncio.fixture
async def maker(tmp_path):
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp_path/'t.db'}", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with eng.begin() as c:
        await c.execute(text(
            "CREATE TABLE users (id TEXT PRIMARY KEY, login_failed_attempts INT DEFAULT 0, login_locked_until TIMESTAMP, "
            "login_lockout_level INT DEFAULT 0, pin_failed_attempts INT DEFAULT 0, pin_locked_until TIMESTAMP, "
            "withdrawal_password_failed_attempts INT DEFAULT 0, withdrawal_password_locked_until TIMESTAMP)"))
        await c.execute(text("INSERT INTO users (id) VALUES (:i)"), {"i": UID})
    yield async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    await eng.dispose()


async def _guess(maker, guard, secret_ok=False):
    """One guess = one request = its own session. Returns 'locked', 'wrong' or 'ok'."""
    async with maker() as db:
        try:
            n = await ag.reserve(db, UID, guard)
        except ag.AttemptLocked:
            return "locked"
        if secret_ok:
            await ag.clear(db, UID, guard)
            return "ok"
        await ag.register_failure(db, UID, guard, n)
        return "wrong"


@pytest.mark.asyncio
@pytest.mark.parametrize("guard", [ag.LOGIN, ag.PIN, ag.WITHDRAWAL])
async def test_100_parallel_guesses_only_evaluate_the_limit(maker, guard):
    results = await asyncio.gather(*[_guess(maker, guard) for _ in range(100)])
    # Old behaviour: all 100 evaluated. Now at most MAX_LOGIN_ATTEMPTS (5) ever reach the secret check.
    assert results.count("wrong") <= 5
    assert results.count("locked") >= 95


@pytest.mark.asyncio
async def test_sequential_five_wrong_then_locked(maker):
    for _ in range(5):
        assert await _guess(maker, ag.PIN) == "wrong"
    assert await _guess(maker, ag.PIN) == "locked"
    assert await _guess(maker, ag.PIN, secret_ok=True) == "locked"   # right PIN is refused during the lock


@pytest.mark.asyncio
async def test_success_clears_counter(maker):
    for _ in range(3):
        await _guess(maker, ag.WITHDRAWAL)
    assert await _guess(maker, ag.WITHDRAWAL, secret_ok=True) == "ok"
    for _ in range(4):
        assert await _guess(maker, ag.WITHDRAWAL) == "wrong"   # counter restarted from zero


@pytest.mark.asyncio
async def test_login_lock_escalates_and_release_gives_attempt_back(maker):
    async with maker() as db:
        n = await ag.reserve(db, UID, ag.LOGIN)
        await ag.release(db, UID, ag.LOGIN)
        assert (await db.execute(text("SELECT login_failed_attempts FROM users"))).scalar_one() == 0
    for _ in range(5):
        await _guess(maker, ag.LOGIN)
    async with maker() as db:
        assert (await db.execute(text("SELECT login_lockout_level FROM users"))).scalar_one() == 1
