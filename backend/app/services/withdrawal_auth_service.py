"""
Withdrawal-password verification with brute-force lockout — finding #7:
MAX_LOGIN_ATTEMPTS / LOCKOUT_MINUTES were defined in config.py but never
referenced anywhere. This wires them to the one place in the app that
actually checks a password server-side (the withdrawal password;
the main login password is Supabase Auth's own concern).
"""
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import attempt_guard
from app.core.attempt_guard import AttemptLocked
from app.core.config import get_settings
from app.core.security import verify_withdrawal_password_async
from app.models.user import User

settings = get_settings()


async def check_withdrawal_password(db: AsyncSession, user: User, plain_password: str) -> None:
    """Raises HTTPException on lockout or wrong password; returns normally on success.

    Re-fetches `user` fresh from the DB by id rather than trusting the object passed in — current_user may be
    served from the request-cache in dependencies.py, which deliberately never caches the hash or the lockout
    counters. Brute-force safe: the attempt is reserved atomically BEFORE the password is compared
    (core/attempt_guard.py), so parallel guesses can no longer be counted as one."""
    user = await db.get(User, user.id)
    now = datetime.now(timezone.utc)
    label = "withdrawal password"

    if user.withdrawal_password_locked_until and user.withdrawal_password_locked_until > now:
        minutes_left = max(1, int((user.withdrawal_password_locked_until - now).total_seconds() / 60))
        raise HTTPException(
            status_code=429,
            detail=f"Too many incorrect attempts. Try again in {minutes_left} minute(s).",
        )

    if not user.withdrawal_password_hash:
        raise HTTPException(status_code=428, detail="Set up withdrawal password")

    try:
        n = await attempt_guard.reserve(db, user.id, attempt_guard.WITHDRAWAL)
    except AttemptLocked as e:
        raise HTTPException(status_code=429, detail=f"Too many incorrect attempts. Try again in {e.minutes_left()} minute(s).")

    if await verify_withdrawal_password_async(plain_password, user.withdrawal_password_hash):
        await attempt_guard.clear(db, user.id, attempt_guard.WITHDRAWAL)
        return

    out = await attempt_guard.register_failure(db, user.id, attempt_guard.WITHDRAWAL, n)
    if out.locked:
        raise HTTPException(
            status_code=429,
            detail=f"Too many incorrect attempts. Try again in {settings.LOCKOUT_MINUTES} minute(s).",
        )
    raise HTTPException(status_code=401, detail=f"Incorrect {label}")
