"""
Job Pool Service
================
Handles the full lifecycle of Manual Service Requests:
  - Listing the open pool (pending jobs, excluding active referral holds)
  - Listing referred jobs held for a specific worker
  - Claiming a job (sets status → processing, records expires_at, enforces referral exclusivity)
  - Resolving a job (sets status → successful/failed, credits commission, notifies customer/officer)
  - SLA reclamation background task (returns expired processing jobs to pending, records audit events)
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus, CommissionStatus
from app.models.service_worker_withdrawal import ServiceWorkerWithdrawal, SWWithdrawalStatus
from app.models.job_pool_event import JobPoolEvent
from app.models.notification import NotificationType
from app.models.user import User, UserRole
from app.services.notification_service import send_notification

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────
async def _get_timeout_minutes(db: AsyncSession) -> int:
    """Reads Director-configured SLA timeout from system_config (defaults 30)."""
    from app.models.settings import SystemConfig
    row = await db.scalar(
        select(SystemConfig.value).where(
            SystemConfig.key == "service_worker_job_timeout_minutes"
        )
    )
    try:
        return int(row) if row else 30
    except ValueError:
        return 30


async def _get_referral_hold_minutes(db: AsyncSession) -> int:
    """Reads Director-configured referral hold window from system_config (defaults 30)."""
    from app.models.settings import SystemConfig
    row = await db.scalar(
        select(SystemConfig.value).where(
            SystemConfig.key == "service_worker_referral_hold_minutes"
        )
    )
    try:
        return int(row) if row else 30
    except ValueError:
        return 30


async def _get_commission_percent(db: AsyncSession) -> float:
    """Reads Director-configured commission % from system_config (defaults 10)."""
    from app.models.settings import SystemConfig
    row = await db.scalar(
        select(SystemConfig.value).where(
            SystemConfig.key == "service_worker_default_commission_percent"
        )
    )
    try:
        return float(row) if row else 10.0
    except ValueError:
        return 10.0


# ── Pool Listing ───────────────────────────────────────────────────────────────
async def list_pool(
    db: AsyncSession,
    *,
    category: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """
    Returns open (pending) jobs in the pool, visible to all service workers.
    Excludes any job where:
      referred_worker_id IS NOT NULL AND status == PENDING AND now < created_at + referral_hold_minutes
    """
    hold_mins = await _get_referral_hold_minutes(db)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=hold_mins)

    # Condition: pending AND (no referral OR referral hold expired)
    base_filters = [
        ManualServiceRequest.status == ManualServiceStatus.PENDING,
        (ManualServiceRequest.referred_worker_id.is_(None) | (ManualServiceRequest.created_at <= cutoff)),
    ]
    if category and category.lower() != "all":
        base_filters.append(ManualServiceRequest.service_category == category)

    q = select(ManualServiceRequest).where(*base_filters).order_by(ManualServiceRequest.created_at.asc())

    total = await db.scalar(
        select(func.count()).select_from(ManualServiceRequest).where(*base_filters)
    ) or 0

    offset = (page - 1) * page_size
    rows = (await db.scalars(q.offset(offset).limit(page_size))).all()
    return {"data": rows, "total": total, "page": page, "page_size": page_size}


# ── Referred Jobs Listing ─────────────────────────────────────────────────────
async def list_referred_jobs(
    db: AsyncSession,
    worker_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """
    Returns pending jobs exclusively referred to this worker and still inside the hold window.
    Each item includes the job model and computed referral_expires_at.
    """
    hold_mins = await _get_referral_hold_minutes(db)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=hold_mins)

    q = (
        select(ManualServiceRequest)
        .where(
            ManualServiceRequest.status == ManualServiceStatus.PENDING,
            ManualServiceRequest.referred_worker_id == worker_id,
            ManualServiceRequest.created_at > cutoff,
        )
        .order_by(ManualServiceRequest.created_at.asc())
    )
    rows = (await db.scalars(q)).all()
    result = []
    for job in rows:
        expires_at = job.created_at + timedelta(minutes=hold_mins)
        result.append({
            "job": job,
            "referral_expires_at": expires_at.isoformat(),
        })
    return result


# ── Worker Own Jobs ────────────────────────────────────────────────────────────
async def list_worker_jobs(
    db: AsyncSession,
    worker_id: uuid.UUID,
    *,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """Returns jobs claimed by this specific worker."""
    q = select(ManualServiceRequest).where(
        ManualServiceRequest.claimed_by_id == worker_id
    )
    if status:
        q = q.where(ManualServiceRequest.status == status)
    q = q.order_by(ManualServiceRequest.created_at.desc())

    total_q = select(func.count()).select_from(ManualServiceRequest).where(
        ManualServiceRequest.claimed_by_id == worker_id
    )
    if status:
        total_q = total_q.where(ManualServiceRequest.status == status)
    total = await db.scalar(total_q)

    offset = (page - 1) * page_size
    rows = (await db.scalars(q.offset(offset).limit(page_size))).all()
    return {"data": rows, "total": total or 0, "page": page, "page_size": page_size}


# ── Claim Job ─────────────────────────────────────────────────────────────────
async def claim_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    worker_id: uuid.UUID,
) -> ManualServiceRequest:
    """
    Atomically claim a pending job.
    Enforces referral hold exclusivity if within referral hold window.
    Raises ValueError if already claimed, not found, or reserved for another worker.
    """
    # Lock the row to prevent race conditions
    stmt = (
        select(ManualServiceRequest)
        .where(
            ManualServiceRequest.id == job_id,
            ManualServiceRequest.status == ManualServiceStatus.PENDING,
        )
        .with_for_update()
    )
    job = (await db.scalars(stmt)).first()
    if not job:
        raise ValueError("Job not found or already claimed by another worker.")

    now = datetime.now(timezone.utc)

    # Enforce referral hold exclusivity
    if job.referred_worker_id is not None and job.referred_worker_id != worker_id:
        hold_mins = await _get_referral_hold_minutes(db)
        hold_expires_at = job.created_at + timedelta(minutes=hold_mins)
        if now < hold_expires_at:
            mins_left = max(1, int((hold_expires_at - now).total_seconds() / 60))
            raise ValueError(
                f"This job is reserved for a referred service worker. It will release to the open pool in {mins_left} minute(s)."
            )

    timeout_mins = await _get_timeout_minutes(db)

    job.status        = ManualServiceStatus.PROCESSING
    job.claimed_by_id = worker_id
    job.claimed_at    = now
    job.expires_at    = now + timedelta(minutes=timeout_mins)

    # Record audit event
    event = JobPoolEvent(
        job_id=job.id,
        event_type="claimed",
        actor_id=worker_id,
        details={"claimed_at": now.isoformat(), "expires_at": job.expires_at.isoformat()}
    )
    db.add(event)

    # Notify customer
    category_title = job.service_category.replace("_", " ").title()
    await send_notification(
        db,
        user_id=job.user_id,
        title="Service Request Claimed",
        body=f"A service worker has picked up your {category_title} request.",
        type=NotificationType.INFO,
        related_entity_id=job.id,
    )

    # Notify officer if submitted by officer on customer's behalf
    officer_id_str = (job.form_data or {}).get("submitted_by_officer_id")
    if officer_id_str:
        try:
            officer_id = uuid.UUID(officer_id_str)
            if officer_id != job.user_id:
                await send_notification(
                    db,
                    user_id=officer_id,
                    title="Service Request Claimed",
                    body=f"The {category_title} request you submitted for a customer has been picked up by a service worker.",
                    type=NotificationType.INFO,
                    related_entity_id=job.id,
                )
        except Exception:
            pass

    await db.commit()
    await db.refresh(job)
    return job


# ── Resolve Job ───────────────────────────────────────────────────────────────
async def resolve_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    worker_id: uuid.UUID,
    *,
    worker_status: str,             # 'successful' | 'failed' (also accepts 'completed' | 'rejected')
    worker_response: str,
    worker_remarks: str | None,
    worker_additional_info: str | None,
    worker_result_file_url: str | None,
) -> ManualServiceRequest:
    """
    Submit a resolution for a claimed job.
    On success: calculates commission and credits worker's balance.
    Notifies customer and records audit event.
    """
    stmt = (
        select(ManualServiceRequest)
        .where(
            ManualServiceRequest.id == job_id,
            ManualServiceRequest.claimed_by_id == worker_id,
            ManualServiceRequest.status == ManualServiceStatus.PROCESSING,
        )
        .with_for_update()
    )
    job = (await db.scalars(stmt)).first()
    if not job:
        raise ValueError("Active job not found or not yours to resolve.")

    status_lower = worker_status.lower().strip()
    if status_lower in ("successful", "completed"):
        final_status = ManualServiceStatus.SUCCESSFUL
        normalized_worker_status = "successful"
    elif status_lower in ("failed", "rejected"):
        final_status = ManualServiceStatus.FAILED
        normalized_worker_status = "failed"
    else:
        raise ValueError("Invalid worker status. Must be 'successful' or 'failed'.")

    commission_kobo = 0
    if final_status == ManualServiceStatus.SUCCESSFUL and job.price_kobo > 0:
        pct = await _get_commission_percent(db)
        commission_kobo = int(job.price_kobo * pct / 100)

    now = datetime.now(timezone.utc)
    job.status                = final_status
    job.worker_status         = normalized_worker_status
    job.worker_response       = worker_response
    job.worker_remarks        = worker_remarks
    job.worker_additional_info = worker_additional_info
    job.worker_result_file_url = worker_result_file_url
    job.worker_commission_kobo = commission_kobo
    job.commission_status     = CommissionStatus.CLEARED if commission_kobo > 0 else CommissionStatus.CLEARED
    job.completed_at          = now

    # Credit commission to worker balance (offsetting active debt first per 4.4.5)
    if commission_kobo > 0:
        worker = await db.get(User, worker_id)
        if worker:
            debt = worker.commission_debt_kobo or 0
            if debt > 0:
                repay = min(debt, commission_kobo)
                worker.commission_debt_kobo = debt - repay
                commission_kobo_surplus = commission_kobo - repay
            else:
                commission_kobo_surplus = commission_kobo
            worker.commission_balance_kobo = (worker.commission_balance_kobo or 0) + commission_kobo_surplus

    # Record audit event
    event = JobPoolEvent(
        job_id=job.id,
        event_type="resolved",
        actor_id=worker_id,
        details={
            "status": final_status.value,
            "commission_kobo": commission_kobo,
            "resolved_at": now.isoformat(),
        },
    )
    db.add(event)

    # Notify customer
    category_title = job.service_category.replace("_", " ").title()
    outcome_label = "successfully completed" if final_status == ManualServiceStatus.SUCCESSFUL else "marked as failed"
    remarks_snippet = f" Remarks: {worker_remarks}" if worker_remarks else ""
    await send_notification(
        db,
        user_id=job.user_id,
        title=f"Service Request {final_status.value.title()}",
        body=f"Your {category_title} request was {outcome_label}.{remarks_snippet}".strip(),
        type=NotificationType.SUCCESS if final_status == ManualServiceStatus.SUCCESSFUL else NotificationType.ERROR,
        related_entity_id=job.id,
    )

    # Notify officer if submitted by officer on behalf of customer
    officer_id_str = (job.form_data or {}).get("submitted_by_officer_id")
    if officer_id_str:
        try:
            officer_id = uuid.UUID(officer_id_str)
            if officer_id != job.user_id:
                await send_notification(
                    db,
                    user_id=officer_id,
                    title=f"Service Request {final_status.value.title()}",
                    body=f"The {category_title} request you submitted for a customer was {outcome_label}.{remarks_snippet}".strip(),
                    type=NotificationType.SUCCESS if final_status == ManualServiceStatus.SUCCESSFUL else NotificationType.ERROR,
                    related_entity_id=job.id,
                )
        except Exception:
            pass

    await db.commit()
    await db.refresh(job)
    return job


# ── SLA Reclamation ────────────────────────────────────────────────────────────
async def check_expired_referral_holds(db: AsyncSession) -> int:
    """
    Scans for pending referred jobs that have passed their hold window
    and logs a referral_expired event if not already logged.
    """
    hold_mins = await _get_referral_hold_minutes(db)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=hold_mins)

    stmt = (
        select(ManualServiceRequest)
        .where(
            ManualServiceRequest.status == ManualServiceStatus.PENDING,
            ManualServiceRequest.referred_worker_id.isnot(None),
            ManualServiceRequest.created_at <= cutoff,
        )
    )
    jobs = (await db.scalars(stmt)).all()
    expired_count = 0
    for job in jobs:
        already_logged = await db.scalar(
            select(func.count()).select_from(JobPoolEvent).where(
                JobPoolEvent.job_id == job.id,
                JobPoolEvent.event_type == "referral_expired",
            )
        )
        if not already_logged:
            event = JobPoolEvent(
                job_id=job.id,
                event_type="referral_expired",
                actor_id=job.referred_worker_id,
                details={
                    "referred_worker_id": str(job.referred_worker_id),
                    "expired_at": now.isoformat(),
                },
            )
            db.add(event)
            expired_count += 1
    return expired_count


async def reclaim_expired_jobs(db: AsyncSession) -> int:
    """
    Background task: returns any processing jobs past their expires_at back to
    pending status so another worker can pick them up.
    Records SLA breach event and notifies customer.
    Also audits referral hold expiries.
    Returns the number of jobs reclaimed.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        select(ManualServiceRequest)
        .where(
            ManualServiceRequest.status == ManualServiceStatus.PROCESSING,
            ManualServiceRequest.expires_at <= now,
        )
        .with_for_update()
    )
    expired_jobs = (await db.scalars(stmt)).all()
    reclaimed_count = 0

    for job in expired_jobs:
        previous_worker_id = job.claimed_by_id
        job.status = ManualServiceStatus.PENDING
        job.claimed_by_id = None
        job.claimed_at = None
        job.expires_at = None
        reclaimed_count += 1

        # Audit event for SLA breach
        event = JobPoolEvent(
            job_id=job.id,
            event_type="sla_reclaimed",
            actor_id=previous_worker_id,
            details={"reclaimed_at": now.isoformat()},
        )
        db.add(event)

        # Notify customer
        category_title = job.service_category.replace("_", " ").title()
        await send_notification(
            db,
            user_id=job.user_id,
            title="Service Request Delayed",
            body=f"Your {category_title} request is experiencing a slight delay and has been returned to the pool for the next available worker.",
            type=NotificationType.WARNING,
            related_entity_id=job.id,
        )

    # Check referral hold expiries
    await check_expired_referral_holds(db)

    await db.commit()
    if reclaimed_count:
        logger.info("SLA reclamation: returned %d expired jobs to pool", reclaimed_count)
    return reclaimed_count


# ── Director Stats ─────────────────────────────────────────────────────────────
async def get_worker_stats(db: AsyncSession) -> dict[str, Any]:
    """Live statistics for the Director oversight dashboard."""
    # Count jobs in open pool
    hold_mins = await _get_referral_hold_minutes(db)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=hold_mins)

    unattended = await db.scalar(
        select(func.count()).select_from(ManualServiceRequest).where(
            ManualServiceRequest.status == ManualServiceStatus.PENDING,
            (ManualServiceRequest.referred_worker_id.is_(None) | (ManualServiceRequest.created_at <= cutoff)),
        )
    ) or 0

    # Busy workers (currently hold a processing job)
    busy_worker_ids = (
        await db.scalars(
            select(ManualServiceRequest.claimed_by_id).where(
                ManualServiceRequest.status == ManualServiceStatus.PROCESSING,
                ManualServiceRequest.claimed_by_id.isnot(None),
            ).distinct()
        )
    ).all()
    busy_count = len(busy_worker_ids)

    # Total service workers
    total_workers = await db.scalar(
        select(func.count()).select_from(User).where(
            User.role == UserRole.SERVICE_WORKER
        )
    ) or 0

    free_count = max(0, total_workers - busy_count)

    # Jobs completed today
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    completed_today = await db.scalar(
        select(func.count()).select_from(ManualServiceRequest).where(
            ManualServiceRequest.status.in_([
                ManualServiceStatus.SUCCESSFUL, ManualServiceStatus.FAILED
            ]),
            ManualServiceRequest.completed_at >= today_start,
        )
    ) or 0

    # Average resolution time (minutes) today
    avg_minutes: float | None = None
    rows = (
        await db.execute(
            select(
                ManualServiceRequest.claimed_at,
                ManualServiceRequest.completed_at,
            ).where(
                ManualServiceRequest.completed_at >= today_start,
                ManualServiceRequest.claimed_at.isnot(None),
                ManualServiceRequest.completed_at.isnot(None),
            )
        )
    ).all()
    if rows:
        deltas = [
            (r.completed_at - r.claimed_at).total_seconds() / 60
            for r in rows
            if r.completed_at and r.claimed_at
        ]
        if deltas:
            avg_minutes = round(sum(deltas) / len(deltas), 1)

    # Real SLA breaches today from job_pool_events
    sla_breaches = await db.scalar(
        select(func.count()).select_from(JobPoolEvent).where(
            JobPoolEvent.event_type == "sla_reclaimed",
            JobPoolEvent.created_at >= today_start,
        )
    ) or 0

    # Real referral hold expiries today
    referral_expiries_today = await db.scalar(
        select(func.count()).select_from(JobPoolEvent).where(
            JobPoolEvent.event_type == "referral_expired",
            JobPoolEvent.created_at >= today_start,
        )
    ) or 0

    return {
        "total_workers":   total_workers,
        "free_workers":    free_count,
        "busy_workers":    busy_count,
        "unattended_jobs": unattended,
        "completed_today": completed_today,
        "avg_turnaround_minutes": avg_minutes,
        "sla_breaches_today": sla_breaches,
        "referral_expiries_today": referral_expiries_today,
    }


# ── Create Payout Request ──────────────────────────────────────────────────────
async def request_payout(
    db: AsyncSession,
    worker_id: uuid.UUID,
    amount_kobo: int,
    account_number: str,
    account_name: str,
    bank_name: str,
) -> ServiceWorkerWithdrawal:
    """Worker requests a commission payout from their balance."""
    worker = await db.get(User, worker_id)
    if not worker:
        raise ValueError("Worker not found.")
    if (worker.commission_balance_kobo or 0) < amount_kobo:
        raise ValueError("Insufficient commission balance.")

    # Reserve the amount
    worker.commission_balance_kobo -= amount_kobo

    payout = ServiceWorkerWithdrawal(
        worker_id=worker_id,
        amount_kobo=amount_kobo,
        account_number=account_number,
        account_name=account_name,
        bank_name=bank_name,
    )
    db.add(payout)
    await db.commit()
    await db.refresh(payout)
    return payout
