"""
Customer Statistics — shared aggregation logic behind the new director/
officer "accounting tool" panel (director general dashboard, director →
officer detail, officer's own dashboard + its "See more" detail page).

One service, three callers, so the active/inactive/food/regular math is
written exactly once. Scope is always expressed the same way: zone_id is
None for the director's platform-wide view, or a specific zone UUID for
"director looking at one officer" and "officer looking at their own
zone" — both of those are just User.zone_id filters, the same source of
truth the rest of the app already uses for who manages which customers.

Two independent definitions of "inactive" are in play here, and it's
important they never get merged into one:

  UNIVERSAL (used everywhere, in the "Active contributors" /
  "Inactive contributors" counts): every one of the customer's
  contribution cards has zero un-withdrawn balance. A card that was
  never contributed to and a card that's been fully withdrawn look
  identical under this rule, by design (see the product decision this
  encodes: "Inactive (zero balance, same bucket as fully-withdrawn)").

  OFFICER-ONLY (used only in the officer's detailed inactive-customer
  list): no contribution posted in the last OFFICER_INACTIVITY_DAYS
  days, independent of balance — a customer can be sitting on money
  (universal-active) and still show this badge if they've stopped
  paying in.

A customer can carry either flag, both, or neither on the officer's
list; the two are computed and returned separately (never collapsed
into one boolean) so the frontend can show the distinguishing badge the
product spec calls for.
"""
import uuid
from datetime import date, datetime, timezone, timedelta
from dataclasses import dataclass

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.card import ContributionCard, ContributionRecord, CardType
from app.models.notification import Notification, NotificationType

OFFICER_INACTIVITY_DAYS = 30


def date_range_filters(start_date: date | None, end_date: date | None) -> tuple[datetime | None, datetime | None]:
    """Same interpretation as admin.py's _date_range_filters — inclusive
    end date, both None means all-time. Kept as its own copy here rather
    than importing from admin.py, since admin.py's version is a route-file
    private helper, not a shared one."""
    start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc) if start_date else None
    end_dt = (
        datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
        if end_date else None
    )
    return start_dt, end_dt


def previous_period(start_dt: datetime | None, end_dt: datetime | None) -> tuple[datetime | None, datetime | None]:
    """The equal-length window immediately before [start_dt, end_dt), for
    trend arrows. Returns (None, None) when either bound is open-ended
    ("all time" has no meaningful previous period to compare against) —
    callers should skip the trend entirely in that case, not show a
    misleading 0%/∞ delta."""
    if start_dt is None or end_dt is None:
        return None, None
    length = end_dt - start_dt
    return start_dt - length, start_dt


def _customer_filters(zone_id: uuid.UUID | None) -> list:
    filters = [User.role == UserRole.CUSTOMER]
    if zone_id is not None:
        filters.append(User.zone_id == zone_id)
    return filters


async def get_overview(
    db: AsyncSession,
    *,
    zone_id: uuid.UUID | None,
    start_dt: datetime | None,
    end_dt: datetime | None,
) -> dict:
    """
    The "Customer Statistics" panel numbers: total/food/regular/active/
    inactive/new contributors, plus the total value currently held on
    behalf of customers. zone_id=None is platform-wide (director general
    dashboard); a real zone_id scopes to "director viewing one officer"
    or "officer's own dashboard" identically.

    Food/regular is an exhaustive partition of "has at least one card":
    a customer counts as a food contributor if ANY of their cards is a
    food card, regular otherwise. This is the one place a customer with
    genuinely mixed card types could look surprising (classified as
    "food" despite also holding a regular card) — deliberate, since it's
    the only classification rule that keeps food + regular == total an
    identity rather than something that can drift, which the business
    explicitly asked for.
    """
    customer_filters = _customer_filters(zone_id)

    contributor_owners = (
        select(ContributionCard.owner_id)
        .join(User, User.id == ContributionCard.owner_id)
        .where(*customer_filters)
        .distinct()
    )
    food_owners = (
        select(ContributionCard.owner_id)
        .join(User, User.id == ContributionCard.owner_id)
        .where(*customer_filters, ContributionCard.card_type == CardType.FOOD)
        .distinct()
    )
    # "Active" ground truth mirrors card_service.evaluate_withdrawal: a
    # card's available balance is the sum of its NOT-yet-withdrawn
    # contribution records, not the cached total_contributed_kobo minus
    # something computed elsewhere. A customer is active the moment any
    # one of their cards has at least one un-withdrawn record — this
    # single EXISTS-style join covers the 3-card example from the brief
    # (2 of 3 fully withdrawn changes nothing) and the "never funded"
    # edge case (no records at all ⇒ never appears here ⇒ inactive) in
    # one query, with no special-casing.
    active_owners = (
        select(ContributionCard.owner_id)
        .join(User, User.id == ContributionCard.owner_id)
        .join(ContributionRecord, ContributionRecord.card_id == ContributionCard.id)
        .where(*customer_filters, ContributionRecord.is_withdrawn == False)  # noqa: E712
        .distinct()
    )

    new_filters = list(customer_filters)
    if start_dt: new_filters.append(User.created_at >= start_dt)
    if end_dt:   new_filters.append(User.created_at < end_dt)

    # One round trip for every count — same "combine into scalar
    # subqueries" fix already used in admin.py's /analytics.
    combined = (await db.execute(
        select(
            select(func.count()).select_from(contributor_owners.subquery())
                .scalar_subquery().label("total_contributors"),
            select(func.count()).select_from(food_owners.subquery())
                .scalar_subquery().label("food_contributors"),
            select(func.count()).select_from(active_owners.subquery())
                .scalar_subquery().label("active_contributors"),
            select(func.count(User.id)).where(*new_filters)
                .scalar_subquery().label("new_contributors"),
            select(func.coalesce(func.sum(ContributionRecord.amount_kobo), 0))
                .select_from(ContributionRecord)
                .join(ContributionCard, ContributionCard.id == ContributionRecord.card_id)
                .join(User, User.id == ContributionCard.owner_id)
                .where(*customer_filters, ContributionRecord.is_withdrawn == False)  # noqa: E712
                .scalar_subquery().label("total_value_active"),
        )
    )).one()

    total_contributors    = combined.total_contributors or 0
    food_contributors     = combined.food_contributors or 0
    active_contributors   = combined.active_contributors or 0

    return {
        "total_contributors":      total_contributors,
        "food_contributors":       food_contributors,
        "regular_contributors":    total_contributors - food_contributors,
        "active_contributors":     active_contributors,
        "inactive_contributors":   total_contributors - active_contributors,
        "new_contributors":        combined.new_contributors or 0,
        "total_value_active_kobo": combined.total_value_active or 0,
    }


def _pct_change(current: int, previous: int) -> float | None:
    """None means "no baseline to compare to" (previous period had
    nothing) — the frontend renders that as a flat/neutral state rather
    than a nonsensical percentage."""
    if previous == 0:
        return None if current == 0 else 100.0
    return round(((current - previous) / previous) * 100, 1)


async def get_overview_with_trend(
    db: AsyncSession,
    *,
    zone_id: uuid.UUID | None,
    start_date: date | None,
    end_date: date | None,
    all_time: bool = False,
) -> dict:
    """Wraps get_overview with the trend arrows: same numbers for the
    immediately-preceding equal-length period, expressed as a %
    change per metric.
    Defaults to rolling 12-month window when date range is omitted to avoid
    expensive unbounded scans on dashboard load (1.5)."""
    if not all_time and start_date is None and end_date is None:
        start_date = date.today() - timedelta(days=365)

    start_dt, end_dt = date_range_filters(start_date, end_date)
    current = await get_overview(db, zone_id=zone_id, start_dt=start_dt, end_dt=end_dt)

    prev_start, prev_end = previous_period(start_dt, end_dt)
    trend = None
    if prev_start is not None:
        previous = await get_overview(db, zone_id=zone_id, start_dt=prev_start, end_dt=prev_end)
        trend = {
            key: _pct_change(current[key], previous[key])
            for key in ("total_contributors", "food_contributors", "regular_contributors",
                        "active_contributors", "inactive_contributors", "new_contributors",
                        "total_value_active_kobo")
        }

    return {
        **current,
        "trend": trend,
        "period": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date":   end_date.isoformat() if end_date else None,
        },
    }


async def get_officer_contribution_stats(
    db: AsyncSession,
    *,
    officer_id: uuid.UUID,
    start_date: date | None,
    end_date: date | None,
) -> dict:
    """How much a specific officer has personally gathered — every
    ContributionRecord where contributed_by is that officer (this is the
    field post_contribution sets to whoever actually posted the payment,
    officer or self-service customer, so filtering on it is exactly "did
    this officer key this in"), for the given period."""
    start_dt, end_dt = date_range_filters(start_date, end_date)
    filters = [ContributionRecord.contributed_by == officer_id]
    if start_dt: filters.append(ContributionRecord.created_at >= start_dt)
    if end_dt:   filters.append(ContributionRecord.created_at < end_dt)

    combined = (await db.execute(
        select(
            func.coalesce(func.sum(ContributionRecord.amount_kobo), 0).label("amount"),
            func.count(ContributionRecord.id).label("count"),
        ).where(*filters)
    )).one()

    return {
        "officer_id": str(officer_id),
        "amount_gathered_kobo": combined.amount or 0,
        "contribution_count": combined.count or 0,
        "period": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date":   end_date.isoformat() if end_date else None,
        },
    }


@dataclass
class InactiveCustomerRow:
    id: uuid.UUID
    customer_number: int
    full_name: str
    phone_number: str
    withdrawn_all: bool          # universal definition
    no_recent_contribution: bool # officer-only definition
    last_contribution_at: datetime | None
    last_contacted_at: datetime | None


async def get_inactive_customers(
    db: AsyncSession,
    *,
    zone_id: uuid.UUID | None,
    include_officer_reason: bool,
    page: int,
    page_size: int,
) -> tuple[list[InactiveCustomerRow], int]:
    """
    The officer's (or director's, when viewing a zone) inactive-customer
    list — universal-inactive (all cards withdrawn/never funded) always
    included; the officer-only "hasn't paid in 30 days" flag added only
    when include_officer_reason=True, since that definition doesn't
    apply on the director's general/zone overview per the spec.

    Sorted oldest-contribution-gap-first (longest-silent customer at the
    top) — pairs naturally with the tap-to-call button on the officer's
    page: the customer most overdue for a nudge is the one you see
    first. NULLs (never contributed at all) sort to the very top, since
    "never paid" is at least as urgent as "stopped paying long ago".
    """
    customer_filters = _customer_filters(zone_id)

    # Per-customer: has any un-withdrawn record (excluded — that's the
    # active set) and their most recent contribution timestamp, if any.
    last_contribution = (
        select(
            ContributionCard.owner_id.label("owner_id"),
            func.max(ContributionRecord.created_at).label("last_contribution_at"),
        )
        .join(ContributionRecord, ContributionRecord.card_id == ContributionCard.id)
        .group_by(ContributionCard.owner_id)
        .subquery()
    )

    active_owners = (
        select(ContributionCard.owner_id)
        .join(ContributionRecord, ContributionRecord.card_id == ContributionCard.id)
        .where(ContributionRecord.is_withdrawn == False)  # noqa: E712
        .distinct()
        .subquery()
    )

    cutoff = datetime.now(timezone.utc) - timedelta(days=OFFICER_INACTIVITY_DAYS)

    base_query = (
        select(
            User.id, User.customer_number, User.full_name, User.phone_number,
            User.last_contacted_at,
            last_contribution.c.last_contribution_at,
        )
        .select_from(User)
        .outerjoin(last_contribution, last_contribution.c.owner_id == User.id)
        .outerjoin(active_owners, active_owners.c.owner_id == User.id)
        .where(*customer_filters, active_owners.c.owner_id.is_(None))  # not in the active set
    )

    count_query = select(func.count()).select_from(base_query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    ordered = base_query.order_by(
        last_contribution.c.last_contribution_at.asc().nulls_first(),
    ).offset((page - 1) * page_size).limit(page_size)

    rows = (await db.execute(ordered)).all()

    results = []
    for r in rows:
        no_recent = r.last_contribution_at is None or r.last_contribution_at < cutoff
        results.append(InactiveCustomerRow(
            id=r.id,
            customer_number=r.customer_number,
            full_name=r.full_name,
            phone_number=r.phone_number,
            withdrawn_all=True,  # every row here is, by construction, outside the active set
            no_recent_contribution=no_recent if include_officer_reason else False,
            last_contribution_at=r.last_contribution_at,
            last_contacted_at=r.last_contacted_at,
        ))
    return results, total


async def bulk_ping_customers(
    db: AsyncSession,
    *,
    customer_ids: list[uuid.UUID],
    title: str,
    body: str,
) -> int:
    """Inserts one Notification per customer in a single transaction.
    Caller (the route) owns the commit and is responsible for checking
    that every id in customer_ids is actually in scope for whoever is
    pinging (a director can ping anyone; an officer only their own
    zone's customers) BEFORE calling this — this function trusts its
    input completely."""
    if not customer_ids:
        return 0
    for customer_id in customer_ids:
        db.add(Notification(
            user_id=customer_id,
            title=title,
            body=body,
            type=NotificationType.INFO,
        ))
    await db.flush()
    return len(customer_ids)


async def mark_customer_contacted(db: AsyncSession, *, customer_id: uuid.UUID) -> None:
    customer = (await db.execute(select(User).where(User.id == customer_id))).scalar_one_or_none()
    if customer is None:
        return
    customer.last_contacted_at = datetime.now(timezone.utc)
    await db.flush()
