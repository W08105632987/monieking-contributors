"""Admin-only analytics, audit log, and system config routes."""
from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.user import User, UserRole, LocationConsentStatus
from app.models.card import ContributionCard, ContributionRecord, CardStatus, CardType
from app.models.wallet import Wallet, WalletTransaction
from app.models.withdrawal import Withdrawal, WithdrawalStatus, WithdrawalSource
from app.models.audit import AuditLog

router = APIRouter(prefix="/admin", tags=["admin"])


def _date_range_filters(start_date: date | None, end_date: date | None):
    """
    Turns optional start/end dates into inclusive datetime bounds. Both
    None means "all time" — no filter applied. This is the one shared
    interpretation used by /analytics, /profit-report, and the frontend's
    month picker (which just computes first/last day of the month and
    sends them the same way arbitrary date-range filtering does).
    """
    start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc) if start_date else None
    end_dt = (
        datetime.combine(end_date, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
        if end_date else None
    )
    return start_dt, end_dt


@router.get("/analytics")
async def get_system_analytics(
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
    start_date: date | None = None,
    end_date: date | None = None,
):
    """
    System-wide dashboard statistics. start_date/end_date are optional —
    omit both for all-time. The three "flow" numbers (contributed, paid
    out, charges) are filtered by them; the "snapshot" numbers
    (users_by_role, active cards, pending withdrawals) are always
    current-state and not affected by the date range — a date range can't
    change how many cards are active *right now*.
    """
    start_dt, end_dt = _date_range_filters(start_date, end_date)

    start_dt, end_dt = _date_range_filters(start_date, end_date)

    contributed_filter = []
    if start_dt: contributed_filter.append(ContributionRecord.created_at >= start_dt)
    if end_dt:   contributed_filter.append(ContributionRecord.created_at < end_dt)

    paid_out_filter = [Withdrawal.status == WithdrawalStatus.PAID]
    if start_dt: paid_out_filter.append(Withdrawal.processed_at >= start_dt)
    if end_dt:   paid_out_filter.append(Withdrawal.processed_at < end_dt)

    # One round trip instead of seven: every snapshot/flow number below
    # used to be its own separate `await db.execute(...)` — 7 sequential
    # network round trips to the DB every time this page loaded (that's
    # the "(8 queries)" — 7 of these plus the auth lookup — flagged
    # "<<< POSSIBLE N+1" in the [TIMING] logs). Wrapping each as a scalar
    # subquery inside one SELECT means Postgres computes all of them
    # server-side and sends back a single row.
    combined = (await db.execute(
        select(
            select(func.count(ContributionCard.id))
                .where(ContributionCard.status == CardStatus.ACTIVE)
                .scalar_subquery().label("total_active_cards"),
            select(func.count(ContributionCard.id))
                .where(ContributionCard.card_type == CardType.FOOD, ContributionCard.status == CardStatus.ACTIVE)
                .scalar_subquery().label("total_food_cards"),
            select(func.count(Withdrawal.id))
                .where(Withdrawal.status == WithdrawalStatus.PENDING)
                .scalar_subquery().label("pending_withdrawals"),
            select(func.sum(ContributionRecord.amount_kobo))
                .where(*contributed_filter)
                .scalar_subquery().label("total_contributed"),
            select(func.sum(Withdrawal.net_payable_kobo))
                .where(*paid_out_filter)
                .scalar_subquery().label("total_paid_out"),
            select(func.sum(Withdrawal.charge_kobo))
                .where(*paid_out_filter)
                .scalar_subquery().label("total_charges"),
        )
    )).one()

    user_counts = await db.execute(
        select(User.role, func.count(User.id))
        .where(User.status == "active")
        .group_by(User.role)
    )
    users_by_role = {row[0].value: row[1] for row in user_counts.all()}

    return {
        "users_by_role":          users_by_role,
        "total_active_cards":     combined.total_active_cards or 0,
        "total_food_cards":       combined.total_food_cards or 0,
        "total_contributed_kobo": combined.total_contributed or 0,
        "pending_withdrawals":    combined.pending_withdrawals or 0,
        "total_paid_out_kobo":    combined.total_paid_out or 0,
        "total_charges_kobo":     combined.total_charges or 0,
        "period": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date":   end_date.isoformat() if end_date else None,
        },
    }


@router.get("/profit-report")
async def get_profit_report(
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
    start_date: date | None = None,
    end_date: date | None = None,
):
    """
    Company profit breakdown for the "View Report" page — how much came
    from card-withdrawal charges vs instant wallet-withdrawal charges,
    for the given period (or all-time if no range given). No per-customer
    detail, totals only — this is a profit statement, not a customer log.
    """
    start_dt, end_dt = _date_range_filters(start_date, end_date)

    def _filters_for(source: WithdrawalSource):
        f = [Withdrawal.status == WithdrawalStatus.PAID, Withdrawal.source == source]
        if start_dt: f.append(Withdrawal.processed_at >= start_dt)
        if end_dt:   f.append(Withdrawal.processed_at < end_dt)
        return f

    # Same fix as /analytics above: 4 sequential round trips collapsed
    # into 1 via scalar subqueries.
    combined = (await db.execute(
        select(
            select(func.sum(Withdrawal.charge_kobo)).where(*_filters_for(WithdrawalSource.CARD))
                .scalar_subquery().label("card_charges"),
            select(func.count(Withdrawal.id)).where(*_filters_for(WithdrawalSource.CARD))
                .scalar_subquery().label("card_count"),
            select(func.sum(Withdrawal.charge_kobo)).where(*_filters_for(WithdrawalSource.WALLET))
                .scalar_subquery().label("wallet_charges"),
            select(func.count(Withdrawal.id)).where(*_filters_for(WithdrawalSource.WALLET))
                .scalar_subquery().label("wallet_count"),
        )
    )).one()

    card_charges = combined.card_charges or 0
    wallet_charges = combined.wallet_charges or 0

    return {
        "card_withdrawal_charges_kobo":     card_charges,
        "card_withdrawal_count":            combined.card_count or 0,
        "instant_withdrawal_charges_kobo":  wallet_charges,
        "instant_withdrawal_count":         combined.wallet_count or 0,
        "total_profit_kobo":                card_charges + wallet_charges,
        "period": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date":   end_date.isoformat() if end_date else None,
        },
    }


@router.get("/zone-analytics")
async def get_zone_analytics(
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    """
    Where the customer base is geographically concentrated, based on the
    optional post-registration location consent. Aggregated counts only.
    """
    result = await db.execute(
        select(User.detected_state, func.count(User.id))
        .where(User.role == UserRole.CUSTOMER, User.location_consent_status == LocationConsentStatus.GRANTED)
        .group_by(User.detected_state)
        .order_by(func.count(User.id).desc())
    )
    by_state = [{"state": row[0], "count": row[1]} for row in result.all() if row[0]]

    # 1 round trip instead of 2 for the remaining counts.
    counts = (await db.execute(
        select(
            select(func.count(User.id))
                .where(User.role == UserRole.CUSTOMER, User.location_consent_status == LocationConsentStatus.DECLINED)
                .scalar_subquery().label("declined_count"),
            select(func.count(User.id))
                .where(User.role == UserRole.CUSTOMER, User.location_consent_status == LocationConsentStatus.NOT_ASKED)
                .scalar_subquery().label("not_asked_count"),
        )
    )).one()

    return {
        "by_state":         by_state,
        "declined_count":   counts.declined_count or 0,
        "not_asked_count":  counts.not_asked_count or 0,
    }


@router.get("/audit-logs")
async def get_audit_logs(
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    page_size: int = 50,
    entity_type: str | None = None,
    action: str | None = None,
):
    query = select(AuditLog)
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if action:
        query = query.where(AuditLog.action == action)
    query = query.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    logs = result.scalars().all()

    return [
        {
            "id":          str(log.id),
            "actor_id":    str(log.actor_id),
            "action":      log.action,
            "entity_type": log.entity_type,
            "entity_id":   log.entity_id,
            "old_value":   log.old_value,
            "new_value":   log.new_value,
            "ip_address":  log.ip_address,
            "created_at":  log.created_at.isoformat(),
        }
        for log in logs
    ]
