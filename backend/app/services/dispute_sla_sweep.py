"""Dispute SLA Auto-escalation Sweep
==================================
Auto-escalates any dispute sitting OPEN or UNDER_REVIEW beyond the
Director-configured `dispute_sla_hours` (defaults to 48 hours).
Mirroring `reclaim_expired_jobs`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dispute import Dispute, DisputeStatus, DisputeMessage
from app.models.user import User, UserRole
from app.models.settings import SystemConfig
from app.models.notification import NotificationType
from app.services.notification_service import send_notification
from app.utils.audit import log_action

logger = logging.getLogger(__name__)


async def get_dispute_sla_hours(db: AsyncSession) -> int:
    """Reads dispute_sla_hours from system_config (default 48)."""
    val = await db.scalar(
        select(SystemConfig.value).where(SystemConfig.key == "dispute_sla_hours")
    )
    try:
        return max(1, int(val)) if val else 48
    except (ValueError, TypeError):
        return 48


async def sweep_dispute_sla(db: AsyncSession) -> int:
    """
    Checks for open or under-review disputes older than dispute_sla_hours.
    Auto-escalates them to the open Director queue (assigned_to = None, status = ESCALATED)
    and notifies all directors.
    """
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
        prev_assigned = d.assigned_to
        d.status = DisputeStatus.ESCALATED
        d.is_escalated = True
        d.escalated_at = now
        d.escalation_reason = f"Auto-escalated: SLA threshold ({sla_hours} hours) exceeded without resolution."
        d.assigned_to = None
        d.updated_at = now
        escalated_count += 1

        # Add a system dispute message
        msg = DisputeMessage(
            dispute_id=d.id,
            sender_id=None,
            sender_role="system",
            message=f"Dispute exceeded the {sla_hours}-hour resolution SLA and was automatically escalated to the Director queue.",
            is_internal=False,
            created_at=now,
        )
        db.add(msg)

        # Audit log
        await log_action(
            db,
            actor_id=None,
            action="dispute_auto_escalated_sla",
            entity_type="dispute",
            entity_id=d.id,
            details={
                "sla_hours": sla_hours,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "previous_assigned_to": str(prev_assigned) if prev_assigned else None,
            },
        )

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

    await db.commit()
    logger.info("Dispute SLA sweep: auto-escalated %d disputes past %d hours SLA", escalated_count, sla_hours)
    return escalated_count
