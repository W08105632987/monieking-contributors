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
from app.services.card_service import evaluate_withdrawal, recompute_card_completion_status
from app.utils.audit import log_action
from app.services.notification_service import send_notification

router = APIRouter(prefix="/withdrawals", tags=["withdrawals"])


async def _notify_customers_officer(
    db: AsyncSession, *, customer_id: uuid.UUID, title: str, body: str,
    type: NotificationType, related_entity_id: uuid.UUID,
) -> None:
    """Whoever CURRENTLY covers this customer's zone gets told when a
    director approves or rejects one of their customers' withdrawals —
    not just the customer themselves. Zone-based like everywhere else in
    this app (disputes, card access): if zone coverage changed since the
    withdrawal was submitted, this notifies whoever covers it now, not a
    stale snapshot of who covered it back then."""
    customer_result = await db.execute(select(User.zone_id).where(User.id == customer_id))
    zone_id = customer_result.scalar_one_or_none()
    if not zone_id:
        return
    officer_result = await db.execute(
        select(User).where(User.zone_id == zone_id, User.role == UserRole.OFFICER)
    )
    officer = officer_result.scalar_one_or_none()
    if officer:
        await send_notification(
            db, user_id=officer.id, title=title, body=body,
            type=type, related_entity_id=related_entity_id,
        )


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
        # can show them in red. Tag each with the withdrawal's id (now safely
        # persisted above) so a rejection can find exactly these records later
        # and reverse precisely this — never a guess.
        for record in evaluation["records"]:
            record.is_withdrawn = True
            record.withdrawal_id = withdrawal_id
        # Deliberately NOT touching card.total_days_contributed here.
        # total_days_contributed means "days filled" — contribution progress
        # toward 372 — and every single place across both portals that reads
        # it (progress bars, "X / 372 days" labels, the dashboard's total)
        # expects it to only ever go up. It used to be decremented here,
        # which corrupted that everywhere: withdraw a card's worth of money
        # and its progress bar would silently jump backwards, sometimes all
        # the way back to "372 days left" on a card that had actually been
        # filled the whole time. What actually changes on withdrawal is
        # is_withdrawn on the individual records (set above) — that's the
        # real source of truth for what's been paid out, and it's what the
        # grid, evaluate_withdrawal, and the drained-check below all already
        # correctly read from directly.
        card.total_contributed_kobo -= body.amount_kobo

        # A withdrawn slot is gone for good — it never reopens room on a
        # completed card. But if every single one of the card's 372 slots has
        # now been used AND every one of them has been withdrawn (fully
        # drained, nothing left, no room for more), the card is genuinely
        # done — close it. Checked directly against is_withdrawn, not the
        # (deliberately untouched) total_days_contributed counter above.
        total_slots_result = await db.execute(
            select(func.count()).select_from(ContributionRecord).where(ContributionRecord.card_id == card.id)
        )
        total_slots_used = total_slots_result.scalar_one()
        unwithdrawn_result = await db.execute(
            select(func.count()).select_from(ContributionRecord).where(
                ContributionRecord.card_id == card.id, ContributionRecord.is_withdrawn == False,
            )
        )
        unwithdrawn_count = unwithdrawn_result.scalar_one()
        if total_slots_used >= 372 and unwithdrawn_count == 0:
            card.status = CardStatus.ARCHIVED

        # Keep the paid/unpaid/partially-paid badge honest the moment this
        # withdrawal is requested — the grid already turns these slots red
        # immediately (not waiting for director approval), so the badge
        # should reflect the same "as good as withdrawn" state, not lag
        # behind it. No-ops on a card that isn't completed yet.
        await recompute_card_completion_status(db, card)

        await db.flush()

        # The customer is the one whose money this actually is — they get
        # notified regardless of who submitted the request. Previously this
        # went to current_user.id with "Your withdrawal...", which meant an
        # officer submitting on a customer's behalf got a notification
        # phrased as if it were their own money moving, and the actual
        # customer never heard about it at all.
        await send_notification(
            db, user_id=customer.id,
            title="Withdrawal request submitted",
            body=f"Your withdrawal of ₦{body.amount_kobo // 100:,} is being processed. "
                 f"You will receive ₦{net_payable_kobo // 100:,} after charges.",
            type=NotificationType.INFO,
            related_entity_id=withdrawal.id,
        )
        if current_user.id != customer.id:
            # An officer submitted this on the customer's behalf — they get
            # their own confirmation too, but referencing whose money it is
            # rather than implying it's theirs.
            await send_notification(
                db, user_id=current_user.id,
                title="Withdrawal request submitted",
                body=f"{customer.full_name}'s withdrawal of ₦{body.amount_kobo // 100:,} is being processed. "
                     f"They will receive ₦{net_payable_kobo // 100:,} after charges.",
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
    if card:
        await recompute_card_completion_status(db, card)

    await send_notification(
        db, user_id=withdrawal.customer_id,
        title="Withdrawal paid ✓",
        body=f"₦{withdrawal.net_payable_kobo // 100:,} has been transferred to your account {withdrawal.account_number}.",
        type=NotificationType.SUCCESS,
        related_entity_id=withdrawal.id,
    )
    customer_name_result = await db.execute(select(User.full_name).where(User.id == withdrawal.customer_id))
    customer_name = customer_name_result.scalar_one_or_none() or "A customer"
    await _notify_customers_officer(
        db, customer_id=withdrawal.customer_id,
        title="Withdrawal approved ✓",
        body=f"{customer_name}'s withdrawal of ₦{withdrawal.net_payable_kobo // 100:,} has been paid out.",
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

            # Only reversing is_withdrawn and the money — total_days_contributed
            # was never touched by the withdrawal (see request_withdrawal above),
            # so there's nothing to undo there.
            card.total_contributed_kobo += withdrawal.requested_amount_kobo

            # A card that got archived because this withdrawal drained it
            # completely is no longer drained now that it's reversed.
            if card.status == CardStatus.ARCHIVED:
                card.status = CardStatus.ACTIVE
                # Back to active means the paid/unpaid badge doesn't apply
                # anymore at all — that's a COMPLETED-card-only concept.
                card.completion_status = None
            else:
                # Still completed (372/372), just reverse the badge to
                # match: e.g. a partial withdrawal getting rejected should
                # drop the card from "Partially paid" back to "Unpaid",
                # not leave it showing money that was never actually paid.
                await recompute_card_completion_status(db, card)

    await db.flush()

    await send_notification(
        db, user_id=withdrawal.customer_id,
        title="Withdrawal rejected",
        body=f"Your withdrawal of ₦{withdrawal.requested_amount_kobo // 100:,} was rejected. "
             f"Reason: {body.reason}",
        type=NotificationType.ERROR,
        related_entity_id=withdrawal.id,
    )
    customer_name_result = await db.execute(select(User.full_name).where(User.id == withdrawal.customer_id))
    customer_name = customer_name_result.scalar_one_or_none() or "A customer"
    await _notify_customers_officer(
        db, customer_id=withdrawal.customer_id,
        title="Withdrawal rejected",
        body=f"{customer_name}'s withdrawal of ₦{withdrawal.requested_amount_kobo // 100:,} was rejected. "
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
