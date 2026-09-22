"""
Card and contribution service.
Source of truth: contribution_records table.
Card grid is derived from records on demand.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.models.card import (
    ContributionCard, ContributionRecord,
    CardType, CardStatus, CardCompletionStatus, ContributionMethod,
)
from app.models.wallet import TxCategory, Wallet
from app.core.config import settings
from app.core.security import generate_reference
from app.utils.kobo import is_valid_contribution, days_from_contribution
from app.services.wallet_service import get_or_create_wallet, debit_wallet
from app.schemas.card import GridCell, CardGridResponse


CARD_TOTAL_DAYS = settings.CARD_TOTAL_DAYS   # 372


async def recompute_card_completion_status(db: AsyncSession, card: ContributionCard) -> None:
    """
    The single source of truth for a completed card's paid/unpaid/partially-paid
    badge — call this any time a withdrawal is requested, paid, or rejected
    against a card, instead of ever setting completion_status by hand.

    Previously mark_withdrawal_paid only flipped UNPAID -> PAID when the card
    was in a WITHDRAWAL_PENDING state — a state nothing in the codebase ever
    actually set. So that transition could never fire, and every completed
    card stayed stuck on "Unpaid" forever regardless of how many withdrawals
    were made and paid out. This replaces that dead check with a real
    computation: count how many of the card's contribution records are
    withdrawn versus the total, and derive the status from that ratio —
    the same withdrawn/total split the day-grid's red/green coloring
    already uses, so the badge and the grid can never disagree.

    No-ops on a card that hasn't completed yet (completion_status is only
    meaningful — and only ever set — once a card reaches 372/372 or is
    otherwise closed); an active card's UI doesn't read this field at all.
    """
    if card.completion_status is None:
        return

    total_result = await db.execute(
        select(func.count()).select_from(ContributionRecord).where(ContributionRecord.card_id == card.id)
    )
    total = total_result.scalar_one()
    withdrawn_result = await db.execute(
        select(func.count()).select_from(ContributionRecord).where(
            ContributionRecord.card_id == card.id, ContributionRecord.is_withdrawn == True,
        )
    )
    withdrawn = withdrawn_result.scalar_one()

    if withdrawn == 0:
        card.completion_status = CardCompletionStatus.UNPAID
    elif withdrawn >= total:
        card.completion_status = CardCompletionStatus.PAID
    else:
        card.completion_status = CardCompletionStatus.PARTIALLY_PAID


async def create_card(
    db: AsyncSession,
    *,
    owner_id: uuid.UUID,
    card_type: CardType,
    rate_kobo: int,
) -> ContributionCard:
    # Food card: enforce max limit
    if card_type == CardType.FOOD:
        count_result = await db.execute(
            select(func.count()).select_from(ContributionCard).where(
                ContributionCard.owner_id == owner_id,
                ContributionCard.card_type == CardType.FOOD,
                ContributionCard.status.in_([CardStatus.ACTIVE, CardStatus.COMPLETED]),
            )
        )
        count = count_result.scalar_one()
        if count >= settings.MAX_FOOD_CARDS_PER_CUSTOMER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Maximum of {settings.MAX_FOOD_CARDS_PER_CUSTOMER} Food Cards allowed",
            )
        # Enforce enrollment window
        from datetime import date
        from app.services.settings_service import get_config_value, get_config_int
        open_from_str = await get_config_value(db, "food_card_open_from")
        open_until_str = await get_config_value(db, "food_card_open_until")
        today = datetime.now(timezone.utc).date()

        if open_from_str:
            try:
                open_from_dt = date.fromisoformat(open_from_str)
                if today < open_from_dt:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Food Card registration has not opened yet. It opens on {open_from_dt.strftime('%b %d, %Y')}.",
                    )
            except ValueError:
                pass

        if open_until_str:
            try:
                open_until_dt = date.fromisoformat(open_until_str)
                if today > open_until_dt:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Food Card registration has closed for the season. It closed on {open_until_dt.strftime('%b %d, %Y')}.",
                    )
            except ValueError:
                pass

        rate_kobo = await get_config_int(db, "food_card_rate_kobo", default=100_000)

    card = ContributionCard(
        owner_id=  owner_id,
        card_type= card_type,
        rate_kobo= rate_kobo,
    )
    db.add(card)
    await db.flush()
    return card


async def resolve_card(db: AsyncSession, card_ref: str) -> ContributionCard | None:
    """
    Look a card up by its real UUID `id`, OR by its short public
    `card_number` (e.g. "1024"). Routes take whichever string arrives in
    the URL — the frontend now links to cards by card_number, but this
    keeps the same routes working for any caller still passing the UUID
    (older links, direct API use, etc.) without needing two endpoints.
    """
    try:
        card_id = uuid.UUID(card_ref)
    except ValueError:
        card_id = None

    if card_id is not None:
        result = await db.execute(select(ContributionCard).where(ContributionCard.id == card_id))
        return result.scalar_one_or_none()

    try:
        number = int(card_ref)
    except ValueError:
        return None

    result = await db.execute(select(ContributionCard).where(ContributionCard.card_number == number))
    return result.scalar_one_or_none()


async def evaluate_withdrawal(
    db: AsyncSession,
    *,
    card: ContributionCard,
    amount_kobo: int,
) -> dict:
    """
    Dry-run calculation for a withdrawal: determines which contribution
    records (oldest first) would be consumed, the resulting charge
    (one rate_kobo per distinct month touched — not a flat single charge),
    and whether this withdrawal risks a future double-charge on a
    partially-drained month. Does not mutate anything.
    """
    if amount_kobo <= 0 or amount_kobo % card.rate_kobo != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Withdrawal amount must be a multiple of ₦{card.rate_kobo // 100:,} (the card's daily rate)",
        )
    days_to_withdraw = amount_kobo // card.rate_kobo

    result = await db.execute(
        select(ContributionRecord)
        .where(ContributionRecord.card_id == card.id, ContributionRecord.is_withdrawn == False)
        .order_by(ContributionRecord.logical_month, ContributionRecord.logical_day)
        .limit(days_to_withdraw)
    )
    records = result.scalars().all()
    if len(records) < days_to_withdraw:
        raise HTTPException(status_code=400, detail="Withdrawal amount exceeds available contributed balance")

    months_touched = sorted({r.logical_month for r in records})
    charge_kobo = card.rate_kobo * len(months_touched)
    net_payable_kobo = amount_kobo - charge_kobo

    # Risk check: was the last month we touched left only partially drained?
    # If so, a future withdrawal reaching into that same month gets charged again.
    last_month = months_touched[-1]
    total_in_last_month_result = await db.execute(
        select(func.count()).select_from(ContributionRecord).where(
            ContributionRecord.card_id == card.id,
            ContributionRecord.logical_month == last_month,
            ContributionRecord.is_withdrawn == False,
        )
    )
    total_in_last_month    = total_in_last_month_result.scalar_one()
    consumed_in_last_month = sum(1 for r in records if r.logical_month == last_month)
    is_risky = consumed_in_last_month < total_in_last_month

    return {
        "days_to_withdraw": days_to_withdraw,
        "months_touched":   len(months_touched),
        "charge_kobo":      charge_kobo,
        "net_payable_kobo": net_payable_kobo,
        "is_risky":         is_risky,
        "records":          records,
    }


async def post_contribution(
    db: AsyncSession,
    *,
    card_id: uuid.UUID,
    amount_kobo: int,
    contributed_by: uuid.UUID,
    wallet_owner_id: uuid.UUID,
    method: ContributionMethod = ContributionMethod.DIGITAL,
) -> tuple[list[ContributionRecord], ContributionCard, Wallet]:
    """
    Validate, debit wallet, insert contribution records, update card totals.
    All inside a single DB transaction (caller owns commit).

    Returns (records, card, wallet) — the caller (post_card_contribution)
    used to re-fetch the card with a SEPARATE query right after this
    returned, purely to build its response. That was redundant (this
    function already has the freshly-updated card and wallet in hand
    from the same locked rows it just wrote to) and was part of why the
    contribution response arrived without the authoritative updated
    balance/card data the frontend needed to update instantly — it had
    to wait for a completely separate refetch cycle instead. Returning
    them directly here means the route can build a complete, immediate,
    authoritative response from data that's already correct and already
    in memory, no extra round trip needed.
    """
    # Fetch card with lock
    result = await db.execute(
        select(ContributionCard).where(
            ContributionCard.id == card_id,
            ContributionCard.owner_id == contributed_by if method == ContributionMethod.DIGITAL else True,
        ).with_for_update()
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    if card.status != CardStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Card is not active")

    # Validate amount is a multiple of rate
    if not is_valid_contribution(amount_kobo, card.rate_kobo):
        next_valid = card.rate_kobo - (amount_kobo % card.rate_kobo) + amount_kobo
        raise HTTPException(
            status_code=400,
            detail=f"Amount must be a multiple of {card.rate_kobo // 100:,} (₦{card.rate_kobo // 100:,}/day). "
                   f"Next valid amount: ₦{next_valid // 100:,}",
        )

    days = days_from_contribution(amount_kobo, card.rate_kobo)

    # Check card has room. Capacity is based on every slot ever used (active
    # or withdrawn) — a withdrawn (red) slot is gone for good and never frees
    # up room, so it still counts against the 372-day cap.
    total_slots_result = await db.execute(
        select(func.count()).select_from(ContributionRecord).where(ContributionRecord.card_id == card_id)
    )
    total_slots_used = total_slots_result.scalar_one()
    remaining_days = CARD_TOTAL_DAYS - total_slots_used
    if days > remaining_days:
        raise HTTPException(
            status_code=400,
            detail=f"Only {remaining_days} day(s) remaining on this card",
        )

    next_new_slot = total_slots_used + 1

    # Debit wallet
    wallet = await get_or_create_wallet(db, wallet_owner_id)
    ref = generate_reference()
    await debit_wallet(
        db,
        wallet=          wallet,
        amount_kobo=     amount_kobo,
        category=        TxCategory.CONTRIBUTION if method == ContributionMethod.DIGITAL else TxCategory.OFFICER_CONTRIBUTION,
        reference=       ref,
        description=     f"Contribution: {days} day(s) on card #{card.card_number}",
        initiated_by=    contributed_by,
        related_card_id= card_id,
    )

    # Always append fresh slots after the highest slot ever used — a
    # withdrawn (red) slot is never reused.
    records: list[ContributionRecord] = []

    for i in range(days):
        day_number = next_new_slot + i
        logical_month = ((day_number - 1) // 31) + 1
        logical_day   = ((day_number - 1) % 31) + 1

        record = ContributionRecord(
            card_id=        card_id,
            logical_month=  logical_month,
            logical_day=    logical_day,
            amount_kobo=    card.rate_kobo,
            contributed_by= contributed_by,
            method=         method,
            reference=      f"{ref}-D{i+1:03d}",
        )
        db.add(record)
        records.append(record)

    # Update card totals
    card.total_days_contributed += days
    card.total_contributed_kobo += amount_kobo

    # Check completion — based on total slots used (active + withdrawn),
    # since that's what actually determines whether any room is left.
    if (total_slots_used + days) >= CARD_TOTAL_DAYS:
        card.status           = CardStatus.COMPLETED
        card.completed_at     = datetime.now(timezone.utc)
        # Set a placeholder first so recompute (which no-ops on None) has
        # something to work from, then let it compute the real value —
        # covers the case where some of this card's records were already
        # withdrawn before it finished filling.
        card.completion_status = CardCompletionStatus.UNPAID
        await db.flush()
        await recompute_card_completion_status(db, card)

    await db.flush()
    return records, card, wallet


def build_card_grid_from_records(
    card: ContributionCard,
    records: list[ContributionRecord],
) -> CardGridResponse:
    """Build 12×31 grid from contribution_records already fetched into
    memory — no DB access here. Split out from build_card_grid() so the
    batched /cards/grids endpoint can fetch every card's records in ONE
    query and reuse this same grid-building logic per card, instead of
    each card paying for its own round trip."""
    # Index cells by position
    by_position: dict[tuple[int, int], ContributionRecord] = {
        (r.logical_month, r.logical_day): r for r in records
    }

    grid: list[list[GridCell]] = []
    for month in range(1, 13):
        row: list[GridCell] = []
        for day in range(1, 32):
            record = by_position.get((month, day))
            row.append(GridCell(
                month=           month,
                day=             day,
                filled=          record is not None and not record.is_withdrawn,
                withdrawn=       record is not None and record.is_withdrawn,
                contribution_id= record.id if record else None,
            ))
        grid.append(row)

    return CardGridResponse(card_id=card.id, grid=grid)


async def build_card_grid(
    db: AsyncSession,
    card: ContributionCard,
) -> CardGridResponse:
    """Build 12×31 grid from contribution_records — single-card path,
    used by GET /cards/{id}/grid. Fetches that one card's records, then
    delegates to build_card_grid_from_records()."""
    result = await db.execute(
        select(ContributionRecord).where(ContributionRecord.card_id == card.id)
    )
    records = result.scalars().all()
    return build_card_grid_from_records(card, records)
