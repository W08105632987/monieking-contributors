"""Refunds for manual services that did not succeed.

Rules (agreed with the founder):
  * a failed manual service always refunds the customer in full, whatever the reason;
  * no commission is ever paid on a failure;
  * a job nobody claims within the director-set number of days is failed and refunded.

The refund is a wallet credit made in the SAME database transaction as the status
change, so a job can never be marked failed without the refund, or refunded without
being marked failed. It refunds what was actually charged (looked up from the wallet
ledger, not the price field) and its reference `RF-<job id>` is unique, so a retry or
a double tap can never pay twice."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_pool_event import JobPoolEvent
from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus
from app.models.notification import NotificationType
from app.models.wallet import TxCategory, TxType, Wallet, WalletTransaction
from app.services.notification_service import send_notification
from app.services.settings_service import get_config_int
from app.services.wallet_service import credit_wallet

from app.services.refund_rules import amount_to_refund, naira, refund_reference  # noqa: F401

logger = logging.getLogger(__name__)

ENTITY = "manual_service_request"
EXPIRY_KEY = "manual_services_unclaimed_expiry_days"
EXPIRY_DEFAULT_DAYS = 7          # 0 switches the automatic expiry off
BATCH = 100


async def refund_manual_job(db: AsyncSession, job: ManualServiceRequest, *, actor_id: uuid.UUID, why: str) -> int:
    """Credit the customer's wallet for a failed job. Returns kobo refunded (0 = nothing to
    refund or already refunded). Does not commit. Raises ValueError with a message that is
    safe to show a worker if the wallet cannot take the credit."""
    ref = refund_reference(job.id)
    done = (await db.execute(select(WalletTransaction.id).where(WalletTransaction.reference == ref))).first()
    charges = (await db.execute(
        select(WalletTransaction.wallet_id, WalletTransaction.amount_kobo).where(
            WalletTransaction.related_entity_type == ENTITY,
            WalletTransaction.related_entity_id == job.id,
            WalletTransaction.type == TxType.DEBIT,
            WalletTransaction.category == TxCategory.CHARGE,
        ))).all()
    amount = amount_to_refund([a for _, a in charges], already_refunded=done is not None)
    if amount <= 0:
        return 0
    wallet = await db.get(Wallet, charges[0][0])
    if wallet is None:
        raise ValueError("The customer's wallet could not be found. Ask a director to refund this manually.")
    try:
        await credit_wallet(
            db, wallet=wallet, amount_kobo=amount, category=TxCategory.REVERSAL, reference=ref,
            description=f"Refund: {job.service_category.replace('_', ' ').title()} request not completed",
            initiated_by=actor_id, related_entity_type=ENTITY, related_entity_id=job.id,
        )
    except HTTPException as e:
        raise ValueError("The customer's wallet is locked, so the refund could not be made. "
                         "Ask a director to unlock it, then resolve this job again.") from e
    db.add(JobPoolEvent(job_id=job.id, event_type="refunded", actor_id=actor_id,
                        details={"refund_kobo": amount, "why": why[:200]}))
    return amount


async def expire_unclaimed_jobs(db: AsyncSession, *, system_user_id: uuid.UUID | None = None) -> dict:
    """Fail and refund jobs nobody claimed within the director-set window."""
    days = await get_config_int(db, EXPIRY_KEY, default=EXPIRY_DEFAULT_DAYS)
    if days <= 0:
        return {"expired": 0, "refunded_kobo": 0, "disabled": True}
    now = datetime.now(timezone.utc)
    jobs = (await db.scalars(
        select(ManualServiceRequest).where(
            ManualServiceRequest.status == ManualServiceStatus.PENDING,
            ManualServiceRequest.created_at <= now - timedelta(days=days),
        ).order_by(ManualServiceRequest.created_at).limit(BATCH).with_for_update(skip_locked=True)
    )).all()
    count = total = 0
    for job in jobs:
        actor = system_user_id or job.user_id
        try:
            async with db.begin_nested():
                refunded = await refund_manual_job(db, job, actor_id=actor, why="unclaimed past expiry")
                job.status, job.worker_status = ManualServiceStatus.FAILED, "expired"
                job.worker_response = "No service worker was available in time."
                job.worker_remarks = f"Not claimed within {days} days."
                job.worker_commission_kobo, job.completed_at = 0, now
                db.add(JobPoolEvent(job_id=job.id, event_type="expired_refunded", actor_id=actor,
                                    details={"refund_kobo": refunded, "days": days}))
        except ValueError as e:
            logger.warning("expiry refund skipped job=%s: %s", job.id, e)
            continue
        count += 1
        total += refunded
        await send_notification(
            db, user_id=job.user_id, title="Request refunded",
            body=(f"No service worker was available for your {job.service_category.replace('_', ' ').title()} request, "
                  f"so it was closed" + (f" and {naira(refunded)} was returned to your wallet." if refunded else ".")),
            type=NotificationType.WARNING, related_entity_id=job.id,
            deep_link_url=f"/customer/manual-services/requests/{job.id}")
    await db.commit()
    return {"expired": count, "refunded_kobo": total, "disabled": False}
