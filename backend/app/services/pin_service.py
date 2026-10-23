"""The 4-digit payment PIN: one secret for every authorisation in the app except withdrawals (those use the
withdrawal password). Same brute-force lockout as the withdrawal password, tracked separately."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_withdrawal_password, verify_withdrawal_password
from app.models.user import User

settings = get_settings()

# 428 = "a precondition is missing". The app turns this into the "Set up payment pin" prompt.
PIN_NOT_SET = "Set up payment pin"
PASSWORD_NOT_SET = "Set up withdrawal password"
TRIVIAL = {"0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321", "0123", "3210", "1212", "2580"}


def validate_new_pin(pin: str) -> None:
    if not (len(pin) == 4 and pin.isdigit()):
        raise HTTPException(status_code=400, detail="Your PIN must be exactly 4 digits")
    if pin in TRIVIAL:
        raise HTTPException(status_code=400, detail="That PIN is too easy to guess. Pick another.")


async def set_pin(db: AsyncSession, user_id, pin: str) -> None:
    validate_new_pin(pin)
    user = await db.get(User, user_id)
    user.payment_pin_hash = hash_withdrawal_password(pin)
    user.pin_failed_attempts = 0
    user.pin_locked_until = None
    await db.flush()


async def check_pin(db: AsyncSession, user: User, pin: str | None) -> None:
    """Raises on a missing PIN setup (428), lockout (429) or a wrong PIN (401). Returns on success."""
    user = await db.get(User, user.id)   # never trust a cached copy for a security check
    now = datetime.now(timezone.utc)
    if not user.payment_pin_hash:
        raise HTTPException(status_code=428, detail=PIN_NOT_SET)
    if user.pin_locked_until and user.pin_locked_until > now:
        mins = max(1, int((user.pin_locked_until - now).total_seconds() / 60))
        raise HTTPException(status_code=429, detail=f"Too many incorrect attempts. Try again in {mins} minute(s).")
    if not pin:
        raise HTTPException(status_code=400, detail="Enter your PIN to continue")
    if verify_withdrawal_password(str(pin), user.payment_pin_hash):
        user.pin_failed_attempts = 0
        user.pin_locked_until = None
        await db.flush()
        return
    user.pin_failed_attempts += 1
    if user.pin_failed_attempts >= settings.MAX_LOGIN_ATTEMPTS:
        user.pin_locked_until = now + timedelta(minutes=settings.LOCKOUT_MINUTES)
        user.pin_failed_attempts = 0
        await db.commit()
        raise HTTPException(status_code=429, detail=f"Too many incorrect attempts. Try again in {settings.LOCKOUT_MINUTES} minute(s).")
    await db.commit()   # keep the count: the exception below rolls the request back
    raise HTTPException(status_code=403, detail="Incorrect PIN")   # not 401: a 401 would make the app try to refresh the login and retry
