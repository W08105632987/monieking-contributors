"""Contribution card and contribution posting routes."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import CurrentUser
from app.core.redis_client import get_redis
from app.core.idempotency import claim_idempotency_key, store_result, release_key, DuplicateInProgress
from app.models.card import ContributionCard, ContributionRecord, CardType, CardStatus, CardCompletionStatus, ContributionMethod
from app.models.user import User, UserRole
from app.models.withdrawal import Withdrawal
from app.schemas.withdrawal import WithdrawalResponse
from app.schemas.card import (
    CreateCardRequest, ContributeRequest, CloseCardRequest,
    CardResponse, CardGridResponse, ContributionRecordResponse,
)
from app.services.card_service import create_card, post_contribution, build_card_grid, build_card_grid_from_records, evaluate_withdrawal, resolve_card
from app.services.user_service import resolve_user
from app.services.withdrawal_auth_service import check_withdrawal_password
from app.utils.audit import log_action
from app.models.notification import NotificationType
from app.services.notification_service import send_notification
from app.integrations.termii import send_sms

router = APIRouter(tags=["cards"])


@router.post("/cards", response_model=CardResponse, status_code=status.HTTP_201_CREATED)
async def create_contribution_card(
    body: CreateCardRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    owner_id = current_user.id

    if body.owner_id and body.owner_id != current_user.id:
        if current_user.role != UserRole.OFFICER:
            raise HTTPException(status_code=403, detail="Only officers can create a card for another customer")
        owner_result = await db.execute(select(User).where(User.id == body.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="You do not manage this customer")
        owner_id = body.owner_id

    card = await create_card(
        db,
        owner_id=  owner_id,
        card_type= body.card_type,
        rate_kobo= body.rate_kobo,
    )
    return card


@router.get("/cards", response_model=list[CardResponse])
async def list_cards(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    include_completed: bool = False,
    owner_id: str | None = None,
):
    query = select(ContributionCard)
    if current_user.role == UserRole.CUSTOMER:
        query = query.where(ContributionCard.owner_id == current_user.id)
    elif current_user.role == UserRole.OFFICER:
        if owner_id:
            owner = await resolve_user(db, owner_id)
            if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
                raise HTTPException(status_code=403, detail="You do not manage this customer")
            query = query.where(ContributionCard.owner_id == owner.id)
        else:
            if not current_user.zone_id:
                from sqlalchemy import false
                query = query.where(false())
            else:
                query = query.join(User, User.id == ContributionCard.owner_id).where(
                    User.zone_id == current_user.zone_id
                )
    if not include_completed:
        query = query.where(ContributionCard.status == CardStatus.ACTIVE)
    query = query.order_by(ContributionCard.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/cards/grids", response_model=list[CardGridResponse])
async def get_my_card_grids(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Batched version of GET /cards/{id}/grid — returns every one of the
    current user's own cards' grids in a single round trip instead of one
    request per card. Customer-only: this is what the flippable card list
    on the Cards page uses instead of firing N separate /grid requests
    (previously the single biggest contributor to slow page loads — see
    the [TIMING] logs, N cards meant N x 3 queries all competing for the
    same connection pool at once). Registered ABOVE /cards/{card_id} —
    otherwise FastAPI would match "grids" as a card_id and this route
    would never be reached."""
    if current_user.role != UserRole.CUSTOMER:
        raise HTTPException(status_code=403, detail="Access denied")

    cards_result = await db.execute(
        select(ContributionCard).where(ContributionCard.owner_id == current_user.id)
    )
    cards = cards_result.scalars().all()
    if not cards:
        return []

    card_ids = [c.id for c in cards]
    records_result = await db.execute(
        select(ContributionRecord).where(ContributionRecord.card_id.in_(card_ids))
    )
    records = records_result.scalars().all()

    records_by_card: dict[uuid.UUID, list[ContributionRecord]] = {cid: [] for cid in card_ids}
    for r in records:
        records_by_card[r.card_id].append(r)

    return [
        build_card_grid_from_records(card, records_by_card[card.id])
        for card in cards
    ]


@router.get("/cards/{card_id}", response_model=CardResponse)
async def get_card(
    card_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    card = await resolve_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if current_user.role == UserRole.CUSTOMER and card.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == UserRole.OFFICER:
        owner_result = await db.execute(select(User).where(User.id == card.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="Access denied")

    response = CardResponse.model_validate(card)
    if card.completion_status in (CardCompletionStatus.PAID, CardCompletionStatus.WITHDRAWAL_PENDING):
        w_result = await db.execute(
            select(Withdrawal.id).where(Withdrawal.card_id == card.id).order_by(Withdrawal.requested_at.desc()).limit(1)
        )
        response.latest_withdrawal_id = w_result.scalar_one_or_none()
    return response


@router.get("/cards/{card_id}/withdrawals", response_model=list[WithdrawalResponse])
async def get_card_withdrawals(
    card_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Full withdrawal history for one card — every request ever made
    against it, whatever happened to each one (paid, rejected, still
    pending). This is what the closed-card detail page shows instead of
    the "keep contributing" UI a still-active card gets: a completed
    card's story from here on is entirely about what was withdrawn and
    when, not about filling more of the grid.
    Same authorization as the card detail endpoint above — kept
    identical on purpose, since seeing a card's history without being
    able to see the card itself makes no sense."""
    card = await resolve_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if current_user.role == UserRole.CUSTOMER and card.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == UserRole.OFFICER:
        owner_result = await db.execute(select(User).where(User.id == card.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(Withdrawal).where(Withdrawal.card_id == card.id).order_by(Withdrawal.requested_at.desc())
    )
    return result.scalars().all()


@router.get("/cards/{card_id}/grid", response_model=CardGridResponse)
async def get_card_grid(
    card_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    card = await resolve_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if current_user.role == UserRole.CUSTOMER and card.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == UserRole.OFFICER:
        owner_result = await db.execute(select(User).where(User.id == card.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="Access denied")
    return await build_card_grid(db, card)

@router.get("/cards/{card_id}/detail")
async def get_card_detail(
    card_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Combined card + grid + contribution history in one round trip.
    The officer/director Card Detail page used to call GET /cards/{id},
    GET /cards/{id}/grid, and GET /contributions/{id} separately — three
    requests that each independently re-fetched the same card row and
    re-ran the same ownership/zone check (visible in the [TIMING] logs
    as three near-identical "SELECT contribution_cards..." queries back
    to back). This does the access check once, fetches the card once and
    contribution_records once, and builds the grid from those same
    records instead of a fourth fetch."""
    card = await resolve_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if current_user.role == UserRole.CUSTOMER and card.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == UserRole.OFFICER:
        owner_result = await db.execute(select(User).where(User.id == card.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="Access denied")

    records_result = await db.execute(
        select(ContributionRecord).where(ContributionRecord.card_id == card.id)
    )
    records = records_result.scalars().all()

    grid = build_card_grid_from_records(card, records)
    contributions_sorted = sorted(records, key=lambda r: r.created_at, reverse=True)

    return {
        "card":          CardResponse.model_validate(card),
        "grid":          grid.grid,
        "contributions": [ContributionRecordResponse.model_validate(r) for r in contributions_sorted],
    }


@router.get("/cards/{card_id}/withdrawal-preview")
async def preview_card_withdrawal(
    card_id: str,
    amount_kobo: int,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    card = await resolve_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if current_user.role == UserRole.CUSTOMER and card.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == UserRole.OFFICER:
        owner_result = await db.execute(select(User).where(User.id == card.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="Access denied")

    evaluation = await evaluate_withdrawal(db, card=card, amount_kobo=amount_kobo)
    return {
        "days_to_withdraw": evaluation["days_to_withdraw"],
        "months_touched":   evaluation["months_touched"],
        "charge_kobo":      evaluation["charge_kobo"],
        "net_payable_kobo": evaluation["net_payable_kobo"],
        "is_risky":         evaluation["is_risky"],
    }


@router.get("/contributions/{card_id}", response_model=list[ContributionRecordResponse])
async def list_card_contributions(
    card_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Contribution history for a single card — what CardDetailPage's
    'recent contributions' list reads from. This route never existed
    before; the frontend has been calling it since the page was built."""
    card = await resolve_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if current_user.role == UserRole.CUSTOMER and card.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == UserRole.OFFICER:
        owner_result = await db.execute(select(User).where(User.id == card.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(ContributionRecord)
        .where(ContributionRecord.card_id == card.id)
        .order_by(ContributionRecord.created_at.desc())
    )
    return result.scalars().all()


@router.post("/contributions", response_model=dict, status_code=status.HTTP_201_CREATED)
async def post_card_contribution(
    request: Request,
    body: ContributeRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    # A double-tap, a slow network causing the client to retry, or a
    # request that actually succeeded but timed out before the response
    # arrived — any of these would otherwise post a real second
    # contribution. The frontend sends the same Idempotency-Key for
    # retries of the same user action; replay the cached result instead
    # of running this twice.
    redis = get_redis()
    idem_key = request.headers.get("Idempotency-Key")
    try:
        cached = await claim_idempotency_key(redis, str(current_user.id), idem_key)
    except DuplicateInProgress:
        raise HTTPException(status_code=409, detail="This contribution is already being processed — please wait a moment.")
    if cached is not None:
        return cached

    try:
        method = (
            ContributionMethod.DIGITAL
            if current_user.role == UserRole.CUSTOMER
            else ContributionMethod.CASH_VIA_OFFICER
        )

        if current_user.role == UserRole.OFFICER:
            # This check was missing entirely before — the service layer
            # (card_service.post_contribution) deliberately skips the
            # owner check for officer/cash contributions, since an
            # officer isn't the card owner. But nothing was verifying the
            # officer actually manages this customer either — any officer
            # could post a contribution to any customer's card
            # system-wide. Same fix as request_withdrawal: officer can
            # only act on a card whose owner is currently in their zone.
            card_check_result = await db.execute(select(ContributionCard).where(ContributionCard.id == body.card_id))
            card_check = card_check_result.scalar_one_or_none()
            if not card_check:
                raise HTTPException(status_code=404, detail="Card not found")
            owner_result = await db.execute(select(User).where(User.id == card_check.owner_id))
            owner_check = owner_result.scalar_one_or_none()
            if not owner_check or not current_user.zone_id or owner_check.zone_id != current_user.zone_id:
                raise HTTPException(status_code=403, detail="You do not manage this customer")

        records, card, wallet = await post_contribution(
            db,
            card_id=         body.card_id,
            amount_kobo=     body.amount_kobo,
            contributed_by=  current_user.id,
            wallet_owner_id= current_user.id,
            method=          method,
        )
    except Exception:
        await release_key(redis, str(current_user.id), idem_key)
        raise

    amount_str = f"₦{body.amount_kobo // 100:,}"
    is_self_contribution = card.owner_id == current_user.id
    # BUG FIX: this notification — sent to whoever ACTUALLY performed the
    # contribution (current_user), not necessarily the card owner — used
    # to say "added to your card" unconditionally. That's correct when a
    # customer contributes to their own card, but wrong the moment an
    # officer contributes on a customer's behalf: the officer isn't the
    # owner, so "your card" was misleading in their own notification feed.
    # Only fetch the owner's name when actually needed (officer/admin
    # case) — no extra query for the far more common self-contribution path.
    if is_self_contribution:
        actor_body = f"{amount_str} contributed — {len(records)} day(s) added to your card."
    else:
        owner_name_result = await db.execute(select(User.full_name).where(User.id == card.owner_id))
        owner_name = owner_name_result.scalar_one_or_none() or "the customer"
        actor_body = f"{amount_str} contributed — {len(records)} day(s) added to {owner_name}'s card."
    await send_notification(
        db, user_id=current_user.id,
        title="Contribution posted ✓",
        body=actor_body,
        type=NotificationType.SUCCESS,
        related_entity_id=body.card_id,
    )
    if card and not is_self_contribution:
        await send_notification(
            db, user_id=card.owner_id,
            title="Contribution received ✓",
            body=f"Your officer posted {amount_str} on your card — {len(records)} day(s) added.",
            type=NotificationType.SUCCESS,
            related_entity_id=body.card_id,
        )

    # SMS confirmation — every contribution, not just officer-marked
    # ones. Originally this only fired for officer/cash contributions
    # (the reasoning being a customer marking their own card already
    # sees the confirmation on screen) — but the same detailed record
    # is just as valuable for a self-service contribution: it's the
    # one message a customer can point to later showing exactly what
    # landed on which card and when, without needing to reopen the
    # app. Same template either way; the "by <officer>" clause is the
    # only part that changes, since a self-service customer isn't
    # "under" anyone marking it for them.
    if card:
        owner_result = await db.execute(select(User).where(User.id == card.owner_id))
        owner = owner_result.scalar_one_or_none()
        if owner and owner.phone_number:
            is_officer_marked = card.owner_id != current_user.id
            marked_by_clause = (
                f" by {current_user.full_name if current_user.role == UserRole.OFFICER else 'an officer'}"
                if is_officer_marked else ""
            )
            try:
                await send_sms(
                    owner.phone_number,
                    (
                        f"MonieKing: {amount_str} contributed to Card #{card.card_number} "
                        f"({card.card_type.value} card){marked_by_clause} — {len(records)} day(s) added "
                        f"for this contribution. Total contributed on Card #{card.card_number} so far: "
                        f"₦{card.total_contributed_kobo // 100:,}. Didn't make this contribution? "
                        f"Contact {'your officer or ' if is_officer_marked else ''}MonieKing support immediately."
                    ),
                )
            except Exception as e:
                # SMS delivery failing must never roll back or fail a
                # contribution that already succeeded and was already
                # debited/recorded — same fail-open principle as every
                # other non-critical side effect in this codebase (see
                # wallet_service.py's Redis idempotency comments). The
                # in-app notification above already covers confirmation
                # either way.
                print(f"[contribution-sms] failed to notify {owner.phone_number} for card {card.card_number}: {e}")

    result = {
        "message":     f"Contribution successful — {len(records)} day(s) recorded",
        "days_added":   len(records),
        # Authoritative, already-committed data from the SAME locked
        # rows this transaction just wrote — not a fresh query, and not
        # something the frontend has to go fetch separately and wait
        # on. This is what lets the UI (the card grid especially) shade
        # in immediately on response instead of waiting for a slower
        # background refetch to eventually catch up.
        "card":               CardResponse.model_validate(card).model_dump(mode="json"),
        "wallet_balance_kobo": wallet.balance_kobo,
    }
    await store_result(redis, str(current_user.id), idem_key, result)
    return result


async def _authorize_card_action(db: AsyncSession, current_user: User, card: ContributionCard) -> None:
    """Shared access check for card actions the owner or their managing
    officer can both trigger (convert, manual close)."""
    if current_user.role == UserRole.CUSTOMER and card.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="You do not own this card")
    if current_user.role == UserRole.OFFICER:
        owner_result = await db.execute(select(User).where(User.id == card.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner or not current_user.zone_id or owner.zone_id != current_user.zone_id:
            raise HTTPException(status_code=403, detail="You do not manage this customer")


@router.post("/cards/{card_id}/convert", response_model=CardResponse)
async def convert_food_card(
    card_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Converts a Food Card to a Regular Card, permanently. Food Card funds
    are locked (can't withdraw, can't manually close) until this runs —
    this is the only way to unlock them, and it's irreversible: food
    eligibility for December distribution is lost the moment this is
    called. `food_eligibility_lost_at` stays on the record afterward as a
    historical marker even though `card_type` itself changes.
    """
    card = await resolve_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    await _authorize_card_action(db, current_user, card)

    if card.card_type != CardType.FOOD:
        raise HTTPException(status_code=400, detail="This is not a Food Card")
    if card.status not in (CardStatus.ACTIVE, CardStatus.COMPLETED):
        raise HTTPException(status_code=400, detail="This card can no longer be converted")

    card.card_type = CardType.REGULAR
    card.food_eligibility_lost_at = datetime.now(timezone.utc)
    await db.flush()

    await log_action(
        db, actor_id=current_user.id, action="card.converted",
        entity_type="card", entity_id=str(card.id),
        new_value={"card_type": "regular"},
    )

    if card.owner_id != current_user.id:
        await send_notification(
            db, user_id=card.owner_id,
            title="Food Card converted",
            body="Your officer converted your Food Card to a Regular Card. Food eligibility for this card has been permanently lost, but funds are now withdrawable.",
            type=NotificationType.INFO,
            related_entity_id=card.id,
        )

    return card


@router.post("/cards/{card_id}/close", response_model=CardResponse)
async def close_card_manually(
    card_id: str,
    body: CloseCardRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually closes a card before it's naturally filled to 372 days —
    the customer or their officer no longer wants to keep contributing
    to it. Behaves exactly like natural completion: contributed funds
    become withdrawable the same way a fully-filled card's funds are.
    Unfilled days are simply given up; nothing is refunded or charged,
    since no money moves in this step — it only changes what state the
    card is in. Requires the acting user's own withdrawal password,
    same security bar as an actual withdrawal.
    """
    card = await resolve_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    await _authorize_card_action(db, current_user, card)

    if card.card_type == CardType.FOOD:
        raise HTTPException(
            status_code=400,
            detail="Food Card funds are locked. Convert to Regular Card before closing.",
        )
    if card.status != CardStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="This card is already closed")
    if card.total_contributed_kobo <= 0:
        raise HTTPException(status_code=400, detail="Nothing to close — this card has no contributions yet")

    await check_withdrawal_password(db, current_user, body.withdrawal_password)

    card.status            = CardStatus.COMPLETED
    card.completion_status = CardCompletionStatus.UNPAID
    card.completed_at      = datetime.now(timezone.utc)
    await db.flush()

    await log_action(
        db, actor_id=current_user.id, action="card.closed_manually",
        entity_type="card", entity_id=str(card.id),
        new_value={"total_contributed_kobo": card.total_contributed_kobo},
    )

    await send_notification(
        db, user_id=card.owner_id,
        title="Card closed",
        body=f"Card #{card.card_number} was manually closed with ₦{card.total_contributed_kobo // 100:,} available. You can request a withdrawal any time.",
        type=NotificationType.INFO,
        related_entity_id=card.id,
    )

    return card