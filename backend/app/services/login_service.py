"""
Backend-mediated login — Phase 1 of the cookie-session migration.

Previously the frontend called Supabase Auth directly from the browser,
so failed login attempts were invisible to this backend and impossible
to lock out server-side (a malicious client could just keep hitting
Supabase directly, no matter what the UI showed). This service makes
this backend the only thing that ever exchanges a password for a
session — it still uses Supabase's own password verification (we are
not reimplementing password hashing), but every attempt, success or
failure, is now visible to us and the escalating lockout below is
enforced authoritatively in our own database, not just in the UI.

Escalation rule (see 010_login_lockout.sql):
  attempts 1-3 wrong  → normal error
  attempt 4 wrong     → normal error + a warning that 1 more locks the account
  attempt 5 wrong     → locked. 1 hour if this is the first time being
                         locked (login_lockout_level == 0), 3 hours for
                         every time after that.
  successful login    → failed_attempts resets to 0 (lockout_level is
                         NOT reset — a repeat offender doesn't get an
                         infinite string of lenient 1-hour locks).
"""
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.user import User
from app.utils.supabase_admin_client import supabase_admin_request

settings = get_settings()


def phone_to_email_alias(phone_number: str) -> str:
    return f"{phone_number.replace(' ', '')}@monieking.app"


def _lockout_hours_for(user: User) -> float:
    return (
        settings.LOGIN_LOCKOUT_INITIAL_HOURS
        if user.login_lockout_level == 0
        else settings.LOGIN_LOCKOUT_ESCALATED_HOURS
    )


def check_not_locked(user: User) -> None:
    """Raises before we even attempt Supabase auth, if still locked."""
    if user.login_locked_until and user.login_locked_until > datetime.now(timezone.utc):
        remaining = user.login_locked_until - datetime.now(timezone.utc)
        minutes = max(1, int(remaining.total_seconds() // 60))
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "code": "ACCOUNT_LOCKED",
                "message": f"Too many wrong attempts. Try again in {minutes} minute(s).",
                "locked_until": user.login_locked_until.isoformat(),
            },
        )


async def record_failure(db: AsyncSession, user: User) -> None:
    """Increments the failure count and locks the account on the 5th.

    Commits explicitly (not just flush) before each raise below — this
    function always raises an HTTPException by design, and get_db's
    commit-only-on-clean-completion pattern rolls back the transaction
    whenever one propagates. Without an explicit commit here, every
    failed-attempt increment was being silently undone the instant the
    exception left this function, so the count could never actually
    reach MAX_LOGIN_ATTEMPTS — it just kept resetting to where it
    started before each attempt.
    """
    user.login_failed_attempts += 1

    if user.login_failed_attempts >= settings.MAX_LOGIN_ATTEMPTS:
        hours = _lockout_hours_for(user)
        user.login_locked_until = datetime.now(timezone.utc) + timedelta(hours=hours)
        user.login_lockout_level += 1
        user.login_failed_attempts = 0
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "code": "ACCOUNT_LOCKED",
                "message": f"Too many wrong attempts. Your account is locked for {hours:g} hour(s).",
                "locked_until": user.login_locked_until.isoformat(),
            },
        )

    await db.commit()

    if user.login_failed_attempts == settings.MAX_LOGIN_ATTEMPTS - 1:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "WRONG_PASSWORD_WARNING",
                "message": "Incorrect password. One more wrong attempt will lock your account for 1 hour.",
            },
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "WRONG_PASSWORD", "message": "Incorrect phone number or password."},
    )


async def record_success(db: AsyncSession, user: User) -> None:
    user.login_failed_attempts = 0
    user.login_locked_until = None
    await db.flush()


async def password_grant(email: str, password: str) -> dict:
    """
    Exchanges email+password for a Supabase session, server-side. Raises
    HTTPException(401) specifically for wrong credentials so the caller
    can distinguish that from a genuine Supabase outage (which
    supabase_admin_request already turns into a 502/503/504).
    """
    try:
        resp = await supabase_admin_request(
            "POST",
            "/auth/v1/token?grant_type=password",
            json={"email": email, "password": password},
            ok_statuses=(200,),
            failure_detail="Could not sign you in right now. Please try again.",
        )
    except HTTPException as e:
        print(f"[AUTH_ERROR] password_grant failed for {email}: status={e.status_code}, detail={e.detail}", flush=True)
        if e.status_code == status.HTTP_400_BAD_REQUEST:
            # Supabase's standard "invalid_grant" response for a wrong
            # password — this is the one case we translate into "wrong
            # credentials" rather than a service error.
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={
                "code": "WRONG_PASSWORD", "message": "Incorrect phone number or password.",
            })
        raise

    return resp.json()


async def refresh_grant(refresh_token: str) -> dict:
    resp = await supabase_admin_request(
        "POST",
        "/auth/v1/token?grant_type=refresh_token",
        json={"refresh_token": refresh_token},
        ok_statuses=(200,),
        failure_detail="Your session could not be refreshed. Please log in again.",
    )
    return resp.json()
