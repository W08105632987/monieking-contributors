"""
Authentication routes.
For MVP: registration works without Supabase Admin SDK.
We use Supabase client directly from the frontend for auth,
and just create the platform user record here on the backend.
"""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.config import settings
from app.core.security import hash_password, hash_withdrawal_password
from app.core.dependencies import CurrentUser
from app.core.security import verify_supabase_jwt
from app.core.limiter import limiter
from app.schemas.auth import LoginRequest
from app.services.login_service import (
    phone_to_email_alias, check_not_locked, record_failure, record_success,
    password_grant, refresh_grant,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.cookies import get_access_cookie

_bearer = HTTPBearer(auto_error=False)

async def get_supabase_uid(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    token = get_access_cookie(request) or (credentials.credentials if credentials else None)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = await verify_supabase_jwt(token)
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token — no subject claim")
    return uid
from app.models.user import User, UserRole, UserStatus
from app.services.wallet_service import get_or_create_wallet
from app.services.user_service import build_user_response
from app.schemas.user import RegisterCustomerRequest, UserResponse
from app.utils.audit import log_action

router = APIRouter(prefix="/auth", tags=["auth"])

# Bump this whenever the Terms of Service or Privacy Policy content
# changes materially — lets you tell who accepted an older version.
# Keep in sync with LEGAL_DOCUMENT_VERSION in
# apps/web/src/pages/legal/*.tsx.
LEGAL_DOCUMENT_VERSION = "2026-09-01"


@router.post("/signup-session")
@limiter.limit("5/minute")
async def signup_session(request: Request, response: Response, body: LoginRequest):
    """
    Sets the session cookie right after the frontend calls
    supabase.auth.signUp() — used ONLY at that exact moment in
    registration, before the platform `users` row exists yet (so
    /auth/login's lockout tracking, which needs an existing row, can't
    run here — there's nothing to brute-force on a phone number that
    isn't registered yet, and this is rate-limited same as everywhere
    else). /auth/register (right after this) relies on the cookie this
    sets to know which authenticated Supabase account to attach the new
    platform user row to.
    """
    email = phone_to_email_alias(body.phone_number)
    session = await password_grant(email, body.password)
    set_session_cookies(response, session["access_token"], session.get("refresh_token"))
    return {"message": "Session started"}


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register_customer(
    request: Request,
    body: RegisterCustomerRequest,
    current_user_id: str = Depends(get_supabase_uid),
    db: AsyncSession = Depends(get_db),
):
    """
    Called AFTER Supabase Auth creates the user on the frontend.
    The frontend sends the Supabase UID via the Authorization header (JWT).
    We create the platform user record and wallet here.
    """
    # Check phone uniqueness
    existing = await db.execute(
        select(User).where(User.phone_number == body.phone_number)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="This phone number is already registered. Please login instead."
        )

    user_id = uuid.UUID(current_user_id)

    # Create platform user
    user = User(
        id=            user_id,
        role=          UserRole.CUSTOMER,
        full_name=     body.full_name,
        phone_number=  body.phone_number,
        bank_name=     body.bank_name,
        bank_code=     body.bank_code,
        account_number=body.account_number,
        account_name=  body.account_name,
        next_of_kin_name=  body.next_of_kin_name,
        next_of_kin_phone= body.next_of_kin_phone,
        status=        UserStatus.ACTIVE,
        login_password_hash=      hash_password(body.password),
        withdrawal_password_hash= hash_withdrawal_password(body.withdrawal_password),
        terms_accepted_at=      datetime.now(timezone.utc),
        terms_accepted_version= LEGAL_DOCUMENT_VERSION,
    )
    db.add(user)

    try:
        await db.flush()
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            raise HTTPException(
                status_code=400,
                detail="This phone number is already registered."
            )
        raise

    # Create wallet AND provision the Monnify virtual account immediately —
    # every signup gets a real, working account number right away, no
    # waiting on KYC. It starts unverified (no BVN/NIN), which per
    # Monnify's rules means it's capped at their limited transaction
    # amount rather than blocked outright. Completing KYC later (see
    # wallets.py, submit_kyc) raises that cap — it doesn't unlock the
    # account's existence, just its limits. Provisioning failure here is
    # non-fatal (logged, not raised) so a Monnify hiccup never blocks
    # registration; the account can be created retroactively.
    wallet = await get_or_create_wallet(db, user.id)
    if settings.MONNIFY_API_KEY:
        try:
            from app.integrations.monnify import get_payment_provider
            provider = get_payment_provider()
            account = await provider.create_reserved_account(
                account_reference= f"MK-CUST-{user.id.hex[:8].upper()}",
                account_name=      user.full_name,
                customer_email=    f"{user.phone_number}@monieking.app",
                customer_name=     user.full_name,
            )
            wallet.virtual_account_number = account.account_number
            wallet.virtual_account_bank   = account.bank_name
            wallet.virtual_account_ref    = account.account_reference
            await db.flush()
        except Exception as e:
            print(f"Monnify VA creation failed (non-fatal): {e}")

    try:
        await log_action(
            db, actor_id=user.id, action="customer.registered",
            entity_type="user", entity_id=str(user.id),
            new_value={"full_name": user.full_name, "phone_number": user.phone_number},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception as e:
        print(f"Audit log failed (non-fatal): {e}")

    return await build_user_response(db, user)


@router.post("/set-withdrawal-password", status_code=200)
async def set_withdrawal_password(
    body: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    password = body.get("withdrawal_password", "")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Withdrawal password must be at least 8 characters")
    if password.isdigit():
        raise HTTPException(status_code=400, detail="Withdrawal password can't be all numbers — add a letter or symbol")
    from app.core.security import hash_withdrawal_password
    # current_user may be the cached (unattached) object — fetch a real
    # session-attached row before mutating, so this actually persists.
    # (withdrawal_password_hash itself is never cached — see
    # _CACHE_EXCLUDE in dependencies.py — so this fetch also gets the
    # accurate up-to-the-second value for the is_change check below.)
    user = await db.get(User, current_user.id)
    # Only a genuine CHANGE (there was already a password) is worth
    # alerting on — first-time setup during registration isn't a
    # security event, there's nothing to protect yet.
    is_change = user.withdrawal_password_hash is not None
    user.withdrawal_password_hash = hash_withdrawal_password(password)
    await db.flush()
    if is_change:
        from app.services.notification_service import send_notification
        from app.models.notification import NotificationType
        await send_notification(
            db, user_id=current_user.id,
            title="Withdrawal password changed",
            body="Your withdrawal password was just changed. If this wasn't you, contact your officer or a director immediately.",
            type=NotificationType.INFO,
        )
    return {"message": "Withdrawal password updated"}


@router.post("/verify-withdrawal-password", status_code=200)
@limiter.limit("10/minute")
async def verify_withdrawal_password_route(
    request: Request,
    body: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    from app.services.withdrawal_auth_service import check_withdrawal_password
    password = body.get("withdrawal_password", "")
    await check_withdrawal_password(db, current_user, password)
    return {"verified": True}


# ── Forgot login password (OTP via SMS) ─────────────────────────────
OTP_TTL_MINUTES = 10


@router.post("/forgot-password/request-otp")
@limiter.limit("3/minute")
async def request_password_reset_otp(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Sends a 6-digit OTP via SMS to reset the login password. Always
    returns the same generic message whether or not the phone number is
    registered — doesn't confirm/deny account existence.
    """
    import secrets
    from datetime import datetime, timezone, timedelta
    from app.integrations.termii import send_sms

    phone_number = body.get("phone_number", "")
    generic_response = {"message": "If that number is registered, an OTP has been sent."}

    result = await db.execute(select(User).where(User.phone_number == phone_number))
    user = result.scalar_one_or_none()
    if not user:
        return generic_response

    otp = f"{secrets.randbelow(1_000_000):06d}"
    user.login_password_reset_otp_hash = hash_password(otp)
    user.login_password_reset_otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)
    await db.flush()

    try:
        await send_sms(phone_number, f"Your MonieKing password reset code is {otp}. Expires in {OTP_TTL_MINUTES} minutes. Don't share this with anyone.")
    except Exception as e:
        # The OTP is already saved and valid — a flaky SMS provider
        # shouldn't turn into a 500 for the user. Log it so it's visible
        # in ops, but still return the generic success response (keeps
        # the "don't reveal if the number exists" behavior intact too).
        print(f"[forgot-password] send_sms failed (non-fatal): {e}")

    return generic_response


@router.post("/forgot-password/reset")
@limiter.limit("5/minute")
async def reset_password_with_otp(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone
    import httpx

    phone_number = body.get("phone_number", "")
    otp          = body.get("otp", "")
    new_password = body.get("new_password", "")

    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    result = await db.execute(select(User).where(User.phone_number == phone_number))
    user = result.scalar_one_or_none()
    if not user or not user.login_password_reset_otp_hash:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    if not user.login_password_reset_otp_expires_at or user.login_password_reset_otp_expires_at < datetime.now(timezone.utc):
        user.login_password_reset_otp_hash = None
        user.login_password_reset_otp_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")

    from app.core.security import verify_password
    if not verify_password(otp, user.login_password_reset_otp_hash):
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    # OTP correct — clear it (single use) and update the real Supabase login password
    user.login_password_reset_otp_hash = None
    user.login_password_reset_otp_expires_at = None
    await db.flush()

    from app.utils.supabase_admin_client import supabase_admin_request

    await supabase_admin_request(
        "PUT",
        f"/auth/v1/admin/users/{user.id}",
        json={"password": new_password},
        failure_detail="Your code was verified, but we couldn't finish updating your password. Please try again in a moment.",
    )

    return {"message": "Password updated. You can now log in with your new password."}


# ── Change login password (authenticated, knows current password) ──
@router.post("/change-password")
@limiter.limit("5/minute")
async def change_login_password(
    request: Request,
    body: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    import httpx

    current_password = body.get("current_password", "")
    new_password      = body.get("new_password", "")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    email = f"{current_user.phone_number}@monieking.app"

    from app.utils.supabase_admin_client import supabase_admin_request, SUPABASE_TIMEOUT

    # Verify the current password by attempting a real sign-in — this is
    # the only reliable way to check it, since Supabase Auth (not our DB)
    # owns the login password. This one isn't routed through
    # supabase_admin_request because a non-200 here means "wrong
    # password" (a normal, expected outcome), not a service failure —
    # but it still needs the same explicit timeout + exception handling
    # so a slow/unreachable Supabase doesn't look like a silent crash.
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
            verify_resp = await client.post(
                f"{settings.SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": settings.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": current_password},
            )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="This is taking longer than expected. Please try again.",
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Could not reach the authentication service. Check your connection and try again.",
        )

    if verify_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    await supabase_admin_request(
        "PUT",
        f"/auth/v1/admin/users/{current_user.id}",
        json={"password": new_password},
        failure_detail="Your current password was verified, but we couldn't finish updating it. Please try again.",
    )

    # Always a genuine change (this endpoint requires knowing the current
    # password, so it's never first-time setup) — worth an immediate
    # alert same as the withdrawal password and bank details above.
    from app.services.notification_service import send_notification
    from app.models.notification import NotificationType
    await send_notification(
        db, user_id=current_user.id,
        title="Login password changed",
        body="Your login password was just changed. If this wasn't you, contact your officer or a director immediately.",
        type=NotificationType.INFO,
    )
    await db.flush()

    return {"message": "Password updated"}


# ── Cookie-session login (Phase 1 of the httpOnly cookie migration) ────
# These are new and additive — the existing Bearer-header flow (frontend
# calling Supabase directly) still works unchanged while the frontend is
# migrated over to these endpoints. Once that migration is done and
# verified, the direct-Supabase login path on the frontend gets removed.
from app.core.cookies import set_session_cookies, clear_session_cookies, get_access_cookie, get_refresh_cookie


@router.post("/login", response_model=UserResponse)
@limiter.limit("10/minute")
async def login(
    request: Request,
    response: Response,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Backend-mediated login. Verifies the password against Supabase Auth
    server-side, enforces the escalating lockout below BEFORE even
    calling Supabase (so a locked account never wastes a real auth call
    or leaks timing information), and on success sets the session as
    httpOnly cookies instead of returning a token to JS.
    """
    result = await db.execute(select(User).where(User.phone_number == body.phone_number))
    user = result.scalar_one_or_none()
    if not user:
        # Deliberately the same generic message as a wrong password —
        # confirming *whether an account exists* is its own information
        # leak on a financial app.
        raise HTTPException(status_code=401, detail={"code": "WRONG_PASSWORD", "message": "Incorrect phone number or password."})

    if user.status == UserStatus.SUSPENDED:
        raise HTTPException(status_code=403, detail="Account is suspended")

    check_not_locked(user)

    try:
        session = await password_grant(phone_to_email_alias(body.phone_number), body.password)
    except HTTPException as e:
        if isinstance(e.detail, dict) and e.detail.get("code") == "WRONG_PASSWORD":
            await record_failure(db, user)   # always raises — either the plain wrong-password error, the 4th-attempt warning, or the lockout
        raise

    await record_success(db, user)
    set_session_cookies(response, session["access_token"], session.get("refresh_token"))

    return await build_user_response(db, user)


@router.post("/refresh", response_model=UserResponse)
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Silently renews the session cookie using the refresh cookie. The
    frontend calls this on a 401 instead of talking to Supabase directly."""
    refresh_token = get_refresh_cookie(request)
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No session to refresh")

    session = await refresh_grant(refresh_token)
    set_session_cookies(response, session["access_token"], session.get("refresh_token"))

    payload = await verify_supabase_jwt(session["access_token"])
    result = await db.execute(select(User).where(User.id == payload.get("sub")))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="USER_NOT_IN_PLATFORM")
    return await build_user_response(db, user)


@router.post("/logout")
async def logout(request: Request, response: Response):
    """Clears the session cookies. Best-effort revokes the token on
    Supabase's side too, but never fails the logout if that call has
    trouble — the cookies being gone is what actually matters client-side."""
    access_token = get_access_cookie(request)
    if access_token:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{settings.SUPABASE_URL}/auth/v1/logout",
                    headers={"apikey": settings.SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {access_token}"},
                )
        except Exception:
            pass  # cookie clearing below is what actually matters

    clear_session_cookies(response)
    return {"message": "Logged out"}