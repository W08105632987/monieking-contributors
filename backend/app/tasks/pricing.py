"""
The two scheduled jobs behind the deferred Food Card pricing mechanic.
Both are plain async functions run via asyncio.run() inside a sync Celery
task, reusing the app's existing AsyncSessionLocal.
"""
import asyncio
from datetime import datetime, timezone

from sqlalchemy import select

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.models.settings import PendingRateChange, PendingRateChangeStatus
from app.models.user import User, UserRole, UserStatus
from app.services.settings_service import set_config_value
from app.services.notification_service import send_notification


async def _notify_pending_rate_changes() -> int:
    """
    Dec 31: tell every active customer about tomorrow's rate change(s).

    Uses a <= 1 day window rather than an exact "tomorrow" match — this
    task fires exactly once a year via cron (see celery_app.py). If
    Celery Beat has any downtime during that specific window (a
    deployment, a crash, a restart), an exact-match condition would
    silently skip the notification for the entire year with no
    catch-up. A window means a late run (even on Jan 1 itself) still
    catches it — the notified_at guard below prevents double-sending
    once it succeeds.
    """
    today = datetime.now(timezone.utc).date()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PendingRateChange).where(
                PendingRateChange.status == PendingRateChangeStatus.SCHEDULED,
                PendingRateChange.notified_at.is_(None),
            )
        )
        changes = result.scalars().all()
        changes = [c for c in changes if 0 <= (c.effective_date - today).days <= 1]

        if not changes:
            return 0

        customers_result = await db.execute(
            select(User).where(User.role == UserRole.CUSTOMER, User.status == UserStatus.ACTIVE)
        )
        customers = customers_result.scalars().all()

        notified = 0
        for change in changes:
            old_naira = change.current_value_kobo / 100
            new_naira = change.new_value_kobo / 100
            for customer in customers:
                await send_notification(
                    db,
                    user_id=customer.id,
                    title="Food Card rate change — starting tomorrow",
                    body=(
                        f"Starting January 1st, the Food Card daily contribution rate will "
                        f"change from ₦{old_naira:,.0f} to ₦{new_naira:,.0f}/day. This does not "
                        f"affect contributions you've already made."
                    ),
                    related_entity_id=change.id,
                )
                notified += 1
            change.notified_at = datetime.now(timezone.utc)

        await db.commit()
        return notified


async def _apply_pending_rate_changes() -> int:
    """
    Jan 1: flip the live system_config value for every change effective
    today (or earlier).

    Same reasoning as the notify job above, but this one matters more:
    this task also runs exactly once a year. With a strict `== today`
    match, any Celery downtime during that one 5-minute window means the
    scheduled price change is silently and PERMANENTLY lost — the query
    would never match it again on any later day, and status would stay
    stuck on SCHEDULED forever with nothing flagging that anything went
    wrong. `<= today` means a late run (whenever Celery Beat or a
    director next triggers this) still correctly catches and applies
    it — the status flip to APPLIED is what prevents re-applying it
    twice, so this is safe to catch up on.
    """
    today = datetime.now(timezone.utc).date()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PendingRateChange).where(
                PendingRateChange.status == PendingRateChangeStatus.SCHEDULED,
                PendingRateChange.effective_date <= today,
            )
        )
        changes = result.scalars().all()
        if not changes:
            return 0

        applied = 0
        for change in changes:
            await set_config_value(
                db,
                key=change.setting_key,
                value=str(change.new_value_kobo),
                updated_by=change.created_by,
            )
            change.status = PendingRateChangeStatus.APPLIED
            change.applied_at = datetime.now(timezone.utc)
            applied += 1

        await db.commit()
        return applied


@celery_app.task(name="app.tasks.pricing.notify_pending_rate_changes")
def notify_pending_rate_changes():
    return asyncio.run(_notify_pending_rate_changes())


@celery_app.task(name="app.tasks.pricing.apply_pending_rate_changes")
def apply_pending_rate_changes():
    return asyncio.run(_apply_pending_rate_changes())
