"""User management routes."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from sqlalchemy import func

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly
from app.core.security import hash_password, hash_withdrawal_password
from app.core.config import get_settings
from app.models.user import User, UserRole, UserStatus, LocationConsentStatus
from app.models.wallet import Wallet
from app.models.card import ContributionCard
from app.models.withdrawal import Withdrawal, WithdrawalStatus
from app.schemas.user import (
    UserResponse, CreateOfficerRequest, CreateDirectorRequest, UpdateUserStatusRequest,
    RegisterCustomerRequest, LocationUpdateRequest, UpdateBankDetailsRequest,
)
from app.services.wallet_service import get_or_create_wallet
from app.services.user_service import resolve_user
from app.integrations.monnify import get_payment_provider
from app.utils.audit import log_action
from app.utils.supabase_auth import create_supabase_auth_user
from app.utils.geo import nearest_nigerian_state

settings = get_settings()

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def get_my_profile(current_user: CurrentUser):
    return current_user


@router.patch("/me", response_model=UserResponse)
async def update_my_profile(
    updates: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Update own non-sensitive profile fields."""
    allowed = {"bank_name", "bank_code", "account_number", "account_name", "next_of_kin_name", "next_of_kin_phone"}
    for key, value in updates.items():
        if key in allowed:
            setattr(current_user, key, value)
    await db.flush()
    return current_user


@router.get("/banks")
async def list_banks(current_user: CurrentUser):
    """Bank picker list for registration and the bank-details editor."""
    from app.integrations.monnify import get_payment_provider
    provider = get_payment_provider()
    try:
        banks = await provider.get_banks()
    except Exception as e:
        print(f"[users] Bank list fetch failed: {e}")
        raise HTTPException(status_code=502, detail="Could not load the bank list right now. Please try again shortly.")
    return [{"name": b.get("name"), "code": b.get("code")} for b in banks if b.get("code")]


@router.get("/resolve-bank-account")
async def resolve_bank_account(
    current_user: CurrentUser,
    bank_code: str,
    account_number: str,
):
    """
    Verifies a bank account and returns the real account holder name —
    customers never type their own account name, closing off a class of
    mistake (and abuse) where the name on file doesn't match the account.
    """
    from app.integrations.monnify import get_payment_provider
    provider = get_payment_provider()
    try:
        account_name = await provider.resolve_account_name(account_number, bank_code)
    except ValueError as e:
        # Raised deliberately by resolve_account_name with a safe, user-facing message
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[users] Bank account resolution failed: {e}")
        raise HTTPException(status_code=502, detail="Could not verify this account right now. Please try again.")
    return {"account_name": account_name}


@router.get("/{user_id}", response_model=UserResponse)
async def get_user_by_id(
    user_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Fetch a single user by ID — used instead of over-fetching a full list
    just to find one record (e.g. a customer detail page)."""
    user_role = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)

    target = await resolve_user(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Same access rules as the list endpoint: officers only see customers
    # currently in THEIR zone (or themselves); customers only see
    # themselves; directors/admins see everyone. This is zone-based, not
    # managing_officer_id-based — that field stays purely as a "who
    # originally registered them" historical record. See
    # 012_zone_coverage.sql for why: whoever currently covers a
    # customer's zone is who can act on them, which changes as directors
    # reassign zone coverage day to day.
    if user_role == "customer" and target.id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if user_role == "officer" and target.id != current_user.id:
        if not current_user.zone_id or target.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="Access denied")

    return target


@router.get("", response_model=list[UserResponse])
async def list_users(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    role: str | None = None,
    status_filter: str | None = None,
    card_type: str | None = None,   # "regular" | "food" — customers holding at least one card of this type
    page: int = 1,
    page_size: int = 20,
):
    user_role = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
    if user_role not in ("admin", "director", "officer"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    query = select(User)
    if role:
        query = query.where(User.role == role)
    if status_filter:
        query = query.where(User.status == status_filter)
    if card_type:
        from app.models.card import ContributionCard
        query = query.where(
            User.id.in_(select(ContributionCard.owner_id).where(ContributionCard.card_type == card_type))
        )

    # Officers only see customers currently in their zone — not a fixed
    # managing_officer_id set. An officer with no zone (unassigned that
    # day) correctly sees nobody, rather than matching other unassigned
    # customers by coincidence.
    if user_role == "officer":
        if not current_user.zone_id:
            from sqlalchemy import false
            query = query.where(false())
        else:
            query = query.where(User.zone_id == current_user.zone_id)

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/customers", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(
    body: RegisterCustomerRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """Officers and admins register manual cash customers."""
    import httpx, uuid as _uuid

    user_role = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
    if user_role not in ("officer", "admin", "director"):
        raise HTTPException(status_code=403, detail="Access denied")

    existing = await db.execute(select(User).where(User.phone_number == body.phone_number))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Phone number already registered")

    # ── Step 1: Create Supabase auth account (generates the UUID auth.users needs) ──
    from app.utils.supabase_admin_client import supabase_admin_request

    customer_email = f"{body.phone_number}@monieking.app"
    resp = await supabase_admin_request(
        "POST",
        "/auth/v1/admin/users",
        json={
            "email": customer_email,
            "password": body.password,
            "email_confirm": True,
            "user_metadata": {"full_name": body.full_name, "phone": body.phone_number},
        },
        failure_detail="Could not create this customer's account right now. Please try again.",
    )

    auth_user = resp.json()
    customer_id = _uuid.UUID(auth_user["id"])

    # ── Step 2: Create platform user record with the same UUID ──
    customer = User(
        id=                       customer_id,
        role=                     UserRole.CUSTOMER,
        full_name=                body.full_name,
        phone_number=             body.phone_number,
        bank_name=                body.bank_name,
        bank_code=                body.bank_code,
        account_number=           body.account_number,
        account_name=             body.account_name,
        next_of_kin_name=         body.next_of_kin_name,
        next_of_kin_phone=        body.next_of_kin_phone,
        status=                   UserStatus.ACTIVE,
        is_manual_customer=       True,
        managing_officer_id=      current_user.id if user_role == "officer" else None,
        # Who can actually manage this customer going forward is
        # zone-based, not tied to whichever officer happened to register
        # them — see 012_zone_coverage.sql. If the registering officer
        # currently has no zone (rare — an unassigned officer shouldn't
        # really be able to register customers, but nothing blocks it),
        # the customer is created zone-less until a director assigns one.
        zone_id=                  current_user.zone_id if user_role == "officer" else None,
        created_by=               current_user.id,
        login_password_hash=      hash_password(body.password),
        withdrawal_password_hash= hash_withdrawal_password(body.withdrawal_password),
    )
    db.add(customer)
    await db.flush()

    # Wallet + immediate account provisioning — same as self-registration,
    # capped/unverified until KYC raises the limit, never gated on it.
    wallet = await get_or_create_wallet(db, customer.id)
    try:
        from app.integrations.monnify import get_payment_provider
        provider = get_payment_provider()
        account = await provider.create_reserved_account(
            account_reference= f"MK-CUST-{customer.id.hex[:8].upper()}",
            account_name=      customer.full_name,
            customer_email=    f"{customer.phone_number}@monieking.app",
            customer_name=     customer.full_name,
        )
        wallet.virtual_account_number = account.account_number
        wallet.virtual_account_bank   = account.bank_name
        wallet.virtual_account_ref    = account.account_reference
        await db.flush()
    except Exception as e:
        print(f"Monnify VA creation failed (non-fatal): {e}")

    await log_action(
        db, actor_id=current_user.id, action="customer.registered_by_officer",
        entity_type="user", entity_id=str(customer.id),
        new_value={"full_name": customer.full_name, "phone_number": customer.phone_number},
        ip_address=request.client.host if request and request.client else None,
    )
    return customer


@router.post("/officers", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_officer(
    body: CreateOfficerRequest,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """Directors create Officer accounts."""
    # Check phone uniqueness
    existing = await db.execute(select(User).where(User.phone_number == body.phone_number))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Phone number already registered")

    # Create the real Supabase Auth login FIRST — without this, the officer
    # row exists but can never actually sign in (same bug class as the
    # director-login issue found earlier).
    officer_id = await create_supabase_auth_user(
        email=     f"{body.phone_number}@monieking.app",
        password=  body.password,
        full_name= body.full_name,
        phone=     body.phone_number,
    )

    officer = User(
        id=           officer_id,
        role=         UserRole.OFFICER,
        full_name=    body.full_name,
        phone_number= body.phone_number,
        zone_id=      body.zone_id,
        created_by=   director.id,
        status=       UserStatus.ACTIVE,
        login_password_hash=      hash_password(body.password),
        # Same default convention as customer accounts (phone number +
        # "MK") — without this, withdrawal_password_hash stays NULL
        # forever and the officer can never withdraw at all, since there
        # was no way to set one after account creation either.
        withdrawal_password_hash= hash_password(f"{body.phone_number}MK"),
    )
    db.add(officer)
    await db.flush()

    # Wallet + immediate account provisioning — same as customers.
    wallet = await get_or_create_wallet(db, officer.id)
    try:
        from app.integrations.monnify import get_payment_provider
        provider = get_payment_provider()
        account = await provider.create_reserved_account(
            account_reference= f"MK-OFF-{officer.id.hex[:8].upper()}",
            account_name=      officer.full_name,
            customer_email=    f"{officer.phone_number}@monieking.app",
            customer_name=     officer.full_name,
        )
        wallet.virtual_account_number = account.account_number
        wallet.virtual_account_bank   = account.bank_name
        wallet.virtual_account_ref    = account.account_reference
        await db.flush()
    except Exception as e:
        print(f"Monnify VA creation failed for officer {officer.id} (non-fatal): {e}")

    await log_action(
        db, actor_id=director.id, action="officer.created",
        entity_type="user", entity_id=str(officer.id),
        new_value={"full_name": officer.full_name, "phone_number": officer.phone_number},
        ip_address=request.client.host if request else None,
    )
    return officer


@router.post("/directors", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_director(
    body: CreateDirectorRequest,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """Directors create other Director accounts (Admin role no longer exists as a separate account type)."""
    existing = await db.execute(select(User).where(User.phone_number == body.phone_number))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Phone number already registered")

    new_director_id = await create_supabase_auth_user(
        email=     f"{body.phone_number}@monieking.app",
        password=  body.password,
        full_name= body.full_name,
        phone=     body.phone_number,
    )

    new_director = User(
        id=           new_director_id,
        role=         UserRole.DIRECTOR,
        full_name=    body.full_name,
        phone_number= body.phone_number,
        created_by=   director.id,
        status=       UserStatus.ACTIVE,
        login_password_hash= hash_password(body.password),
    )
    db.add(new_director)
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="director.created",
        entity_type="user", entity_id=str(new_director.id),
        new_value={"full_name": new_director.full_name},
        ip_address=request.client.host if request else None,
    )
    return new_director


@router.patch("/{user_id}/status", response_model=UserResponse)
async def update_user_status(
    user_id: str,
    body: UpdateUserStatusRequest,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """Director suspends or reactivates any user."""
    user = await resolve_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_status = user.status
    user.status = body.status
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="user.status_changed",
        entity_type="user", entity_id=str(user.id),
        old_value={"status": old_status.value},
        new_value={"status": body.status.value},
        ip_address=request.client.host if request else None,
    )
    return user


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """
    Permanently deletes a customer or officer — full removal from the
    database, not reversible. Unlike Suspend (which just locks them out
    until resolved), this actually erases the account.

    Only allowed for accounts with NO financial history — no contribution
    records, no withdrawals, no wallet transactions, nothing in the audit
    log. That's not an arbitrary restriction: those tables reference
    users.id without cascade, specifically so a real customer's financial
    trail can never accidentally vanish. An account with any real
    activity can only be Suspended, never deleted — this is meant for
    cleaning up accidental or test accounts, not erasing real customers.
    """
    user = await resolve_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if director.id == user.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account")

    from app.models.card import ContributionRecord, ContributionCard
    from app.models.withdrawal import Withdrawal
    from app.models.wallet import WalletTransaction
    from app.models.audit import AuditLog
    from app.models.notification import Broadcast

    has_contributions = (await db.execute(
        select(func.count(ContributionRecord.id)).where(ContributionRecord.contributed_by == user.id)
    )).scalar_one()
    has_withdrawals = (await db.execute(
        select(func.count(Withdrawal.id)).where(Withdrawal.customer_id == user.id)
    )).scalar_one()
    has_wallet_activity = (await db.execute(
        select(func.count(WalletTransaction.id)).where(WalletTransaction.initiated_by == user.id)
    )).scalar_one()
    has_audit_history = (await db.execute(
        select(func.count(AuditLog.id)).where(AuditLog.actor_id == user.id)
    )).scalar_one()
    has_broadcasts = (await db.execute(
        select(func.count(Broadcast.id)).where(Broadcast.sent_by == user.id)
    )).scalar_one()

    if has_contributions or has_withdrawals or has_wallet_activity or has_audit_history or has_broadcasts:
        raise HTTPException(
            status_code=400,
            detail=(
                "This account has real activity (contributions, withdrawals, or other "
                "history) and can't be deleted — that history has to stay intact. "
                "Suspend the account instead to lock them out until it's resolved."
            ),
        )

    user_name = user.full_name
    user_phone = user.phone_number

    # Wallet, contribution_cards, notifications, and webauthn_credentials
    # all cascade automatically on the users row delete (see
    # 001_initial_schema.sql and 006_v6_features.sql) — nothing else to
    # clean up manually here.

    # Delete the Supabase Auth login first — if this fails, we haven't
    # touched the local database yet, so nothing is left half-deleted.
    from app.utils.supabase_admin_client import supabase_admin_request

    await supabase_admin_request(
        "DELETE",
        f"/auth/v1/admin/users/{user.id}",
        ok_statuses=(200, 204),
        not_found_ok=True,  # the auth user may already be gone — that's fine
        failure_detail="Could not delete the login account — please try again",
    )

    await log_action(
        db, actor_id=director.id, action="user.deleted",
        entity_type="user", entity_id=str(user.id),
        old_value={"full_name": user_name, "phone_number": user_phone},
        ip_address=request.client.host if request else None,
    )

    await db.delete(user)
    await db.flush()

    return {"message": f"{user_name} has been permanently deleted"}


@router.get("/{user_id}/overview")
async def get_customer_overview(
    user_id: str,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    """
    Full financial detail for one customer: every card's contributed/withdrawn/
    available balance. Deliberately excludes the rendered 12x31 grid/graphic —
    numbers only.
    """
    customer = await resolve_user(db, user_id)
    if not customer:
        raise HTTPException(status_code=404, detail="User not found")

    wallet = await get_or_create_wallet(db, customer.id)

    cards_result = await db.execute(select(ContributionCard).where(ContributionCard.owner_id == customer.id))
    cards = cards_result.scalars().all()

    card_ids = [card.id for card in cards]

    # One query instead of two: previously this ran a separate grouped
    # SUM query AND fetched every withdrawal row individually — the sum
    # is fully derivable from the rows we're already fetching below, so
    # there's no need to ask the DB for it twice.
    all_withdrawals_result = await db.execute(
        select(Withdrawal).where(Withdrawal.card_id.in_(card_ids)).order_by(Withdrawal.requested_at.desc())
    )
    withdrawals_by_card: dict = {}
    withdrawn_by_card: dict = {}
    for w in all_withdrawals_result.scalars().all():
        withdrawals_by_card.setdefault(w.card_id, []).append(w)
        if w.status == WithdrawalStatus.PAID:
            withdrawn_by_card[w.card_id] = withdrawn_by_card.get(w.card_id, 0) + w.requested_amount_kobo

    card_overviews = []
    for card in cards:
        total_withdrawn_kobo = withdrawn_by_card.get(card.id, 0)
        card_overviews.append({
            "id":                     str(card.id),
            "card_type":              card.card_type.value,
            "rate_kobo":              card.rate_kobo,
            "status":                 card.status.value,
            "created_at":             card.created_at,
            "total_days_contributed": card.total_days_contributed,
            "days_remaining":         372 - card.total_days_contributed,
            "total_contributed_kobo": card.total_contributed_kobo,
            "total_withdrawn_kobo":   total_withdrawn_kobo,
            "available_balance_kobo": card.total_contributed_kobo - total_withdrawn_kobo,
            "withdrawal_history": [
                {
                    "id":                    str(w.id),
                    "requested_amount_kobo": w.requested_amount_kobo,
                    "charge_kobo":           w.charge_kobo,
                    "net_payable_kobo":      w.net_payable_kobo,
                    "status":                w.status.value,
                    "requested_at":          w.requested_at,
                    "processed_at":          w.processed_at,
                }
                for w in withdrawals_by_card.get(card.id, [])
            ],
        })

    return {
        "profile": UserResponse.model_validate(customer),
        "wallet_balance_kobo": wallet.balance_kobo,
        "cards": card_overviews,
    }


@router.patch("/me/location", response_model=UserResponse)
async def update_my_location(
    body: LocationUpdateRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    One-time, consent-based location capture shown right after
    registration. `consent=false` (Skip) just records that the user was
    asked and declined — never blocks access to the app either way.
    """
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one()

    if body.consent and body.latitude is not None and body.longitude is not None:
        user.location_consent_status = LocationConsentStatus.GRANTED
        user.location_latitude = body.latitude
        user.location_longitude = body.longitude
        user.detected_state = nearest_nigerian_state(body.latitude, body.longitude)
    else:
        user.location_consent_status = LocationConsentStatus.DECLINED

    await db.flush()
    return user


@router.post("/me/avatar", response_model=UserResponse)
async def upload_avatar(
    body: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Accepts a base64 data URL (data:image/jpeg;base64,...), uploads to the
    'avatars' bucket in Supabase Storage (public, created in migration
    006), and stores the resulting public URL. Overwrites any previous
    avatar for this user (same filename, upsert).
    """
    import base64
    import httpx

    data_url = body.get("image_base64", "")
    if not data_url or "base64," not in data_url:
        raise HTTPException(status_code=400, detail="No image provided")

    header, encoded = data_url.split("base64,", 1)
    content_type = "image/jpeg"
    if "image/png" in header:
        content_type = "image/png"
    elif "image/webp" in header:
        content_type = "image/webp"
    ext = content_type.split("/")[1]

    try:
        image_bytes = base64.b64decode(encoded)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image data")

    if len(image_bytes) > 3 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large — please use one under 3MB")

    filename = f"{current_user.id}.{ext}"
    from app.utils.supabase_admin_client import supabase_admin_request

    await supabase_admin_request(
        "POST",
        f"/storage/v1/object/avatars/{filename}",
        content=image_bytes,
        extra_headers={"Content-Type": content_type, "x-upsert": "true"},
        failure_detail="Could not upload image — please try again",
    )

    current_user.avatar_url = f"{settings.SUPABASE_URL}/storage/v1/object/public/avatars/{filename}"
    await db.flush()
    return current_user





@router.patch("/me/bank-details", response_model=UserResponse)
async def update_bank_details(
    body: UpdateBankDetailsRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Lets a customer change their registered bank account — e.g. the old
    one stopped working. Gated behind the same protection as a
    withdrawal (password or biometric), since this controls where future
    withdrawals get paid out to.
    """
    if body.auth_method == "password":
        if not body.withdrawal_password:
            raise HTTPException(status_code=400, detail="Withdrawal password required")
        from app.services.withdrawal_auth_service import check_withdrawal_password
        await check_withdrawal_password(db, current_user, body.withdrawal_password)
    elif body.auth_method == "biometric":
        if not body.webauthn_assertion:
            raise HTTPException(status_code=400, detail="WebAuthn assertion required")
        from app.services.webauthn_service import verify_authentication
        await verify_authentication(db, current_user, body.webauthn_assertion)
    else:
        raise HTTPException(status_code=400, detail="Invalid auth method")

    from app.integrations.monnify import get_payment_provider
    provider = get_payment_provider()
    try:
        verified_account_name = await provider.resolve_account_name(body.account_number, body.bank_code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[users] Bank account resolution failed: {e}")
        raise HTTPException(status_code=502, detail="Could not verify this account right now. Please try again.")

    old_bank = current_user.bank_name
    current_user.bank_name      = body.bank_name
    current_user.bank_code      = body.bank_code
    current_user.account_number = body.account_number
    current_user.account_name   = verified_account_name
    await db.flush()

    # This controls where future withdrawals get paid — if a withdrawal
    # password or biometric were ever compromised, this is exactly the
    # kind of change the real account owner needs to know about
    # immediately, not discover after money's already gone to the wrong
    # account. Previously this was only in the audit log, which nobody
    # notices in real time.
    from app.services.notification_service import send_notification
    from app.models.notification import NotificationType
    await send_notification(
        db, user_id=current_user.id,
        title="Bank account changed",
        body=f"Your withdrawal account was changed to {body.bank_name} ({body.account_number}). "
             f"If this wasn't you, contact your officer or a director immediately.",
        type=NotificationType.INFO,
    )

    await log_action(
        db, actor_id=current_user.id, action="user.bank_details_updated",
        entity_type="user", entity_id=str(current_user.id),
        old_value={"bank_name": old_bank},
        new_value={"bank_name": body.bank_name, "account_number": body.account_number},
    )
    return current_user


@router.post("/{officer_id}/unassign-zone")
async def unassign_officer_zone(
    officer_id: str,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    """Removes an officer from their current zone without assigning them
    anywhere new — the zone becomes uncovered until a director assigns
    someone else."""
    from app.services.zone_service import unassign_officer
    officer = await resolve_user(db, officer_id)
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")
    return await unassign_officer(db, officer.id, actor_id=director.id)


@router.get("/{officer_id}/zone-history")
async def get_officer_zone_history(
    officer_id: str,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
    start_date: str | None = None,
    end_date: str | None = None,
):
    """Coverage history for one officer — powers the Officer Detail
    page's filterable history view."""
    from datetime import date
    from app.models.zone_assignment import ZoneAssignment

    officer = await resolve_user(db, officer_id)
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")

    query = select(ZoneAssignment).where(ZoneAssignment.officer_id == officer.id)
    if start_date:
        query = query.where(ZoneAssignment.started_at >= date.fromisoformat(start_date))
    if end_date:
        query = query.where(ZoneAssignment.started_at <= date.fromisoformat(end_date))
    query = query.order_by(ZoneAssignment.started_at.desc())

    result = await db.execute(query)
    rows = result.scalars().all()

    director_ids = {r.assigned_by_director_id for r in rows if r.assigned_by_director_id}
    directors_result = await db.execute(select(User).where(User.id.in_(director_ids))) if director_ids else None
    director_names = {d.id: d.full_name for d in directors_result.scalars().all()} if directors_result else {}

    return [
        {
            "id": str(r.id),
            "zone_id": str(r.zone_id) if r.zone_id else None,
            "zone_name": r.zone_name,
            "started_at": r.started_at.isoformat(),
            "ended_at": r.ended_at.isoformat() if r.ended_at else None,
            "assigned_by_director_name": director_names.get(r.assigned_by_director_id),
        }
        for r in rows
    ]
