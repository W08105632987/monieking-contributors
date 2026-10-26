"""Wallet routes — balance, transactions, virtual account info."""
import logging
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.services import nin_vault
from app.core.dependencies import CurrentUser, DirectorOnly, invalidate_user_cache
from app.services.settings_service import get_config_int
from app.core.security import verify_withdrawal_password, generate_reference
from app.services.webauthn_service import verify_authentication
from app.services.withdrawal_auth_service import check_withdrawal_password
from app.core.limiter import limiter
from app.integrations.monnify import get_payment_provider
from app.models.wallet import Wallet, WalletTransaction, TxCategory, TxType
from app.models.withdrawal import Withdrawal, WithdrawalSource, WithdrawalStatus
from app.models.notification import NotificationType
from app.models.user import User, UserRole
from app.schemas.wallet import WalletResponse, WalletTransactionResponse, PaginatedTransactions, WalletSummaryResponse
from app.schemas.withdrawal import WalletWithdrawalRequest, WithdrawalResponse
from app.schemas.user import KycSubmitRequest
from app.services.wallet_service import get_or_create_wallet, debit_wallet, credit_wallet
from app.services.notification_service import send_notification
from app.services.receipt_service import build_verification_code, build_receipt_details, failure_info
from app.utils.audit import log_action
from app.utils.bank_codes import resolve_bank_code

router = APIRouter(prefix="/wallets", tags=["wallets"])
logger = logging.getLogger(__name__)

# Month names are spelled out here instead of strftime("%b"), which follows
# the server's locale and would send "oct."/"okt" to Monnify on a non-English host.
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _monnify_dob(iso_date: str) -> str:
    """"1993-10-03" -> "03-Oct-1993" (Monnify's dd-MMM-yyyy)."""
    d = datetime.strptime(iso_date, "%Y-%m-%d")
    return f"{d.day:02d}-{_MONTHS[d.month - 1]}-{d.year}"


def _monnify_reason(exc: Exception) -> str:
    """Monnify's own explanation from a failed call, or "" — shown to the
    customer only as a hint, and always logged in full."""
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            msg = response.json().get("responseMessage")
            if msg:
                return str(msg)[:200]
        except Exception:
            pass
    detail = getattr(exc, "detail", None)
    return str(detail)[:200] if detail else ""

# Default fee if the setting row is somehow missing — the live value is
# director-editable via GET/PATCH /settings, key 'wallet_instant_withdrawal_fee_kobo'
DEFAULT_WALLET_WITHDRAWAL_CHARGE_KOBO = 5_000   # ₦50


@router.get("/me", response_model=WalletResponse)
async def get_my_wallet(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    wallet = await get_or_create_wallet(db, current_user.id)
    return wallet


async def net_in_out(db: AsyncSession, wallet_id, filters: list) -> tuple[int, int]:
    """Money in / money out that did not really move.
    A failed purchase is a debit followed by a refund (category 'reversal'). Counting both would make
    'in' and 'out' grow with every failure while the customer is no better or worse off. So refunds are
    not counted as money in, and the debit they cancel is reduced by the amount refunded."""
    credit_total = (await db.execute(
        select(func.coalesce(func.sum(WalletTransaction.amount_kobo), 0))
        .where(*filters, WalletTransaction.type == TxType.CREDIT, WalletTransaction.category != TxCategory.REVERSAL)
    )).scalar_one()

    debits = (await db.execute(
        select(WalletTransaction.amount_kobo, WalletTransaction.related_entity_type, WalletTransaction.related_entity_id)
        .where(*filters, WalletTransaction.type == TxType.DEBIT)
    )).all()
    keys = {(t, i) for _, t, i in debits if t and i}
    refunded: dict = {}
    if keys:
        rows = (await db.execute(
            select(WalletTransaction.related_entity_type, WalletTransaction.related_entity_id, func.sum(WalletTransaction.amount_kobo))
            .where(WalletTransaction.wallet_id == wallet_id, WalletTransaction.type == TxType.CREDIT,
                   WalletTransaction.category == TxCategory.REVERSAL,
                   WalletTransaction.related_entity_id.in_([i for _, i in keys]))
            .group_by(WalletTransaction.related_entity_type, WalletTransaction.related_entity_id)
        )).all()
        refunded = {(t, i): int(a) for t, i, a in rows}
    debit_total = 0
    grouped: dict = {}
    for amount, t, i in debits:
        if t and i:
            grouped[(t, i)] = grouped.get((t, i), 0) + int(amount)
        else:
            debit_total += int(amount)
    for key, amount in grouped.items():
        debit_total += max(amount - refunded.get(key, 0), 0)
    return int(credit_total), int(debit_total)


@router.get("/funding-fee")
async def funding_fee_info(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """What a customer sees in the Fund sheet: whether a fee applies and the ranges."""
    from app.services.funding_fees import get_settings as _fee_settings
    row = await _fee_settings(db)
    mode = "monnify" if row.pass_monnify_fee else ("ranges" if row.charge_customers else "none")
    return {"charging": mode != "none", "mode": mode, "tiers": row.tiers if mode == "ranges" else []}


class VirtualAccountRequest(BaseModel):
    nin: Optional[str] = None


@router.post("/me/virtual-account", response_model=WalletResponse)
@limiter.limit("4/minute")
async def ensure_virtual_account(request: Request, body: VirtualAccountRequest, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Monnify (live) refuses to create an account without a BVN/NIN, so this needs the person's NIN.
    We never store the full NIN, so someone who verified earlier types it once more here: it must end with the
    same 4 digits we verified. Safe to call again: it never creates a second account."""
    from app.api.v1.routes.kyc import _create_account
    user = await db.get(User, current_user.id)
    wallet = await get_or_create_wallet(db, user.id)
    if wallet.virtual_account_number:
        return wallet
    if not (user.nin_linked or user.bvn_linked):
        raise HTTPException(status_code=403, detail={"code": "kyc_required", "message": "Verify your NIN first to get your account number."})
    nin = (body.nin or "").strip()
    if not nin:
        nin = nin_vault.unseal(user.nin_encrypted) or ""   # on file: one click, no typing
    if len(nin) != 11 or not nin.isdigit():
        raise HTTPException(status_code=422, detail="Enter your 11-digit NIN to create your account number.")
    if user.nin_last4 and nin[-4:] != user.nin_last4:
        raise HTTPException(status_code=422, detail="That NIN does not match the one you verified.")
    await db.commit()
    await _create_account(db, user, wallet, get_payment_provider(), name=user.full_name, nin=nin)
    if not user.nin_encrypted:
        user.nin_encrypted = nin_vault.seal(nin)   # remember it (encrypted) so this is one click next time
    await db.commit()
    return wallet


@router.post("/me/submit-kyc", response_model=WalletResponse)
async def submit_kyc(
    body: KycSubmitRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Links BVN and/or NIN to the account's EXISTING virtual account
    (created automatically at signup — every account gets a real,
    working account number right away, no KYC required to have one at
    all). This only raises the transaction limit; it never gates
    whether the account exists in the first place. Per Monnify: one of
    BVN/NIN lifts the account off their lowest cap, both gets the
    maximum limit.

    Safe to call again later to add the second identifier (e.g. BVN
    now, NIN later for the higher limit).
    """
    if not body.bvn and not body.nin:
        raise HTTPException(status_code=400, detail="Provide your BVN, NIN, or both")
    if body.bvn and current_user.bvn_linked:
        body.bvn = None  # already linked, nothing new to verify
    if body.nin and current_user.nin_linked:
        body.nin = None
    if not body.bvn and not body.nin:
        raise HTTPException(status_code=400, detail="Those are already linked to your account")
    if body.bvn and not body.date_of_birth:
        raise HTTPException(status_code=400, detail="Date of birth is required to verify a BVN")

    if body.auth_method == "password":
        from app.services.pin_service import check_pin
        await check_pin(db, current_user, body.pin, need_kyc=False)
    elif body.auth_method == "biometric":
        if not body.webauthn_assertion:
            raise HTTPException(status_code=400, detail="WebAuthn assertion required")
        await verify_authentication(db, current_user, body.webauthn_assertion)
    else:
        raise HTTPException(status_code=400, detail="Invalid auth method")

    provider = get_payment_provider()

    # Verify FIRST. Linking a number to the account (below) just stores
    # whatever it's given — it does not confirm the number actually
    # belongs to this person. That confirmation only happens here,
    # against Monnify's real BVN/NIN records.
    if body.bvn:
        try:
            dob_formatted = _monnify_dob(body.date_of_birth)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date of birth")
        matched = await provider.verify_bvn(
            bvn=body.bvn, name=current_user.full_name,
            date_of_birth=dob_formatted, mobile_no=current_user.phone_number,
        )
        if not matched:
            raise HTTPException(status_code=422, detail="That BVN could not be verified against your name, date of birth, and phone number. Please double-check and try again.")

    if body.nin:
        matched = await provider.verify_nin(nin=body.nin)
        if not matched:
            raise HTTPException(status_code=422, detail="That NIN could not be verified. Please double-check and try again.")

    wallet = await get_or_create_wallet(db, current_user.id)

    if wallet.virtual_account_ref:
        # Normal path: account already exists (created at signup) —
        # just link the verified BVN/NIN to it.
        try:
            await provider.update_reserved_account_kyc(
                account_reference= wallet.virtual_account_ref,
                bvn=                body.bvn,
                nin=                body.nin,
            )
        except Exception as e:
            logger.error("[wallets] Monnify KYC linking failed for user %s: %s | %s", current_user.id, e, _monnify_reason(e))
            reason = _monnify_reason(e)
            raise HTTPException(status_code=502, detail="Verified, but couldn't update your account limit right now." + (f" ({reason})" if reason else " Please try again shortly."))
    else:
        # Fallback: account creation at signup failed (Monnify hiccup,
        # non-fatal at the time) and never got retried — create it now,
        # with the BVN/NIN in hand from the start.
        role_tag = current_user.role.value.upper()[:4] if hasattr(current_user.role, 'value') else str(current_user.role).upper()[:4]
        try:
            account = await provider.create_reserved_account(
                account_reference= f"MK-{role_tag}-{current_user.id.hex[:8].upper()}",
                account_name=      current_user.full_name,
                customer_email=    f"{current_user.phone_number}@monieking.app",
                customer_name=     current_user.full_name,
                bvn=                body.bvn,
                nin=                body.nin,
            )
        except Exception as e:
            logger.error("[wallets] Monnify VA creation failed for user %s: %s | %s", current_user.id, e, _monnify_reason(e))
            reason = _monnify_reason(e)
            raise HTTPException(status_code=502, detail="Verified, but couldn't set up your account right now." + (f" ({reason})" if reason else " Please try again shortly."))

        wallet.virtual_account_number = account.account_number
        wallet.virtual_account_bank   = account.bank_name
        wallet.virtual_account_ref    = account.account_reference

    # current_user may be the cached (unattached) object — fetch a real
    # session-attached row before mutating these KYC flags, so they
    # actually persist. Also invalidate the cache afterward since these
    # ARE cached fields (unlike the hash/challenge fields elsewhere).
    user = await db.get(User, current_user.id)
    if body.bvn:
        user.bvn_linked = True
        user.bvn_last4  = body.bvn[-4:]
    if body.nin:
        user.nin_linked = True
        user.nin_last4  = body.nin[-4:]
    user.kyc_completed_at = datetime.now(timezone.utc)

    await db.flush()
    await invalidate_user_cache(str(user.id))
    return wallet


@router.post("/me/withdraw", response_model=WithdrawalResponse, status_code=201)
@limiter.limit("10/minute")
async def request_wallet_withdrawal(
    request: Request,
    body: WalletWithdrawalRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Instantly withdraw from wallet balance to the account registered at
    sign-up. Flat ₦50 charge. Sends the money immediately via Monnify —
    unlike card withdrawals, there is no director approval step here."""
    from app.services.kyc_gate import require_kyc
    require_kyc(current_user)
    if not current_user.account_number or not current_user.account_name:
        raise HTTPException(status_code=400, detail="No registered bank account on file. Please update your profile first.")

    bank_code = current_user.bank_code or await resolve_bank_code(current_user.bank_name)
    if not bank_code:
        raise HTTPException(
            status_code=400,
            detail="We couldn't determine your bank's transfer code. Please re-select your bank in your profile.",
        )

    wallet = await get_or_create_wallet(db, current_user.id)
    if body.amount_kobo > wallet.balance_kobo:
        raise HTTPException(status_code=400, detail="Withdrawal amount exceeds wallet balance")

    charge_kobo      = await get_config_int(
        db, "wallet_instant_withdrawal_fee_kobo", DEFAULT_WALLET_WITHDRAWAL_CHARGE_KOBO
    )
    net_payable_kobo = body.amount_kobo - charge_kobo
    if net_payable_kobo <= 0:
        raise HTTPException(status_code=400, detail="Withdrawal amount too small after the ₦50 charge")

    # Daily cap on instant withdrawals — director-configurable. Unlike
    # OPay/PalmPay-style instant transfers, this isn't meant to move large
    # sums same-day; card withdrawals (which go through director review)
    # have no such cap.
    max_daily_kobo = await get_config_int(db, "max_instant_withdrawal_kobo", 5_000_000)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_total_result = await db.execute(
        select(func.coalesce(func.sum(Withdrawal.requested_amount_kobo), 0)).where(
            Withdrawal.customer_id == current_user.id,
            Withdrawal.source == WithdrawalSource.WALLET,
            Withdrawal.status == WithdrawalStatus.PAID,
            Withdrawal.processed_at >= today_start,
        )
    )
    already_withdrawn_today = today_total_result.scalar_one() or 0
    if already_withdrawn_today + body.amount_kobo > max_daily_kobo:
        remaining = max(0, max_daily_kobo - already_withdrawn_today)
        raise HTTPException(
            status_code=400,
            detail=(
                f"This would exceed your ₦{max_daily_kobo/100:,.0f} daily instant withdrawal limit. "
                f"You can withdraw up to ₦{remaining/100:,.0f} more today."
            ),
        )

    if body.auth_method == "password":
        if not body.withdrawal_password:
            raise HTTPException(status_code=400, detail="Withdrawal password required")
        await check_withdrawal_password(db, current_user, body.withdrawal_password)
    elif body.auth_method == "biometric":
        if not body.webauthn_assertion:
            raise HTTPException(status_code=400, detail="WebAuthn assertion required")
        # Cryptographically verifies the assertion against the customer's
        # actual registered credential — same real check as card
        # withdrawals, replacing the old non-empty-string-only check.
        await verify_authentication(db, current_user, body.webauthn_assertion)
    else:
        raise HTTPException(status_code=400, detail="Invalid auth method")

    ref = generate_reference()

    # SECURITY FIX (audit finding — wallet withdrawal double-spend race):
    # this used to call the external Monnify transfer FIRST and only
    # debit the wallet "once the transfer is confirmed successful". The
    # balance check above (`if body.amount_kobo > wallet.balance_kobo`)
    # is a plain read with no row lock, so two near-simultaneous
    # requests could both pass it, both reach Monnify, and both get a
    # real external payout sent — genuinely double-spent money — before
    # either one ever touched the row lock in debit_wallet. Only
    # afterward would they compete for that lock, by which point it's
    # too late: the money's already gone out twice.
    #
    # Correct order: lock and debit the wallet FIRST. debit_wallet's
    # SELECT ... FOR UPDATE means only one of two concurrent requests
    # can ever win that lock and successfully decrement the balance —
    # the second sees the already-reduced balance and fails with a
    # plain "insufficient balance" error, BEFORE any external transfer
    # is ever attempted. Money is reserved internally before it's ever
    # promised externally, not the other way around.
    #
    # If the external transfer then fails (Monnify error, timeout, or a
    # non-SUCCESS response) AFTER the debit already succeeded, the
    # wallet is credited back — a compensating transaction, since an
    # external payment provider can't be part of the same database
    # transaction as the internal debit.
    # Generated up front (not after the Withdrawal insert below) so
    # the debit — and any reversal credit — can link back to it via
    # related_entity_id from the moment it's recorded, rather than
    # leaving the SUCCESS-path debit with no linkage at all.
    withdrawal_id = uuid.uuid4()

    await debit_wallet(
        db,
        wallet=       wallet,
        amount_kobo=  body.amount_kobo,
        category=     TxCategory.WITHDRAWAL,
        reference=    ref,
        description=  f"Withdrawal to {current_user.bank_name} ({current_user.account_number})",
        initiated_by= current_user.id,
        related_entity_type="withdrawal",
        related_entity_id=withdrawal_id,
    )

    provider = get_payment_provider()
    try:
        result = await provider.initiate_transfer(
            amount_kobo=                 net_payable_kobo,
            reference=                   ref,
            narration=                   "MonieKing wallet withdrawal",
            destination_bank_code=       bank_code,
            destination_account_number=  current_user.account_number,
            destination_account_name=    current_user.account_name,
        )
    except Exception as e:
        print(f"[wallets] Transfer initiation failed for user {current_user.id}, ref {ref}: {e}")
        await credit_wallet(
            db, wallet=wallet, amount_kobo=body.amount_kobo,
            category=TxCategory.WITHDRAWAL, reference=f"{ref}-reversal",
            description="Reversal — transfer initiation failed", initiated_by=current_user.id,
            related_entity_type="withdrawal", related_entity_id=withdrawal_id,
        )
        raise HTTPException(status_code=502, detail="Transfer could not be initiated. Please try again.")

    if result.status == "PENDING_AUTHORIZATION":
        await credit_wallet(
            db, wallet=wallet, amount_kobo=body.amount_kobo,
            category=TxCategory.WITHDRAWAL, reference=f"{ref}-reversal",
            description="Reversal — transfer requires provider-side authorization", initiated_by=current_user.id,
            related_entity_type="withdrawal", related_entity_id=withdrawal_id,
        )
        raise HTTPException(
            status_code=503,
            detail="Instant transfers are temporarily unavailable (authorization required on the payment "
                   "provider side). Please try again later or contact support.",
        )
    if result.status != "SUCCESS":
        await credit_wallet(
            db, wallet=wallet, amount_kobo=body.amount_kobo,
            category=TxCategory.WITHDRAWAL, reference=f"{ref}-reversal",
            description="Reversal — transfer failed", initiated_by=current_user.id,
            related_entity_type="withdrawal", related_entity_id=withdrawal_id,
        )
        raise HTTPException(status_code=502, detail="Transfer failed. Please try again.")

    withdrawal = Withdrawal(
        id=                      withdrawal_id,
        customer_id=            current_user.id,
        card_id=                None,
        source=                 WithdrawalSource.WALLET,
        requested_amount_kobo=  body.amount_kobo,
        charge_kobo=            charge_kobo,
        net_payable_kobo=       net_payable_kobo,
        bank_name=              current_user.bank_name,
        account_number=         current_user.account_number,
        account_name=           current_user.account_name,
        status=                 WithdrawalStatus.PAID,
        processed_at=           datetime.now(timezone.utc),
    )
    db.add(withdrawal)
    await db.flush()

    await send_notification(
        db, user_id=current_user.id,
        title="Withdrawal successful ✓",
        body=f"₦{net_payable_kobo // 100:,} has been sent to your account {current_user.account_number}.",
        type=NotificationType.SUCCESS,
        related_entity_id=withdrawal.id, deep_link_url="/customer/wallet/transactions",
    )

    await log_action(
        db, actor_id=current_user.id, action="wallet_withdrawal.paid",
        entity_type="withdrawal", entity_id=str(withdrawal.id),
        new_value={"amount_kobo": body.amount_kobo, "charge_kobo": charge_kobo, "net_kobo": net_payable_kobo},
        ip_address=request.client.host if request else None,
    )
    return WithdrawalResponse.model_validate(withdrawal).model_copy(
        update={"wallet_balance_kobo": wallet.balance_kobo},
    )


@router.get("/me/transactions", response_model=PaginatedTransactions)
async def get_my_transactions(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    page_size: int = 20,
    start_date: str | None = None,   # ISO date, e.g. "2026-08-01"
    end_date: str | None = None,
):
    wallet = await get_or_create_wallet(db, current_user.id)

    filters = [WalletTransaction.wallet_id == wallet.id]
    if start_date:
        filters.append(WalletTransaction.created_at >= datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc))
    if end_date:
        # Inclusive of the whole end day — same reasoning as the summary
        # endpoint above: picking "today" as the end date should include
        # today's transactions, not stop at midnight.
        filters.append(
            WalletTransaction.created_at < datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1)
        )

    count_result = await db.execute(
        select(func.count()).select_from(WalletTransaction).where(*filters)
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(WalletTransaction)
        .where(*filters)
        .order_by(WalletTransaction.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    txs = result.scalars().all()

    return PaginatedTransactions(
        data=      list(txs),
        total=     total,
        page=      page,
        page_size= page_size,
        has_next=  (page * page_size) < total,
    )

@router.get("/transactions/{transaction_id}/receipt")
async def get_transaction_receipt(
    transaction_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Everything the universal receipt page needs for one transaction:
    the transaction's own fields, a reproducible verification code, and
    structured, type-specific detail resolved via related_entity_type
    (falling back gracefully to just the description for transaction
    types with nothing further to join against, or old rows that
    predate the related_entity_type/id columns — see receipt_service.py).

    Access: the wallet's own owner, or a director/admin for oversight
    and dispute-review purposes. Never any other customer's wallet.
    """
    tx = await db.get(WalletTransaction, transaction_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    wallet = await db.get(Wallet, tx.wallet_id)
    is_owner = wallet is not None and wallet.owner_id == current_user.id
    is_staff = current_user.role in (UserRole.DIRECTOR, UserRole.ADMIN)
    if not (is_owner or is_staff):
        raise HTTPException(status_code=403, detail="You don't have access to this transaction")

    details = await build_receipt_details(db, tx)
    owner = await db.get(User, wallet.owner_id) if wallet else None

    return {
        "id":                   str(tx.id),
        "type":                 tx.type.value if hasattr(tx.type, "value") else str(tx.type),
        "category":             tx.category.value if hasattr(tx.category, "value") else str(tx.category),
        "amount_kobo":          tx.amount_kobo,
        "balance_after_kobo":   tx.balance_after_kobo,
        "reference":            tx.reference,
        "description":          tx.description,
        "created_at":           tx.created_at.isoformat(),
        "account_holder_name":  owner.full_name if owner else None,
        "verification_code":    build_verification_code(tx),
        "details":              details,
        **(await failure_info(db, tx)),
    }


@router.get("/me/summary", response_model=WalletSummaryResponse)
async def get_my_wallet_summary(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    range: str = "all",   # "week" | "month" | "all" | "custom"
    start_date: str | None = None,   # ISO date, e.g. "2026-08-01" — used when range="custom"
    end_date: str | None = None,
):
    """Money in / out totals for the wallet stat cards. Computed as a
    single aggregate SQL query (not summed client-side from a paginated
    transaction list, which was only ever the most recent 20 rows and
    silently undercounted anyone with more history than that)."""
    wallet = await get_or_create_wallet(db, current_user.id)

    now = datetime.now(timezone.utc)
    since: datetime | None = None
    until: datetime | None = None
    if range == "custom" and start_date:
        since = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
        label = "Custom range"
        if end_date:
            # Inclusive of the whole end day, not just midnight — a
            # customer picking "today" as the end date expects today's
            # transactions to actually show up.
            until = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1)
    elif range == "week":
        since, label = now - timedelta(days=7), "Last 7 days"
    elif range == "month":
        since, label = now - timedelta(days=30), "Last 30 days"
    else:
        since, label = None, "All time"

    filters = [WalletTransaction.wallet_id == wallet.id]
    if since:
        filters.append(WalletTransaction.created_at >= since)
    if until:
        filters.append(WalletTransaction.created_at < until)

    total_in, total_out = await net_in_out(db, wallet.id, filters)

    return WalletSummaryResponse(total_in_kobo=total_in, total_out_kobo=total_out, range_label=label)


@router.get("/{user_id}", response_model=WalletResponse)
async def get_user_wallet(
    user_id: uuid.UUID,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Wallet).where(Wallet.owner_id == user_id))
    wallet = result.scalar_one_or_none()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    return wallet
