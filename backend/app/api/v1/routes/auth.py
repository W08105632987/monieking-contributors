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
from sqlalchemy import select, func

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
        withdrawal_password_hash= hash_withdrawal_password(body.withdrawal_password) if body.withdrawal_password else None,
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
    _signup_email_code = None
    if body.email:
        from app.services import email_service as es
        em = es.normalize_email(body.email)
        if es.is_valid_email(em):
            _code = es.new_code()
            user.pending_email = em
            user.email_code_hash = es.hash_code(_code)
            user.email_code_expires_at = es.expiry()
            _signup_email_code = (em, _code)
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

    # Link any offline record that was waiting for this phone number.
    try:
        from app.services.offline_import import claim_for_user
        async with db.begin_nested():
            await claim_for_user(db, user)
    except Exception as e:
        print(f"[offline-claim] failed (non-fatal, can be retried): {e}")

    try:
        await log_action(
            db, actor_id=user.id, action="customer.registered",
            entity_type="user", entity_id=str(user.id),
            new_value={"full_name": user.full_name, "phone_number": user.phone_number},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception as e:
        print(f"Audit log failed (non-fatal): {e}")

    if _signup_email_code:
        try:
            await es.send_verification_code(*_signup_email_code)
        except Exception as e:
            print(f"[signup-email] failed (non-fatal): {e}")

    return await build_user_response(db, user)


@router.post("/set-pin", status_code=200)
@limiter.limit("10/minute")
async def set_payment_pin(
    request: Request,
    body: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Everyone has one 4-digit payment PIN. It authorises airtime, bills, identity services, bank-detail changes
    and director actions. Withdrawals use the separate withdrawal password. First time: no current PIN needed.
    Changing it needs the current PIN."""
    from app.services import pin_service
    pin = str(body.get("pin", ""))
    pin_service.validate_new_pin(pin)
    user = await db.get(User, current_user.id)
    is_change = user.payment_pin_hash is not None
    if is_change:
        await pin_service.check_pin(db, user, str(body.get("current_pin", "")), need_kyc=False)
    await pin_service.set_pin(db, user.id, pin)
    await db.commit()
    from app.core.dependencies import invalidate_user_cache
    await invalidate_user_cache(str(user.id))
    if is_change:
        from app.services.notification_service import send_notification
        from app.models.notification import NotificationType
        await send_notification(db, user_id=user.id, title="Payment PIN changed",
                                body="Your payment PIN was just changed. If this wasn't you, contact your officer or a director immediately.",
                                type=NotificationType.INFO)
    return {"message": "PIN saved", "has_pin": True}


@router.post("/verify-pin", status_code=200)
@limiter.limit("10/minute")
async def verify_payment_pin(request: Request, body: dict, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    from app.services import pin_service
    await pin_service.check_pin(db, current_user, str(body.get("pin", "")), need_kyc=False)
    return {"verified": True}


@router.post("/reset-pin", status_code=200)
@limiter.limit("5/minute")
async def reset_payment_pin(request: Request, body: dict, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Forgot the PIN: prove it is you with the login password, then choose a new PIN."""
    from app.services import pin_service
    from app.services.login_service import verify_login_password
    pin = str(body.get("pin", ""))
    pin_service.validate_new_pin(pin)
    try:
        await verify_login_password(current_user.phone_number, str(body.get("login_password", "")))
    except HTTPException as e:
        if e.status_code == 401:
            raise HTTPException(status_code=401, detail="Your login password is incorrect")
        raise
    await pin_service.set_pin(db, current_user.id, pin)
    await db.commit()
    from app.core.dependencies import invalidate_user_cache as _inv
    await _inv(str(current_user.id))
    return {"message": "PIN reset", "has_pin": True}


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
    await db.commit()
    from app.core.dependencies import invalidate_user_cache as _inv2
    await _inv2(str(user.id))
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
    Sends a 6-digit code to reset the login password. The person can give a phone number OR a verified
    email. A code goes to the email when they gave one (or chose email and have one verified); it goes by
    SMS otherwise — and SMS is also the fallback when the email could not be sent. Always returns the same
    generic message whether or not the account exists.
    """
    from datetime import datetime, timezone, timedelta
    from app.integrations.termii import send_sms
    from app.services import email_service as es

    raw = (body.get("identifier") or body.get("phone_number") or body.get("email") or "").strip()
    prefer_email = body.get("channel") == "email"
    generic_response = {"message": "If that account exists, a reset code has been sent."}

    user = None
    if "@" in raw:
        em = es.normalize_email(raw)
        if es.is_valid_email(em):
            user = (await db.execute(
                select(User).where(func.lower(User.email) == em, User.email_verified_at.is_not(None))
            )).scalars().first()
            prefer_email = True
    elif raw:
        user = (await db.execute(select(User).where(User.phone_number == raw))).scalar_one_or_none()
    if not user:
        return generic_response

    otp = es.new_code()
    user.login_password_reset_otp_hash = hash_password(otp)
    user.login_password_reset_otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)
    user.password_reset_attempts = 0
    await db.commit()

    sent = False
    if prefer_email and user.email_verified:
        sent = await es.send_reset_code(user.email, otp)
    if not sent:
        try:
            await send_sms(user.phone_number, f"Your MonieKing password reset code is {otp}. Expires in {OTP_TTL_MINUTES} minutes. Don't share this with anyone.")
            sent = True
        except Exception as e:
            print(f"[forgot-password] send_sms failed (non-fatal): {e}")
    if not sent and user.email_verified and not prefer_email:
        await es.send_reset_code(user.email, otp)

    return generic_response


@router.post("/forgot-password/reset")
@limiter.limit("5/minute")
async def reset_password_with_otp(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone
    from app.services import email_service as es

    raw          = (body.get("identifier") or body.get("phone_number") or body.get("email") or "").strip()
    otp          = body.get("otp", "")
    new_password = body.get("new_password", "")

    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    if "@" in raw:
        user = (await db.execute(
            select(User).where(func.lower(User.email) == es.normalize_email(raw), User.email_verified_at.is_not(None))
        )).scalars().first()
    else:
        user = (await db.execute(select(User).where(User.phone_number == raw))).scalar_one_or_none()
    if not user or not user.login_password_reset_otp_hash:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    if not user.login_password_reset_otp_expires_at or user.login_password_reset_otp_expires_at < datetime.now(timezone.utc):
        user.login_password_reset_otp_hash = None
        user.login_password_reset_otp_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")

    if (user.password_reset_attempts or 0) >= 5:
        user.login_password_reset_otp_hash = None
        user.login_password_reset_otp_expires_at = None
        await db.commit()
        raise HTTPException(status_code=429, detail="Too many wrong codes. Request a new one.")

    from app.core.security import verify_password
    if not verify_password(str(otp), user.login_password_reset_otp_hash):
        user.password_reset_attempts = (user.password_reset_attempts or 0) + 1
        await db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    # Code correct — clear it (single use) and update the real Supabase login password
    user.login_password_reset_otp_hash = None
    user.login_password_reset_otp_expires_at = None
    user.password_reset_attempts = 0
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
    from app.services.default_password import check_new_password
    from app.services.login_service import verify_login_password
    from app.utils.supabase_admin_client import supabase_admin_request

    current_password = str(body.get("current_password", ""))
    new_password     = str(body.get("new_password", ""))
    problem = check_new_password(current_user.phone_number, new_password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if new_password == current_password:
        raise HTTPException(status_code=400, detail="Your new password must be different from the current one")

    try:
        # Same server-side call login uses. A wrong password is a 401; an unreachable login service is a clear 5xx.
        await verify_login_password(current_user.phone_number, current_password)
        await supabase_admin_request(
            "PUT",
            f"/auth/v1/admin/users/{current_user.id}",
            json={"password": new_password},
            failure_detail="Your current password was verified, but we couldn't finish updating it. Please try again.",
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - never an anonymous "Internal server error" on a security screen
        print(f"[CHANGE_PASSWORD_ERROR] {type(e).__name__}: {str(e)[:200]}", flush=True)
        raise HTTPException(status_code=502, detail="We couldn't change your password right now. Please try again in a moment.")

    await _after_password_change(db, current_user.id)
    return {"message": "Password updated"}


async def _after_password_change(db: AsyncSession, user_id) -> None:
    """The person chose their own password: clear the 'must change' flag, refresh caches, tell them."""
    user = await db.get(User, user_id)
    if user is not None and user.must_change_password:
        user.must_change_password = False
    from app.core.dependencies import invalidate_user_cache
    from app.services.notification_service import send_notification
    from app.models.notification import NotificationType
    await send_notification(
        db, user_id=user_id,
        title="Login password changed",
        body="Your login password was just changed. If this wasn't you, contact your officer or a director immediately.",
        type=NotificationType.INFO,
    )
    await db.flush()
    await invalidate_user_cache(str(user_id))


@router.post("/set-new-password")
@limiter.limit("5/minute")
async def set_new_password_after_default(
    request: Request,
    body: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """For someone signed in with a password MonieKing set for them (the phone-number + MK default): choose their own.
    No current password is asked for because they just signed in with it. Only works while the account is flagged."""
    from app.services.default_password import check_new_password
    from app.utils.supabase_admin_client import supabase_admin_request

    user = await db.get(User, current_user.id)
    if user is None or not user.must_change_password:
        raise HTTPException(status_code=400, detail="Your password does not need changing. Use Settings > Change login password.")
    new_password = str(body.get("new_password", ""))
    problem = check_new_password(user.phone_number, new_password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    try:
        await supabase_admin_request(
            "PUT", f"/auth/v1/admin/users/{user.id}", json={"password": new_password},
            failure_detail="We couldn't save your new password. Please try again.",
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[SET_NEW_PASSWORD_ERROR] {type(e).__name__}: {str(e)[:200]}", flush=True)
        raise HTTPException(status_code=502, detail="We couldn't save your new password right now. Please try again.")
    await _after_password_change(db, user.id)
    return {"message": "Password updated", "must_change_password": False}


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