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

from app.core.config import get_settings
from app.core.security import verify_withdrawal_password
from app.models.user import User

settings = get_settings()


async def check_withdrawal_password(db: AsyncSession, user: User, plain_password: str) -> None:
    """Raises HTTPException on lockout or wrong password; returns normally on success."""
    now = datetime.now(timezone.utc)

    if user.withdrawal_password_locked_until and user.withdrawal_password_locked_until > now:
        minutes_left = max(1, int((user.withdrawal_password_locked_until - now).total_seconds() / 60))
        raise HTTPException(
            status_code=429,
            detail=f"Too many incorrect attempts. Try again in {minutes_left} minute(s).",
        )

    if not user.withdrawal_password_hash:
        raise HTTPException(status_code=400, detail="No withdrawal password set")

    if verify_withdrawal_password(plain_password, user.withdrawal_password_hash):
        # Success — clear any prior failed attempts
        user.withdrawal_password_failed_attempts = 0
        user.withdrawal_password_locked_until = None
        await db.flush()
        return

    user.withdrawal_password_failed_attempts += 1
    if user.withdrawal_password_failed_attempts >= settings.MAX_LOGIN_ATTEMPTS:
        user.withdrawal_password_locked_until = now + timedelta(minutes=settings.LOCKOUT_MINUTES)
        user.withdrawal_password_failed_attempts = 0
        await db.commit()
        raise HTTPException(
            status_code=429,
            detail=f"Too many incorrect attempts. Try again in {settings.LOCKOUT_MINUTES} minute(s).",
        )

    # Commit here too, not just flush — this always raises next, and
    # get_db rolls back the transaction whenever an exception
    # propagates out of the request. Without this, the increment above
    # would be silently undone every time, and the count could never
    # actually reach MAX_LOGIN_ATTEMPTS (same bug as the login lockout
    # had — see login_service.py for the full explanation).
    await db.commit()
    raise HTTPException(status_code=401, detail="Incorrect withdrawal password")
