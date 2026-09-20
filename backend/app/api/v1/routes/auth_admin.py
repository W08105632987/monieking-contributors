"""
Admin CRM authentication — a separate login flow from /auth/login,
deliberately: this is the platform's most powerful surface (every
customer, every officer, every director, every zone, financial
reconciliation), so it gets a second factor on every login, not just
the first device the way most "trusted device" 2FA works elsewhere.

Flow:
  1. POST /auth/admin/login       — phone + password. On success, does
     NOT set the session cookie yet. Instead sends a 6-digit SMS OTP
     and returns a short-lived `pending_id`. The real Supabase session
     tokens are held server-side in Redis against that pending_id —
     they never reach the browser until step 2 succeeds, so there's no
     window where a stolen "step 1 succeeded" response is itself
     enough to get in.
  2. POST /auth/admin/verify-otp  — pending_id + the 6-digit code. On
     success, sets the real session cookies (same ones /auth/login
     uses) and the admin is in.

Reuses the same password verification, lockout, and cookie machinery
as the mobile app's /auth/login — this is a different DOOR, not a
different lock.
"""
import json
import secrets
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.core.cookies import set_session_cookies
from app.core.redis_client import get_redis
from app.core.limiter import limiter
from app.models.user import User, UserRole, UserStatus
from app.services.login_service import (
    phone_to_email_alias, check_not_locked, record_failure, record_success, password_grant,
)
from app.services.user_service import build_user_response
from app.integrations.termii import send_sms
from fastapi import Request

settings = get_settings()
router = APIRouter(prefix="/auth/admin", tags=["admin-auth"])

OTP_TTL_SECONDS = 5 * 60
MAX_OTP_ATTEMPTS = 5
REDIS_KEY_PREFIX = "admin_2fa_pending"


class AdminLoginRequest(BaseModel):
    phone_number: str
    password: str


class AdminVerifyOtpRequest(BaseModel):
    pending_id: str
    otp: str = Field(..., min_length=6, max_length=6)


def _generic_credentials_error() -> HTTPException:
    # Same phrasing regardless of whether the phone number doesn't
    # exist, isn't an admin, or the password is wrong — confirming any
    # one of those independently is its own information leak on the
    # platform's highest-privilege login surface.
    return HTTPException(status_code=401, detail={
        "code": "WRONG_CREDENTIALS", "message": "Incorrect phone number or password.",
    })


@router.post("/login")
@limiter.limit("10/minute")
async def admin_login(
    request: Request,
    body: AdminLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.phone_number == body.phone_number))
    user = result.scalar_one_or_none()
    if not user or user.role not in (UserRole.ADMIN, UserRole.DIRECTOR):
        raise _generic_credentials_error()

    if user.status == UserStatus.SUSPENDED:
        raise HTTPException(status_code=403, detail="Account is suspended")

    check_not_locked(user)

    try:
        session = await password_grant(phone_to_email_alias(body.phone_number), body.password)
    except HTTPException as e:
        if isinstance(e.detail, dict) and e.detail.get("code") == "WRONG_PASSWORD":
            await record_failure(db, user)  # always raises
        raise
    await record_success(db, user)

    # Generate and store the OTP (hashed, same as every other OTP in
    # this app — see login_password_reset_otp_hash for the pattern).
    otp = f"{secrets.randbelow(1_000_000):06d}"
    user.two_factor_otp_hash = hash_password(otp)
    user.two_factor_otp_expires_at = datetime.now(timezone.utc) + timedelta(seconds=OTP_TTL_SECONDS)
    await db.commit()

    # Hold the real Supabase session server-side until the OTP is
    # confirmed — the browser gets a pending_id, never the tokens.
    pending_id = secrets.token_urlsafe(24)
    redis = get_redis()
    await redis.set(
        f"{REDIS_KEY_PREFIX}:{pending_id}",
        json.dumps({
            "user_id": str(user.id),
            "access_token": session["access_token"],
            "refresh_token": session.get("refresh_token"),
        }),
        ex=OTP_TTL_SECONDS,
    )
    await redis.set(f"{REDIS_KEY_PREFIX}:{pending_id}:attempts", 0, ex=OTP_TTL_SECONDS)

    try:
        await send_sms(user.phone_number, f"Your MonieKing admin login code is {otp}. Expires in 5 minutes. Don't share this with anyone.")
    except Exception as e:
        print(f"[admin-2fa] SMS send failed (non-fatal — OTP is still valid, user can request a new one if it never arrives): {e}")

    return {"pending_id": pending_id, "message": "Enter the 6-digit code sent to your phone."}


@router.post("/verify-otp")
@limiter.limit("10/minute")
async def admin_verify_otp(
    request: Request,
    response: Response,
    body: AdminVerifyOtpRequest,
    db: AsyncSession = Depends(get_db),
):
    redis = get_redis()
    session_key = f"{REDIS_KEY_PREFIX}:{body.pending_id}"
    attempts_key = f"{session_key}:attempts"

    raw = await redis.get(session_key)
    if not raw:
        raise HTTPException(status_code=401, detail="This login attempt has expired. Please log in again.")

    attempts = int(await redis.get(attempts_key) or 0)
    if attempts >= MAX_OTP_ATTEMPTS:
        await redis.delete(session_key, attempts_key)
        raise HTTPException(status_code=401, detail="Too many wrong codes. Please log in again.")

    pending = json.loads(raw)
    result = await db.execute(select(User).where(User.id == uuid.UUID(pending["user_id"])))
    user = result.scalar_one_or_none()

    otp_valid = (
        user is not None
        and user.two_factor_otp_hash
        and user.two_factor_otp_expires_at
        and user.two_factor_otp_expires_at > datetime.now(timezone.utc)
        and verify_password(body.otp, user.two_factor_otp_hash)
    )

    if not otp_valid:
        await redis.incr(attempts_key)
        raise HTTPException(status_code=401, detail={
            "code": "WRONG_OTP", "message": "Incorrect or expired code.",
        })

    # Success — clear the OTP (single use), drop the pending Redis
    # entry, and hand over the real session exactly like /auth/login.
    user.two_factor_otp_hash = None
    user.two_factor_otp_expires_at = None
    await db.commit()
    await redis.delete(session_key, attempts_key)

    set_session_cookies(response, pending["access_token"], pending.get("refresh_token"))
    return await build_user_response(db, user)
