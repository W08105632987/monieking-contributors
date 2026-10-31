"""Affiliated-officer commission: how it is earned, what an officer can take out, and who it is paid to.

THE RULE
  When a director marks a customer's withdrawal PAID, the company's charge on it (one card rate per month touched)
  is the company's profit. If that customer has a commission officer who is an AFFILIATED officer, that officer earns
  `percent`% of the profit, and the company keeps the rest.
    e.g. one month, rate ₦1,000, officer share 30%  ->  officer ₦300, company ₦700.
  Who the commission officer is, is always the director's choice (users.commission_officer_id on the customer).
  Paid at 'paid' (not at request) so a rejected withdrawal never pays anyone."""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationType
from app.models.officer_earnings import OfficerCommission, OfficerPayout
from app.models.user import User, UserRole
from app.models.withdrawal import Withdrawal
from app.services.notification_service import send_notification
from app.services.settings_service import get_config_int

logger = logging.getLogger("monieking.officer_earnings")

GLOBAL_KEY = "affiliated_officer_commission_percent"
GLOBAL_DEFAULT = 30


def is_affiliated(user: User | None) -> bool:
    return bool(user and user.role == UserRole.OFFICER and user.officer_type == "affiliated")


async def percent_for(db: AsyncSession, officer: User) -> int:
    """The officer's own rate if the director set one, otherwise the global setting."""
    if officer.officer_commission_percent is not None:
        return int(officer.officer_commission_percent)
    return max(0, min(100, await get_config_int(db, GLOBAL_KEY, GLOBAL_DEFAULT)))


async def accrue_for_withdrawal(db: AsyncSession, withdrawal: Withdrawal) -> OfficerCommission | None:
    """Credit the commission for one PAID withdrawal. Safe to call twice (one commission per withdrawal).
    Returns None when nobody earns on this withdrawal."""
    existing = (await db.execute(select(OfficerCommission).where(OfficerCommission.withdrawal_id == withdrawal.id))).scalar_one_or_none()
    if existing:
        return existing
    customer = await db.get(User, withdrawal.customer_id)
    if not customer or not customer.commission_officer_id:
        return None
    officer = await db.get(User, customer.commission_officer_id)
    if not is_affiliated(officer):
        return None
    charge = int(withdrawal.charge_kobo or 0)
    pct = await percent_for(db, officer)
    amount = charge * pct // 100
    if amount <= 0:
        return None
    row = OfficerCommission(officer_id=officer.id, customer_id=customer.id, withdrawal_id=withdrawal.id,
                            company_charge_kobo=charge, percent=pct, amount_kobo=amount)
    db.add(row)
    await db.flush()
    try:
        await send_notification(
            db, user_id=officer.id, title="You earned a commission 💰",
            body=f"₦{amount / 100:,.2f} from {customer.full_name}'s withdrawal ({pct}% of ₦{charge / 100:,.2f}).",
            type=NotificationType.SUCCESS, related_entity_id=row.id, deep_link_url="/officer/earnings",
        )
    except Exception as e:   # a notification problem must never undo a commission
        logger.warning("commission notification failed: %r", e)
    return row


async def balance(db: AsyncSession, officer_id: uuid.UUID) -> dict:
    earned = (await db.execute(select(func.coalesce(func.sum(OfficerCommission.amount_kobo), 0)).where(OfficerCommission.officer_id == officer_id))).scalar_one()
    rows = (await db.execute(
        select(OfficerPayout.status, func.coalesce(func.sum(OfficerPayout.amount_kobo), 0))
        .where(OfficerPayout.officer_id == officer_id).group_by(OfficerPayout.status))).all()
    by = {status: int(total) for status, total in rows}
    paid, pending = by.get("paid", 0), by.get("pending", 0)
    return {
        "earned_kobo": int(earned), "paid_out_kobo": paid, "pending_payout_kobo": pending,
        "available_kobo": int(earned) - paid - pending,   # rejected payouts return to available automatically
    }
