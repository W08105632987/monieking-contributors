"""Withdrawal request, claim, approve, and reject routes."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOrAdmin
from app.core.security import verify_withdrawal_password
from app.core.redis_client import get_redis
from app.core.idempotency import claim_idempotency_key, store_result, release_key, DuplicateInProgress
from app.services.webauthn_service import verify_authentication
from app.services.withdrawal_auth_service import check_withdrawal_password
from app.core.limiter import limiter
from app.models.card import ContributionCard, CardStatus, CardCompletionStatus, ContributionRecord
from app.models.withdrawal import Withdrawal, WithdrawalStatus
from app.models.user import User, UserRole
from app.models.notification import NotificationType
from app.schemas.withdrawal import WithdrawalRequest, RejectWithdrawalRequest, WithdrawalResponse
from app.services.card_service import evaluate_withdrawal
from app.utils.audit import log_action
from app.services.notification_service import send_notification

router = APIRouter(prefix="/withdrawals", tags=["withdrawals"])


@router.post("", response_model=WithdrawalResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def request_withdrawal(
    request: Request,
    body: WithdrawalRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Customer or Officer submits a withdrawal request."""
    redis = get_redis()
    idem_key = request.headers.get("Idempotency-Key")
    try:
        cached = await claim_idempotency_key(redis, str(current_user.id), idem_key)
    except DuplicateInProgress:
        raise HTTPException(status_code=409, detail="This withdrawal request is already being processed — please wait a moment.")
    if cached is not None:
        return cached

    try:
        # Fetch card WITH a row lock — without this, two concurrent withdrawal
        # requests against the same card can both read the same "available
        # balance" before either commits, both pass validation, and both
        # proceed, draining the card twice over (a real double-withdrawal
        # race, not a theoretical one). Locking here serializes every
        # concurrent request against this card, including the contribution
        # records evaluate_withdrawal reads right after — that read happens
        # while this lock is still held, so it always sees the true state.
        result = await db.execute(
            select(ContributionCard).where(ContributionCard.id == body.card_id).with_for_update()
        )
        card = result.scalar_one_or_none()
        if not card:
            raise HTTPException(status_code=404, detail="Card not found")
        if current_user.role == UserRole.CUSTOMER and card.owner_id != current_user.id:
            raise HTTPException(status_code=403, detail="You do not own this card")
        if current_user.role == UserRole.OFFICER:
            # This check was missing entirely before — any officer could
            # submit a withdrawal against any customer's card system-wide,
            # regardless of zone. Found while wiring up zone-based
            # authorization elsewhere; fixed the same way everything else
            # was — an officer can only act on a card whose owner is
            # currently in their zone.
            owner_result = await db.execute(select(User).where(User.id == card.owner_id))
            owner = owner_result.scalar_one_or_none()
            if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
                raise HTTPException(status_code=403, detail="You do not manage this customer")

        # Food card — cannot withdraw without conversion
        from app.models.card import CardType
        if card.card_type == CardType.FOOD:
            raise HTTPException(
                status_code=400,
                detail="Food Card funds are locked. Convert to Regular Card before withdrawing.",
            )

        # Check available balance on card
        if body.amount_kobo > card.total_contributed_kobo:
            raise HTTPException(status_code=400, detail="Withdrawal amount exceeds contributed balance")

        # Verify withdrawal auth
        if body.auth_method == "password":
            if not body.withdrawal_password:
                raise HTTPException(status_code=400, detail="Withdrawal password required")
            await check_withdrawal_password(db, current_user, body.withdrawal_password)
        elif body.auth_method == "biometric":
            if not body.webauthn_assertion:
                raise HTTPException(status_code=400, detail="WebAuthn assertion required")
            # Cryptographically verifies the assertion against the customer's
            # actual registered credential (public key + sign_count anti-replay).
            # Previously this only checked the field was non-empty — any junk
            # string passed. Raises 401 on any failure.
            await verify_authentication(db, current_user, body.webauthn_assertion)
        else:
            raise HTTPException(status_code=400, detail="Invalid auth method")

        # Calculate charge based on how many distinct months this withdrawal touches
        evaluation = await evaluate_withdrawal(db, card=card, amount_kobo=body.amount_kobo)
        charge_kobo      = evaluation["charge_kobo"]
        net_payable_kobo = evaluation["net_payable_kobo"]

        if net_payable_kobo <= 0:
            raise HTTPException(status_code=400, detail="Withdrawal amount too small after charge deduction")

        # Snapshot bank details
        customer = current_user
        if current_user.role == UserRole.OFFICER:
            # Officer withdrawing on behalf of manual customer — fetch customer
            cust_result = await db.execute(
                select(ContributionCard).where(ContributionCard.id == body.card_id)
            )
            # card owner is the customer
            from app.models.user import User as UserModel
            owner_result = await db.execute(
                select(UserModel).where(UserModel.id == card.owner_id)
            )
            customer = owner_result.scalar_one()

        # Create and persist the withdrawal row FIRST — contribution_records.
        # withdrawal_id has a real FK to withdrawals.id, but there's no ORM
        # relationship() linking the two models, so SQLAlchemy's automatic
        # insert-before-update ordering doesn't apply here. Flushing this now,
        # before any contribution_records are touched, guarantees the row
        # this FK points at actually exists by the time those updates run.
        withdrawal_id = uuid.uuid4()
        withdrawal = Withdrawal(
            id=                      withdrawal_id,
            customer_id=            card.owner_id,
            card_id=                body.card_id,
            requested_amount_kobo=  body.amount_kobo,
            charge_kobo=            charge_kobo,
            net_payable_kobo=       net_payable_kobo,
            bank_name=              customer.bank_name or "",
            account_number=         customer.account_number or "",
            account_name=           customer.account_name or "",
        )
        db.add(withdrawal)
        await db.flush()

        # Actually consume the withdrawn days: flag them (not delete) so the grid
        # can show them in red, and update card totals. Tag each with the
        # withdrawal's id (now safely persisted above) so a rejection can find
        # exactly these records later and reverse precisely this — never a guess.
        for record in evaluation["records"]:
            record.is_withdrawn = True
            record.withdrawal_id = withdrawal_id
        card.total_days_contributed -= evaluation["days_to_withdraw"]
        card.total_contributed_kobo -= body.amount_kobo

        # A withdrawn slot is gone for good — it never reopens room on a
        # completed card. But if every single one of the card's 372 slots has now
        # been used AND all of them are withdrawn (fully drained, nothing left,
        # no room for more), the card is genuinely done — close it.
        total_slots_result = await db.execute(
            select(func.count()).select_from(ContributionRecord).where(ContributionRecord.card_id == card.id)
        )
        total_slots_used = total_slots_result.scalar_one()
        if total_slots_used >= 372 and card.total_days_contributed == 0:
            card.status = CardStatus.ARCHIVED

        await db.flush()

        # Notify directors (broadcast)
        await send_notification(
            db, user_id=current_user.id,
            title="Withdrawal request submitted",
            body=f"Your withdrawal of ₦{body.amount_kobo // 100:,} is being processed. "
                 f"You will receive ₦{net_payable_kobo // 100:,} after charges.",
            type=NotificationType.INFO,
            related_entity_id=withdrawal.id,
        )

        await log_action(
            db, actor_id=current_user.id, action="withdrawal.requested",
            entity_type="withdrawal", entity_id=str(withdrawal.id),
            new_value={"amount_kobo": body.amount_kobo, "charge_kobo": charge_kobo, "net_kobo": net_payable_kobo},
            ip_address=request.client.host if request else None,
        )
    except Exception:
        await release_key(redis, str(current_user.id), idem_key)
        raise

    result = WithdrawalResponse.model_validate(withdrawal).model_dump(mode='json')
    await store_result(redis, str(current_user.id), idem_key, result)
    return result


@router.get("", response_model=list[WithdrawalResponse])
async def list_withdrawals(
    staff: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
    status_filter: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    query = select(Withdrawal)
    if status_filter:
        query = query.where(Withdrawal.status == status_filter)
    query = query.order_by(Withdrawal.requested_at.asc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    withdrawals = result.scalars().all()

    if not withdrawals:
        return []

    # Batch-fetch customer names/avatars rather than one query per row —
    # this also fixes the "Customer" placeholder / bare "C" avatar the
    # director previously saw when claiming a request.
    customer_ids = {w.customer_id for w in withdrawals}
    customers_result = await db.execute(select(User).where(User.id.in_(customer_ids)))
    customers_by_id = {c.id: c for c in customers_result.scalars().all()}

    enriched = []
    for w in withdrawals:
        response = WithdrawalResponse.model_validate(w)
        customer = customers_by_id.get(w.customer_id)
        if customer:
            response.customer_name = customer.full_name
            response.customer_avatar_url = customer.avatar_url
        enriched.append(response)
    return enriched


@router.post("/{withdrawal_id}/claim", response_model=WithdrawalResponse)
async def claim_withdrawal(
    withdrawal_id: uuid.UUID,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """Director claims a withdrawal. Optimistic lock prevents double-claiming."""
    result = await db.execute(
        select(Withdrawal)
        .where(Withdrawal.id == withdrawal_id, Withdrawal.status == WithdrawalStatus.PENDING)
        .with_for_update(skip_locked=True)
    )
    withdrawal = result.scalar_one_or_none()
    if not withdrawal:
        # Row was locked by someone else's transaction — Postgres already
        # resolved the race (SKIP LOCKED), we just report who won it so the
        # losing director's UI can show "claimed by X" instead of a bare 409.
        existing = await db.execute(
            select(Withdrawal, User.full_name)
            .join(User, User.id == Withdrawal.claimed_by_director_id, isouter=True)
            .where(Withdrawal.id == withdrawal_id)
        )
        row = existing.first()
        claimed_by_name = row[1] if row and row[1] else None
        raise HTTPException(
            status_code=409,
            detail=(
                f"Already claimed by {claimed_by_name}" if claimed_by_name
                else "Withdrawal not available — already claimed or does not exist"
            ),
        )

    withdrawal.status                  = WithdrawalStatus.CLAIMED
    withdrawal.claimed_by_director_id  = director.id
    withdrawal.claimed_at              = datetime.now(timezone.utc)
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="withdrawal.claimed",
        entity_type="withdrawal", entity_id=str(withdrawal_id),
        ip_address=request.client.host if request else None,
    )
    return withdrawal


@router.post("/{withdrawal_id}/mark-paid", response_model=WithdrawalResponse)
async def mark_withdrawal_paid(
    withdrawal_id: uuid.UUID,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    result = await db.execute(
        select(Withdrawal).where(
            Withdrawal.id == withdrawal_id,
            Withdrawal.status == WithdrawalStatus.CLAIMED,
            Withdrawal.claimed_by_director_id == director.id,
        ).with_for_update()
    )
    withdrawal = result.scalar_one_or_none()
    if not withdrawal:
        raise HTTPException(status_code=404, detail="Withdrawal not found or not yours to process")

    withdrawal.status       = WithdrawalStatus.PAID
    withdrawal.processed_at = datetime.now(timezone.utc)

    # Update card completion status if applicable
    card_result = await db.execute(
        select(ContributionCard).where(ContributionCard.id == withdrawal.card_id)
    )
    card = card_result.scalar_one_or_none()
    if card and card.completion_status == CardCompletionStatus.WITHDRAWAL_PENDING:
        card.completion_status = CardCompletionStatus.PAID

    await send_notification(
        db, user_id=withdrawal.customer_id,
        title="Withdrawal paid ✓",
        body=f"₦{withdrawal.net_payable_kobo // 100:,} has been transferred to your account {withdrawal.account_number}.",
        type=NotificationType.SUCCESS,
        related_entity_id=withdrawal.id,
    )

    await log_action(
        db, actor_id=director.id, action="withdrawal.paid",
        entity_type="withdrawal", entity_id=str(withdrawal_id),
        ip_address=request.client.host if request else None,
    )
    await db.flush()
    return withdrawal


@router.post("/{withdrawal_id}/reject", response_model=WithdrawalResponse)
async def reject_withdrawal(
    withdrawal_id: uuid.UUID,
    body: RejectWithdrawalRequest,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    # Locked — without this, two concurrent reject calls (double-tap, or
    # two directors racing on the same withdrawal) could both pass the
    # status check below before either commits, and both restore the
    # card's balance — crediting the customer's card twice for a single
    # rejected withdrawal. Same bug class as the double-withdrawal race
    # in request_withdrawal above, just on the reversal side instead of
    # the debit side.
    #
    # Only the director who claimed this withdrawal can reject it — same
    # rule as mark_paid (approval). A withdrawal must be claimed before
    # it can be acted on at all, by anyone.
    result = await db.execute(
        select(Withdrawal).where(
            Withdrawal.id == withdrawal_id,
            Withdrawal.status == WithdrawalStatus.CLAIMED,
            Withdrawal.claimed_by_director_id == director.id,
        ).with_for_update()
    )
    withdrawal = result.scalar_one_or_none()
    if not withdrawal:
        raise HTTPException(status_code=404, detail="Withdrawal not found, not claimed, or not claimed by you")

    withdrawal.status           = WithdrawalStatus.REJECTED
    withdrawal.rejection_reason = body.reason
    withdrawal.processed_at     = datetime.now(timezone.utc)

    # Undo exactly what request_withdrawal did — nothing was ever paid out,
    # so the money and the "red boxes" go back to how they were. Previously
    # nothing here reversed the request-time debit, so a rejected
    # withdrawal's funds just disappeared from the customer's card with no
    # payout to show for it.
    if withdrawal.card_id:
        card_result = await db.execute(
            select(ContributionCard).where(ContributionCard.id == withdrawal.card_id)
        )
        card = card_result.scalar_one_or_none()
        if card:
            records_result = await db.execute(
                select(ContributionRecord).where(ContributionRecord.withdrawal_id == withdrawal.id)
            )
            touched_records = records_result.scalars().all()
            for record in touched_records:
                record.is_withdrawn = False
                record.withdrawal_id = None

            card.total_days_contributed += len(touched_records)
            card.total_contributed_kobo += withdrawal.requested_amount_kobo

            # A card that got archived because this withdrawal drained it
            # completely is no longer drained now that it's reversed.
            if card.status == CardStatus.ARCHIVED:
                card.status = CardStatus.ACTIVE

    await db.flush()

    await send_notification(
        db, user_id=withdrawal.customer_id,
        title="Withdrawal rejected",
        body=f"Your withdrawal of ₦{withdrawal.requested_amount_kobo // 100:,} was rejected. "
             f"Reason: {body.reason}",
        type=NotificationType.ERROR,
        related_entity_id=withdrawal.id,
    )

    await log_action(
        db, actor_id=director.id, action="withdrawal.rejected",
        entity_type="withdrawal", entity_id=str(withdrawal_id),
        new_value={"reason": body.reason},
        ip_address=request.client.host if request else None,
    )
    return withdrawal
