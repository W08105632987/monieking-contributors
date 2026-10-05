"""Dispute SLA Auto-escalation Sweep
==================================
Auto-escalates any dispute sitting OPEN or UNDER_REVIEW beyond the
Director-configured `dispute_sla_hours` (defaults to 48 hours).
Mirroring `reclaim_expired_jobs`.

HOTFIX NOTES
------------
The previous version crashed the first time it found an overdue dispute,
and because it ran at the top of GET /disputes, that crash surfaced as a
500 (and, because 500s bypass CORSMiddleware, as a CORS error) on the
"My Disputes" page. Three separate defects:

  1. DisputeMessage(..., sender_role="system") -- the model has no
     `sender_role` column, so the constructor raised TypeError.
  2. DisputeMessage(sender_id=None) -- dispute_messages.sender_id is
     NOT NULL (migration 013), so a "system" message cannot be stored.
  3. log_action(..., details=..., actor_id=None) -- log_action has no
     `details` parameter, and audit_logs.actor_id is NOT NULL.

Because `_last_sweep_time` is stamped before the work starts, a crash made
the next ~2 minutes of requests skip the sweep and succeed, which is why
the page failed on first open and worked after a refresh.

What changed:
  * The sweep now runs inside a SAVEPOINT and can never raise into the
    request that triggered it; failures are logged and the cycle skipped.
  * The system message and audit row are removed (both need a nullable
    "system" actor, i.e. a schema change). The escalation is still fully
    recorded on the dispute itself (status, is_escalated, escalated_at,
    escalation_reason) and directors are still notified.
  * The explicit commit is gone; the request's own get_db() commits.
"""
from __future__ import annotations

import time
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dispute import Dispute, DisputeStatus
from app.models.user import User, UserRole
from app.models.notification import NotificationType
from app.services.notification_service import send_notification
from app.services.settings_service import get_config_int

logger = logging.getLogger(__name__)

# In-process debounce to prevent redundant sweeps on consecutive list requests (1.4)
_last_sweep_time: float = 0.0
SWEEP_DEBOUNCE_SECONDS: float = 120.0  # run at most once every 2 minutes


async def get_dispute_sla_hours(db: AsyncSession) -> int:
    """Reads dispute_sla_hours from system_config (cached TTL, default 48)."""
    val = await get_config_int(db, "dispute_sla_hours", default=48)
    return max(1, val)


async def _run_sweep(db: AsyncSession) -> int:
    sla_hours = await get_dispute_sla_hours(db)
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(hours=sla_hours)

    stmt = (
        select(Dispute)
        .where(
            Dispute.status.in_([DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW]),
            Dispute.created_at <= threshold,
        )
        .with_for_update()
    )
    disputes = (await db.scalars(stmt)).all()
    if not disputes:
        return 0

    # Find directors for notification
    directors_res = await db.execute(
        select(User.id).where(User.role.in_([UserRole.DIRECTOR, UserRole.ADMIN]))
    )
    director_ids = directors_res.scalars().all()

    escalated_count = 0
    for d in disputes:
        d.status = DisputeStatus.ESCALATED
        d.is_escalated = True
        d.escalated_at = now
        d.escalation_reason = f"Auto-escalated: SLA threshold ({sla_hours} hours) exceeded without resolution."
        d.assigned_to = None
        d.updated_at = now
        escalated_count += 1

        # Notify directors
        for dir_id in director_ids:
            await send_notification(
                db,
                user_id=dir_id,
                type=NotificationType.WARNING,
                title="Dispute SLA Breached — Auto-Escalated",
                body=f"Dispute #{str(d.id)[:8]} has exceeded the {sla_hours}h SLA and is now in the open Director queue.",
                related_entity_id=d.id,
            )

    await db.flush()
    logger.info("Dispute SLA sweep: auto-escalated %d disputes past %d hours SLA", escalated_count, sla_hours)
    return escalated_count


async def sweep_dispute_sla(db: AsyncSession, force: bool = False) -> int:
    """
    Checks for open or under-review disputes older than dispute_sla_hours.
    Auto-escalates them to the open Director queue (assigned_to = None, status = ESCALATED)
    and notifies all directors.
    Debounced: Runs at most once every SWEEP_DEBOUNCE_SECONDS unless force=True.

    Never raises: this is housekeeping that piggybacks on list requests, and
    must not be able to break the request that happened to trigger it.
    """
    global _last_sweep_time
    now_ts = time.time()
    if not force and (now_ts - _last_sweep_time) < SWEEP_DEBOUNCE_SECONDS:
        return 0
    _last_sweep_time = now_ts

    try:
        # SAVEPOINT: if anything inside fails, only the sweep's own writes are
        # rolled back, and the caller's session stays healthy for its own queries.
        async with db.begin_nested():
            return await _run_sweep(db)
    except Exception:
        logger.exception("Dispute SLA sweep failed — skipping this cycle")
        return 0
