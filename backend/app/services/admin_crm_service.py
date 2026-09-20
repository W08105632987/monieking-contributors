"""
Backend for the admin CRM (apps/admin) — the desktop-only, admin-role-
only surface for managing the whole platform at once. Kept separate
from admin.py (which is the mobile DIRECTOR portal's analytics
endpoints) since the two have different audiences and will grow
independently.
"""
import uuid
from datetime import date, datetime
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.card import ContributionCard, ContributionRecord
from app.models.withdrawal import Withdrawal, WithdrawalStatus
from app.models.dispute import Dispute
from app.models.wallet import Wallet, WalletTransaction
from app.services.wallet_service import get_or_create_wallet
from app.services.user_service import build_user_response, resolve_user
from app.services.customer_stats_service import date_range_filters


async def search_customers(
    db: AsyncSession, *, query: str | None, page: int, page_size: int,
) -> tuple[list[User], int]:
    """Customer 360's search/list — by name, phone, or customer_number.
    Deliberately customer-only (not officers/directors/admins) since
    that's what this list is for; the officer/director/zone management
    modules get their own list endpoints later."""
    filters = [User.role == UserRole.CUSTOMER]
    if query:
        q = query.strip()
        like = f"%{q}%"
        conditions = [User.full_name.ilike(like), User.phone_number.ilike(like)]
        if q.isdigit():
            conditions.append(User.customer_number == int(q))
        filters.append(or_(*conditions))

    base = select(User).where(*filters).order_by(User.created_at.desc())
    total = (await db.execute(select(User.id).where(*filters))).scalars().all()
    rows = (await db.execute(base.offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return list(rows), len(total)


async def get_customer_full_profile(db: AsyncSession, user_ref: str) -> dict | None:
    """
    Customer 360 — everything about one customer on one screen:
    profile (with zone_name correctly populated — see
    user_service.build_user_response), wallet + virtual account, every
    card with its full withdrawal history, and every dispute they've
    raised. This intentionally duplicates rather than calls
    users.py's /users/{id}/overview — that endpoint is scoped for the
    mobile director portal and only returns a subset (no disputes, no
    virtual account details); keeping this one independent means either
    can evolve without the other's mobile-scoped constraints leaking in.
    """
    customer = await resolve_user(db, user_ref)
    if not customer or customer.role != UserRole.CUSTOMER:
        return None

    wallet = await get_or_create_wallet(db, customer.id)

    cards = (await db.execute(
        select(ContributionCard).where(ContributionCard.owner_id == customer.id)
    )).scalars().all()
    card_ids = [c.id for c in cards]

    withdrawals = (await db.execute(
        select(Withdrawal).where(Withdrawal.card_id.in_(card_ids)).order_by(Withdrawal.requested_at.desc())
    )).scalars().all() if card_ids else []
    withdrawals_by_card: dict[uuid.UUID, list[Withdrawal]] = {}
    withdrawn_by_card: dict[uuid.UUID, int] = {}
    for w in withdrawals:
        withdrawals_by_card.setdefault(w.card_id, []).append(w)
        if w.status == WithdrawalStatus.PAID:
            withdrawn_by_card[w.card_id] = withdrawn_by_card.get(w.card_id, 0) + w.requested_amount_kobo

    # Un-withdrawn balance per card — same ground truth as
    # customer_stats_service (sum of records not yet marked withdrawn),
    # not the derived total_contributed_kobo-minus-withdrawals figure.
    unwithdrawn_by_card: dict[uuid.UUID, int] = {}
    if card_ids:
        rows = (await db.execute(
            select(ContributionRecord.card_id, ContributionRecord.amount_kobo)
            .where(ContributionRecord.card_id.in_(card_ids), ContributionRecord.is_withdrawn == False)  # noqa: E712
        )).all()
        for card_id, amount in rows:
            unwithdrawn_by_card[card_id] = unwithdrawn_by_card.get(card_id, 0) + amount

    card_overviews = [
        {
            "id": str(card.id),
            "card_type": card.card_type.value,
            "rate_kobo": card.rate_kobo,
            "status": card.status.value,
            "created_at": card.created_at,
            "total_days_contributed": card.total_days_contributed,
            "total_contributed_kobo": card.total_contributed_kobo,
            "total_withdrawn_kobo": withdrawn_by_card.get(card.id, 0),
            "available_balance_kobo": unwithdrawn_by_card.get(card.id, 0),
            "withdrawal_history": [
                {
                    "id": str(w.id),
                    "requested_amount_kobo": w.requested_amount_kobo,
                    "net_payable_kobo": w.net_payable_kobo,
                    "status": w.status.value,
                    "requested_at": w.requested_at,
                    "processed_at": w.processed_at,
                }
                for w in withdrawals_by_card.get(card.id, [])
            ],
        }
        for card in cards
    ]

    disputes = (await db.execute(
        select(Dispute).where(Dispute.raised_by == customer.id).order_by(Dispute.created_at.desc())
    )).scalars().all()

    return {
        "profile": await build_user_response(db, customer),
        "wallet": {
            "balance_kobo": wallet.balance_kobo,
            "virtual_account_number": wallet.virtual_account_number,
            "virtual_account_bank": wallet.virtual_account_bank,
        },
        "cards": card_overviews,
        "disputes": [
            {
                "id": str(d.id),
                "entity_type": d.entity_type.value,
                "reason": d.reason.value,
                "status": d.status.value,
                "created_at": d.created_at,
            }
            for d in disputes
        ],
    }


# ── Financial reconciliation (Phase 4) ────────────────────────────────

async def list_wallet_transactions(
    db: AsyncSession,
    *,
    user_ref: str | None,
    category: str | None,
    tx_type: str | None,
    start_date: date | None,
    end_date: date | None,
    page: int,
    page_size: int,
) -> tuple[list[dict], int]:
    """The wallet ledger viewer — every WalletTransaction, filterable by
    who it belongs to, category, direction, and date. This is
    intentionally a straight ledger view, not a Monnify cross-check:
    reconciling against Monnify's own transaction history needs live
    API access this environment doesn't have, so that half of "financial
    reconciliation" stays on the checklist as not-yet-built rather than
    faked here."""
    filters = []
    if category:
        filters.append(WalletTransaction.category == category)
    if tx_type:
        filters.append(WalletTransaction.type == tx_type)
    start_dt, end_dt = date_range_filters(start_date, end_date)
    if start_dt: filters.append(WalletTransaction.created_at >= start_dt)
    if end_dt:   filters.append(WalletTransaction.created_at < end_dt)

    owner_id = None
    if user_ref:
        user = await resolve_user(db, user_ref)
        if user:
            wallet = await get_or_create_wallet(db, user.id)
            owner_id = wallet.id

    query = select(WalletTransaction, User.full_name, User.customer_number).join(
        Wallet, Wallet.id == WalletTransaction.wallet_id
    ).join(
        User, User.id == Wallet.owner_id
    ).where(*filters)
    if owner_id:
        query = query.where(WalletTransaction.wallet_id == owner_id)
    query = query.order_by(WalletTransaction.created_at.desc())

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    rows = (await db.execute(query.offset((page - 1) * page_size).limit(page_size))).all()

    return [
        {
            "id": str(tx.id),
            "type": tx.type.value,
            "category": tx.category.value,
            "amount_kobo": tx.amount_kobo,
            "balance_after_kobo": tx.balance_after_kobo,
            "reference": tx.reference,
            "description": tx.description,
            "owner_name": full_name,
            "owner_customer_number": customer_number,
            "created_at": tx.created_at,
        }
        for tx, full_name, customer_number in rows
    ], total


async def get_reconciliation_flags(db: AsyncSession) -> list[dict]:
    """
    Discrepancy detector: for every wallet, its most recent transaction's
    balance_after_kobo should equal the wallet's current balance_kobo —
    that's the invariant every credit/debit is supposed to maintain (see
    wallet_service.py). A mismatch means something touched a wallet's
    balance outside the normal credit/debit path, or a transaction
    recorded the wrong running balance — either way, worth a human
    looking at it. This is a real integrity check on data already in
    the database, not a simulation of one.
    """
    latest_tx_subq = (
        select(
            WalletTransaction.wallet_id,
            func.max(WalletTransaction.created_at).label("latest_at"),
        )
        .group_by(WalletTransaction.wallet_id)
        .subquery()
    )
    latest_tx = (
        select(WalletTransaction.wallet_id, WalletTransaction.balance_after_kobo, WalletTransaction.created_at)
        .join(
            latest_tx_subq,
            (WalletTransaction.wallet_id == latest_tx_subq.c.wallet_id)
            & (WalletTransaction.created_at == latest_tx_subq.c.latest_at),
        )
        .subquery()
    )

    query = (
        select(Wallet, User.full_name, User.customer_number, latest_tx.c.balance_after_kobo)
        .join(User, User.id == Wallet.owner_id)
        .join(latest_tx, latest_tx.c.wallet_id == Wallet.id)
        .where(Wallet.balance_kobo != latest_tx.c.balance_after_kobo)
    )
    rows = (await db.execute(query)).all()

    return [
        {
            "wallet_id": str(wallet.id),
            "owner_name": full_name,
            "owner_customer_number": customer_number,
            "current_balance_kobo": wallet.balance_kobo,
            "last_recorded_balance_kobo": last_recorded,
            "difference_kobo": wallet.balance_kobo - last_recorded,
        }
        for wallet, full_name, customer_number, last_recorded in rows
    ]
