"""
Job Pool Service
================
Handles the full lifecycle of Manual Service Requests:
  - Listing the open pool (pending jobs)
  - Claiming a job (sets status → processing, records expires_at)
  - Resolving a job (sets status → successful/failed, credits commission)
  - SLA reclamation background task (returns expired processing jobs to pending)
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus
from app.models.service_worker_withdrawal import ServiceWorkerWithdrawal, SWWithdrawalStatus
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)


# ── Helper ─────────────────────────────────────────────────────────────────────
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
    """Returns open (pending) jobs in the pool, visible to all service workers."""
    q = select(ManualServiceRequest).where(
        ManualServiceRequest.status == ManualServiceStatus.PENDING
    )
    if category:
        q = q.where(ManualServiceRequest.service_category == category)
    q = q.order_by(ManualServiceRequest.created_at.asc())

    total = await db.scalar(
        select(func.count()).select_from(
            ManualServiceRequest
        ).where(ManualServiceRequest.status == ManualServiceStatus.PENDING)
    )

    offset = (page - 1) * page_size
    rows = (await db.scalars(q.offset(offset).limit(page_size))).all()
    return {"data": rows, "total": total or 0, "page": page, "page_size": page_size}


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
    Raises ValueError if already claimed or not found.
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

    timeout_mins = await _get_timeout_minutes(db)
    now = datetime.now(timezone.utc)

    job.status        = ManualServiceStatus.PROCESSING
    job.claimed_by_id = worker_id
    job.claimed_at    = now
    job.expires_at    = now + timedelta(minutes=timeout_mins)

    await db.commit()
    await db.refresh(job)
    return job


# ── Resolve Job ───────────────────────────────────────────────────────────────
async def resolve_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    worker_id: uuid.UUID,
    *,
    worker_status: str,             # 'successful' | 'failed'
    worker_response: str,
    worker_remarks: str | None,
    worker_additional_info: str | None,
    worker_result_file_url: str | None,
) -> ManualServiceRequest:
    """
    Submit a resolution for a claimed job.
    On success: calculates commission and credits worker's balance.
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

    final_status = (
        ManualServiceStatus.SUCCESSFUL
        if worker_status == "successful"
        else ManualServiceStatus.FAILED
    )

    commission_kobo = 0
    if final_status == ManualServiceStatus.SUCCESSFUL and job.price_kobo > 0:
        pct = await _get_commission_percent(db)
        commission_kobo = int(job.price_kobo * pct / 100)

    job.status                = final_status
    job.worker_status         = worker_status
    job.worker_response       = worker_response
    job.worker_remarks        = worker_remarks
    job.worker_additional_info = worker_additional_info
    job.worker_result_file_url = worker_result_file_url
    job.worker_commission_kobo = commission_kobo
    job.completed_at          = datetime.now(timezone.utc)

    # Credit commission to worker balance
    if commission_kobo > 0:
        worker = await db.get(User, worker_id)
        if worker:
            worker.commission_balance_kobo = (worker.commission_balance_kobo or 0) + commission_kobo

    await db.commit()
    await db.refresh(job)
    return job


# ── SLA Reclamation ────────────────────────────────────────────────────────────
async def reclaim_expired_jobs(db: AsyncSession) -> int:
    """
    Background task: returns any processing jobs past their expires_at back to
    pending status so another worker can pick them up.
    Returns the number of jobs reclaimed.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        update(ManualServiceRequest)
        .where(
            ManualServiceRequest.status == ManualServiceStatus.PROCESSING,
            ManualServiceRequest.expires_at <= now,
        )
        .values(
            status=ManualServiceStatus.PENDING,
            claimed_by_id=None,
            claimed_at=None,
            expires_at=None,
        )
        .returning(ManualServiceRequest.id)
    )
    result = await db.execute(stmt)
    reclaimed = result.rowcount
    await db.commit()
    if reclaimed:
        logger.info("SLA reclamation: returned %d expired jobs to pool", reclaimed)
    return reclaimed


# ── Director Stats ─────────────────────────────────────────────────────────────
async def get_worker_stats(db: AsyncSession) -> dict[str, Any]:
    """Live statistics for the Director oversight dashboard."""
    # Count jobs in pool
    unattended = await db.scalar(
        select(func.count()).select_from(ManualServiceRequest).where(
            ManualServiceRequest.status == ManualServiceStatus.PENDING
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

    # SLA breaches today (jobs that had to be reclaimed)
    sla_breaches = 0  # Future: track via an audit log

    return {
        "total_workers":   total_workers,
        "free_workers":    free_count,
        "busy_workers":    busy_count,
        "unattended_jobs": unattended,
        "completed_today": completed_today,
        "avg_turnaround_minutes": avg_minutes,
        "sla_breaches_today": sla_breaches,
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
