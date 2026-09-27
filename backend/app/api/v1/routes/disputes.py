"""Customer & Worker dispute routes — wallet transactions, withdrawals, and manual services.

Routing: a dispute defaults to the customer's zone officer (User.zone_id).
If the customer has no zone (self-registered), or once escalated, the dispute
drops into the open director queue (assigned_to = NULL) for any director to claim.

FIX HISTORY (migration 038 / dispute overhaul):
  4.1.1 — SERVICE_WORKER can now resolve disputes assigned to them (non-final)
  4.1.2 — Duplicate check now scoped to service_request_id, not also raised_by
  4.1.3 — entity_type = MANUAL_SERVICE_REQUEST (not WALLET_TRANSACTION)
  4.1.4 — req.dispute_id is now set at dispute creation
  4.1.7 — real DisputeReason values collected from callers
  4.1.8 — log_action added to claim, resolve, escalate, and both create paths
  4.1.9 — dispute_sla_hours auto-escalation sweep (see services/dispute_sla_sweep.py)
  4.1.10— is_internal flag on messages; customers cannot see internal notes
  4.2   — _serialize_detail returns job_context when service_request_id is set
  4.4   — commission hold/release on dispute create/resolve
"""
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload, aliased

from app.core.database import get_db
from app.core.dependencies import CurrentUser, CustomerOnly, DirectorOrAdmin, ServiceWorkerOnly
from app.models.dispute import (
    Dispute, DisputeMessage, DisputeStatus, DisputeEntityType, DisputeReason,
)
from app.models.user import User, UserRole
from app.models.wallet import Wallet, WalletTransaction
from app.models.withdrawal import Withdrawal
from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus, CommissionStatus
from app.models.notification import NotificationType
from app.models.settings import SystemConfig
from app.schemas.dispute import (
    CreateDisputeRequest, AddMessageRequest, ResolveDisputeRequest,
    DisputeResponse, DisputeDetailResponse,
)
from app.utils.audit import log_action
from app.services.notification_service import send_notification
from app.services.dispute_sla_sweep import sweep_dispute_sla

router = APIRouter(prefix="/disputes", tags=["disputes"])


# ─── Helpers ────────────────────────────────────────────────────────────────

async def _notify_all_directors(db: AsyncSession, dispute: Dispute, title: str, body: str) -> None:
    directors_result = await db.execute(
        select(User.id).where(User.role.in_([UserRole.DIRECTOR, UserRole.ADMIN]))
    )
    for director_id in directors_result.scalars().all():
        await send_notification(
            db, user_id=director_id, type=NotificationType.WARNING,
            title=title, body=body, related_entity_id=dispute.id,
        )


def _serialize_dispute(d: Dispute, current_user: User) -> dict:
    # 4.1.1 — workers assigned to this dispute can also resolve it
    if current_user.role == UserRole.OFFICER:
        can_resolve = d.status != DisputeStatus.RESOLVED and _officer_has_zone_access(d, current_user)
    elif current_user.role in (UserRole.DIRECTOR, UserRole.ADMIN):
        can_resolve = d.status != DisputeStatus.RESOLVED and d.assigned_to == current_user.id
    elif current_user.role == UserRole.SERVICE_WORKER:
        can_resolve = (
            d.status != DisputeStatus.RESOLVED
            and d.assigned_worker_id == current_user.id
        )
    else:
        can_resolve = False

    return {
        "id":                 d.id,
        "raised_by":          d.raised_by,
        "customer_name":      d.customer.full_name if d.customer else "Unknown",
        "entity_type":        d.entity_type,
        "entity_id":          d.entity_id,
        "reason":             d.reason,
        "status":             d.status,
        "assigned_to":        d.assigned_to,
        "handler_name":       d.handler.full_name if d.handler else None,
        "resolution_summary": d.resolution_summary,
        "can_resolve":        can_resolve,
        "service_request_id": d.service_request_id,
        "assigned_worker_id": d.assigned_worker_id,
        "is_escalated":       d.is_escalated,
        "escalated_at":       d.escalated_at,
        "escalation_reason":  d.escalation_reason,
        "raised_by_role":     "service_worker" if (d.assigned_worker_id and d.raised_by == d.assigned_worker_id) else "customer",
        "is_worker_raised":   bool(d.assigned_worker_id and d.raised_by == d.assigned_worker_id),
        "created_at":         d.created_at,
        "updated_at":         d.updated_at,
        "resolved_at":        d.resolved_at,
    }


async def _build_job_context(db: AsyncSession, service_request_id: uuid.UUID) -> dict | None:
    """4.2 — rich context card for manual-service disputes."""
    req = await db.get(ManualServiceRequest, service_request_id)
    if not req:
        return None

    customer = await db.get(User, req.user_id)
    worker   = await db.get(User, req.claimed_by_id) if req.claimed_by_id else None

    # "Ongoing since" — from claimed_at (or created_at) to now
    since = req.claimed_at if getattr(req, "claimed_at", None) else req.created_at
    delta = datetime.now(timezone.utc) - (since.replace(tzinfo=timezone.utc) if since.tzinfo is None else since)
    days, remainder = divmod(int(delta.total_seconds()), 86400)
    hours = remainder // 3600
    ongoing = f"{days}d {hours}h" if days else f"{hours}h"

    return {
        "customer_name":       customer.full_name if customer else "Unknown",
        "service_category":    req.service_category,
        "service_type":        req.service_type,
        "worker_name":         worker.full_name if worker else None,
        "ongoing_since":       ongoing,
        "job_status":          req.status.value if hasattr(req.status, "value") else str(req.status),
        "worker_remarks":      req.worker_remarks,
        "commission_kobo":     req.worker_commission_kobo,
        "commission_status":   req.commission_status.value if hasattr(req, "commission_status") else "cleared",
    }


def _serialize_detail(d: Dispute, current_user: User, job_context: dict | None = None) -> dict:
    is_customer = current_user.role == UserRole.CUSTOMER
    return {
        **_serialize_dispute(d, current_user),
        "service_request_id": str(d.service_request_id) if d.service_request_id else None,
        "assigned_worker_id": str(d.assigned_worker_id) if d.assigned_worker_id else None,
        "is_escalated":       d.is_escalated,
        "escalated_at":       d.escalated_at,
        "escalation_reason":  d.escalation_reason,
        "job_context":        job_context,   # 4.2 — None for non-manual-service disputes
        "messages": [
            {
                "id":              m.id,
                "sender_id":       m.sender_id,
                "sender_name":     m.sender.full_name if m.sender else "Unknown",
                "message":         m.message,
                "is_internal":     m.is_internal,  # 4.1.10
                "attachment_url":  m.attachment_url,
                "attachment_name": m.attachment_name,
                "attachment_size": m.attachment_size,
                "read_at":         m.read_at,
                "created_at":      m.created_at,
            }
            for m in d.messages
            # 4.1.10 — customers cannot see internal notes
            if not (is_customer and m.is_internal)
        ],
    }


async def _load_dispute(db: AsyncSession, dispute_id: uuid.UUID) -> Dispute | None:
    result = await db.execute(
        select(Dispute)
        .options(
            selectinload(Dispute.customer),
            selectinload(Dispute.handler),
            selectinload(Dispute.assigned_worker),
            selectinload(Dispute.messages).selectinload(DisputeMessage.sender),
        )
        .where(Dispute.id == dispute_id)
    )
    return result.scalar_one_or_none()


def _assert_can_view(dispute: Dispute, user: User) -> None:
    if user.role == UserRole.CUSTOMER and dispute.raised_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if user.role == UserRole.OFFICER and not _officer_has_zone_access(dispute, user):
        raise HTTPException(status_code=403, detail="Access denied")
    if user.role == UserRole.SERVICE_WORKER:
        if dispute.assigned_worker_id != user.id and dispute.raised_by != user.id:
            raise HTTPException(status_code=403, detail="Access denied")
    # Directors can view any dispute


def _officer_has_zone_access(dispute: Dispute, officer: User) -> bool:
    if dispute.assigned_to is None:
        return False
    if dispute.status == DisputeStatus.ESCALATED:
        return False
    if dispute.handler and dispute.handler.role != UserRole.OFFICER:
        return False
    return dispute.zone_id == officer.zone_id


async def _get_config_int(db: AsyncSession, key: str, default: int) -> int:
    row = await db.get(SystemConfig, key)
    if row:
        try:
            return int(row.value)
        except (ValueError, TypeError):
            pass
    return default


# ─── Commission hold helpers (4.4) ──────────────────────────────────────────

async def _hold_commission(
    db: AsyncSession,
    req: ManualServiceRequest,
    dispute: Dispute,
) -> None:
    """Hold commission from the assigned worker when a dispute is created."""
    if not req.claimed_by_id or req.worker_commission_kobo <= 0:
        return
    if req.commission_status != CommissionStatus.CLEARED:
        return  # already held or reversed

    worker = await db.get(User, req.claimed_by_id)
    if not worker:
        return

    hold_amount = min(worker.commission_balance_kobo, req.worker_commission_kobo)
    shortfall   = req.worker_commission_kobo - hold_amount

    worker.commission_balance_kobo -= hold_amount
    worker.commission_held_kobo    += hold_amount

    if shortfall > 0:
        # Worker already withdrew part/all of it — record the debt
        worker.commission_debt_kobo += shortfall

    req.commission_status = CommissionStatus.HELD

    await log_action(
        db, actor_id=worker.id, action="commission.held",
        entity_type="dispute", entity_id=str(dispute.id),
        new_value={
            "hold_amount_kobo": hold_amount,
            "shortfall_kobo":   shortfall,
            "commission_balance_after": worker.commission_balance_kobo,
            "commission_held_after":    worker.commission_held_kobo,
            "commission_debt_after":    worker.commission_debt_kobo,
        },
    )


async def _release_commission_for_worker(
    db: AsyncSession,
    req: ManualServiceRequest,
    dispute: Dispute,
    in_worker_favor: bool,
) -> None:
    """
    Release held commission after a dispute is resolved.
    in_worker_favor=True  → return funds to balance, cancel debt
    in_worker_favor=False → funds are forfeited, debt remains active
    """
    if req.commission_status != CommissionStatus.HELD:
        return
    if not req.claimed_by_id:
        return

    worker = await db.get(User, req.claimed_by_id)
    if not worker:
        return

    hold_amount = min(worker.commission_held_kobo, req.worker_commission_kobo)

    if in_worker_favor:
        # Restore
        worker.commission_held_kobo    -= hold_amount
        worker.commission_balance_kobo += hold_amount
        # Cancel any debt that was recorded for this specific job
        # (best effort — we cancel up to the shortfall that was recorded)
        shortfall = req.worker_commission_kobo - hold_amount
        if shortfall > 0:
            worker.commission_debt_kobo = max(0, worker.commission_debt_kobo - shortfall)
        req.commission_status = CommissionStatus.CLEARED
        action = "commission.released_to_worker"
    else:
        # Forfeit
        worker.commission_held_kobo -= hold_amount
        # Debt stays active — absorbed by future job commissions
        req.commission_status = CommissionStatus.REVERSED
        action = "commission.reversed"

    await log_action(
        db, actor_id=worker.id, action=action,
        entity_type="dispute", entity_id=str(dispute.id),
        new_value={
            "hold_amount_forfeited_or_returned_kobo": hold_amount,
            "in_worker_favor": in_worker_favor,
            "commission_balance_after": worker.commission_balance_kobo,
            "commission_held_after":    worker.commission_held_kobo,
            "commission_debt_after":    worker.commission_debt_kobo,
        },
    )


# ─── Routes ─────────────────────────────────────────────────────────────────

@router.post("", response_model=DisputeResponse, status_code=201)
async def create_dispute(
    body: CreateDisputeRequest,
    customer: CustomerOnly,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    if body.entity_type == DisputeEntityType.WALLET_TRANSACTION:
        result = await db.execute(
            select(WalletTransaction.id, Wallet.owner_id)
            .join(Wallet, Wallet.id == WalletTransaction.wallet_id)
            .where(WalletTransaction.id == body.entity_id)
        )
        row = result.first()
        entity, owner_id = (row, row[1]) if row else (None, None)
    else:
        result = await db.execute(select(Withdrawal).where(Withdrawal.id == body.entity_id))
        entity = result.scalar_one_or_none()
        owner_id = entity.customer_id if entity else None

    if not entity or owner_id != customer.id:
        raise HTTPException(status_code=404, detail="That transaction or withdrawal wasn't found on your account")

    existing = await db.execute(
        select(Dispute).where(
            Dispute.entity_type == body.entity_type,
            Dispute.entity_id == body.entity_id,
            Dispute.status != DisputeStatus.RESOLVED,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="There's already an open dispute for this")

    assigned_to: uuid.UUID | None = None
    if customer.zone_id:
        officer_result = await db.execute(
            select(User).where(User.zone_id == customer.zone_id, User.role == UserRole.OFFICER)
        )
        officer = officer_result.scalar_one_or_none()
        assigned_to = officer.id if officer else None

    dispute = Dispute(
        raised_by=   customer.id,
        entity_type= body.entity_type,
        entity_id=   body.entity_id,
        reason=      body.reason,
        status=      DisputeStatus.OPEN,
        assigned_to= assigned_to,
        zone_id=     customer.zone_id,
    )
    db.add(dispute)
    await db.flush()

    db.add(DisputeMessage(dispute_id=dispute.id, sender_id=customer.id, message=body.message))
    await db.flush()

    await log_action(
        db, actor_id=customer.id, action="dispute.created",
        entity_type="dispute", entity_id=str(dispute.id),
        ip_address=request.client.host if request else None,
    )

    if assigned_to:
        await send_notification(
            db, user_id=assigned_to, type=NotificationType.WARNING,
            title="New dispute raised",
            body=f"{customer.full_name} raised a dispute — tap to review.",
            related_entity_id=dispute.id,
        )
    else:
        await _notify_all_directors(
            db, dispute, "New dispute — unassigned",
            f"{customer.full_name} raised a dispute with no zone officer — tap to claim it.",
        )

    dispute = await _load_dispute(db, dispute.id)
    return _serialize_dispute(dispute, customer)


@router.get("", response_model=list[DisputeResponse])
async def list_disputes(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    # 4.1.9 — sweep any overdue disputes past dispute_sla_hours
    await sweep_dispute_sla(db)

    query = select(Dispute).options(selectinload(Dispute.customer), selectinload(Dispute.handler))

    if current_user.role == UserRole.CUSTOMER:
        query = query.where(Dispute.raised_by == current_user.id)
    elif current_user.role == UserRole.OFFICER:
        handler = aliased(User)
        query = (
            query
            .join(handler, Dispute.assigned_to == handler.id)
            .where(
                Dispute.zone_id == current_user.zone_id,
                Dispute.status != DisputeStatus.ESCALATED,
                handler.role == UserRole.OFFICER,
            )
        )
    elif current_user.role == UserRole.SERVICE_WORKER:
        query = query.where(
            (Dispute.assigned_worker_id == current_user.id) | (Dispute.raised_by == current_user.id)
        )
    elif current_user.role in (UserRole.DIRECTOR, UserRole.ADMIN):
        query = query.where(
            (Dispute.assigned_to.is_(None)) | (Dispute.assigned_to == current_user.id)
        )
    else:
        raise HTTPException(status_code=403, detail="Access denied")

    query = query.order_by(Dispute.created_at.desc())
    result = await db.execute(query)
    return [_serialize_dispute(d, current_user) for d in result.scalars().all()]


@router.get("/worker/mine", response_model=list[DisputeResponse])
async def list_worker_disputes(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """4.3 Service Worker: list all disputes assigned to or raised by the worker."""
    if current_user.role != UserRole.SERVICE_WORKER:
        raise HTTPException(status_code=403, detail="Only service workers can access this endpoint")

    await sweep_dispute_sla(db)

    query = (
        select(Dispute)
        .options(selectinload(Dispute.customer), selectinload(Dispute.handler))
        .where(
            (Dispute.assigned_worker_id == current_user.id) | (Dispute.raised_by == current_user.id)
        )
        .order_by(Dispute.created_at.desc())
    )
    result = await db.execute(query)
    return [_serialize_dispute(d, current_user) for d in result.scalars().all()]


@router.get("/{dispute_id}", response_model=DisputeDetailResponse)
async def get_dispute(
    dispute_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    dispute = await _load_dispute(db, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")
    _assert_can_view(dispute, current_user)

    now = datetime.now(timezone.utc)
    unread_from_others = [m for m in dispute.messages if m.sender_id != current_user.id and m.read_at is None]
    if unread_from_others:
        for m in unread_from_others:
            m.read_at = now
        await db.flush()
        dispute = await _load_dispute(db, dispute_id)

    # 4.2 — build job_context for manual-service disputes
    job_context = None
    if dispute.service_request_id:
        job_context = await _build_job_context(db, dispute.service_request_id)

    return _serialize_detail(dispute, current_user, job_context=job_context)


@router.post("/{dispute_id}/messages", response_model=DisputeDetailResponse)
async def add_message(
    dispute_id: uuid.UUID,
    body: AddMessageRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    dispute = await _load_dispute(db, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")
    _assert_can_view(dispute, current_user)
    if dispute.status == DisputeStatus.RESOLVED:
        raise HTTPException(status_code=400, detail="This dispute is already resolved")

    # 4.1.10 — only officers/directors/workers can post internal notes
    is_internal = getattr(body, "is_internal", False)
    if is_internal and current_user.role == UserRole.CUSTOMER:
        is_internal = False  # silently downgrade

    db.add(DisputeMessage(
        dispute_id=dispute.id,
        sender_id=current_user.id,
        message=body.message,
        is_internal=is_internal,
        attachment_url=getattr(body, "attachment_url", None),
        attachment_name=getattr(body, "attachment_name", None),
        attachment_size=getattr(body, "attachment_size", None),
    ))
    if dispute.status == DisputeStatus.OPEN and current_user.id != dispute.raised_by:
        dispute.status = DisputeStatus.UNDER_REVIEW
    if current_user.role == UserRole.OFFICER and dispute.assigned_to != current_user.id:
        dispute.assigned_to = current_user.id
    await db.flush()

    notify_id = dispute.raised_by if current_user.id != dispute.raised_by else dispute.assigned_to
    if notify_id and not is_internal:
        await send_notification(
            db, user_id=notify_id, type=NotificationType.INFO,
            title="New reply on your dispute",
            body=f"{current_user.full_name} replied — tap to view.",
            related_entity_id=dispute.id,
        )

    dispute = await _load_dispute(db, dispute.id)
    job_context = None
    if dispute.service_request_id:
        job_context = await _build_job_context(db, dispute.service_request_id)
    return _serialize_detail(dispute, current_user, job_context=job_context)


@router.post("/{dispute_id}/claim", response_model=DisputeResponse)
async def claim_dispute(
    dispute_id: uuid.UUID,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Director claims an unclaimed (self-registered or escalated) dispute."""
    result = await db.execute(
        select(Dispute)
        .where(Dispute.id == dispute_id, Dispute.assigned_to.is_(None))
        .with_for_update(skip_locked=True)
    )
    dispute = result.scalar_one_or_none()
    if not dispute:
        raise HTTPException(status_code=409, detail="Already claimed or does not exist")

    dispute.assigned_to = director.id
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="dispute.claimed",
        entity_type="dispute", entity_id=str(dispute.id),
    )

    dispute = await _load_dispute(db, dispute.id)
    return _serialize_dispute(dispute, director)


@router.post("/{dispute_id}/resolve", response_model=DisputeDetailResponse)
async def resolve_dispute(
    dispute_id: uuid.UUID,
    body: ResolveDisputeRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    # 4.1.1 — SERVICE_WORKER can resolve disputes they're assigned to
    allowed_roles = (UserRole.OFFICER, UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SERVICE_WORKER)
    if current_user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Access denied")

    dispute = await _load_dispute(db, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")

    if current_user.role == UserRole.OFFICER:
        if not _officer_has_zone_access(dispute, current_user):
            raise HTTPException(status_code=403, detail="Access denied")
    elif current_user.role == UserRole.SERVICE_WORKER:
        # 4.1.1 — workers resolve only their own assigned disputes, and it's non-final
        if dispute.assigned_worker_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")
        if dispute.status == DisputeStatus.RESOLVED:
            raise HTTPException(status_code=400, detail="Already resolved")
    else:
        # Directors resolve only what they've explicitly claimed
        if dispute.assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    # Determine finality: director resolutions are final, all others can be escalated
    is_final = current_user.role in (UserRole.DIRECTOR, UserRole.ADMIN)
    in_worker_favor = getattr(body, "in_worker_favor", True)

    dispute.status             = DisputeStatus.RESOLVED
    dispute.resolution_summary = body.resolution_summary
    dispute.resolved_at        = datetime.now(timezone.utc)
    dispute.assigned_to        = current_user.id
    db.add(DisputeMessage(
        dispute_id=dispute.id, sender_id=current_user.id, message=body.resolution_summary
    ))
    await db.flush()

    # 4.4 — release/forfeit commission hold on resolution
    if dispute.service_request_id:
        req = await db.get(ManualServiceRequest, dispute.service_request_id)
        if req:
            await _release_commission_for_worker(db, req, dispute, in_worker_favor=in_worker_favor)
            await db.flush()

    await log_action(
        db, actor_id=current_user.id, action="dispute.resolved",
        entity_type="dispute", entity_id=str(dispute.id),
        new_value={"resolution": body.resolution_summary, "is_final": is_final, "in_worker_favor": in_worker_favor},
    )

    await send_notification(
        db, user_id=dispute.raised_by, type=NotificationType.SUCCESS,
        title="Your dispute has been resolved",
        body="Tap to see the resolution. You can escalate if you disagree." if not is_final else "Tap to see the resolution.",
        related_entity_id=dispute.id,
    )

    dispute = await _load_dispute(db, dispute.id)
    job_context = None
    if dispute.service_request_id:
        job_context = await _build_job_context(db, dispute.service_request_id)
    return _serialize_detail(dispute, current_user, job_context=job_context)


@router.post("/{dispute_id}/escalate", response_model=DisputeResponse)
async def escalate_dispute(
    dispute_id: uuid.UUID,
    body: dict | None = None,
    current_user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """Customer or Service Worker escalates to Director.
    Director resolutions are final — cannot be escalated further."""
    if body is None:
        body = {}
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    dispute = await _load_dispute(db, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")

    if current_user.role == UserRole.CUSTOMER and dispute.raised_by != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == UserRole.SERVICE_WORKER and dispute.assigned_worker_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role not in (UserRole.CUSTOMER, UserRole.SERVICE_WORKER):
        raise HTTPException(status_code=403, detail="Only customers and service workers can escalate")

    if dispute.status not in (DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.RESOLVED):
        raise HTTPException(status_code=400, detail="This dispute cannot be escalated in its current state")
    if dispute.handler and dispute.handler.role in (UserRole.DIRECTOR, UserRole.ADMIN):
        raise HTTPException(status_code=400, detail="This was already resolved by a director — nowhere further to escalate")

    escalation_reason = body.get("reason") if isinstance(body, dict) else None

    dispute.status            = DisputeStatus.ESCALATED
    dispute.assigned_to       = None
    dispute.resolved_at       = None
    dispute.is_escalated      = True
    dispute.escalated_at      = datetime.now(timezone.utc)
    dispute.escalation_reason = escalation_reason
    await db.flush()

    await log_action(
        db, actor_id=current_user.id, action="dispute.escalated",
        entity_type="dispute", entity_id=str(dispute.id),
        new_value={"reason": escalation_reason},
    )

    await _notify_all_directors(
        db, dispute, "Dispute escalated",
        f"{current_user.full_name} escalated a dispute — tap to review.",
    )

    dispute = await _load_dispute(db, dispute.id)
    return _serialize_dispute(dispute, current_user)


# ─── Manual Service Dispute ──────────────────────────────────────────────────

class CreateManualServiceDisputeRequest(BaseModel):
    service_request_id: uuid.UUID
    reason:             str = DisputeReason.OTHER.value   # 4.1.7 — real reason collected
    message:            str
    attachment_url:     str | None = None
    attachment_name:    str | None = None
    attachment_size:    int | None = None


@router.post("/manual-service", status_code=201)
async def create_manual_service_dispute(
    body: CreateManualServiceDisputeRequest,
    customer: CustomerOnly,
    db: AsyncSession = Depends(get_db),
):
    """Customer disputes a completed manual service request.
    Routes to the assigned Service Worker first; escalates to Director if needed.
    4.4 — holds worker commission in-flight for the dispute duration.
    """
    req = await db.scalar(
        select(ManualServiceRequest).where(
            ManualServiceRequest.id == body.service_request_id,
            ManualServiceRequest.user_id == customer.id,
        )
    )
    if not req:
        raise HTTPException(status_code=404, detail="Service request not found on your account.")
    if req.status not in (ManualServiceStatus.SUCCESSFUL, ManualServiceStatus.FAILED):
        raise HTTPException(status_code=400, detail="You can only dispute completed service requests.")

    # 4.4 — check eligibility window for commission-hold disputes
    eligibility_hours = await _get_config_int(db, "dispute_eligibility_window_hours", 72)
    if req.status == ManualServiceStatus.SUCCESSFUL and req.worker_commission_kobo > 0:
        completed = getattr(req, "completed_at", None) or req.updated_at
        if completed:
            age_hours = (datetime.now(timezone.utc) - completed.replace(tzinfo=timezone.utc)).total_seconds() / 3600
            if age_hours > eligibility_hours:
                raise HTTPException(
                    status_code=400,
                    detail=f"This service was completed more than {eligibility_hours} hours ago and is no longer eligible for a commission dispute. You can still raise a general complaint — contact support."
                )

    # 4.1.2 — one live dispute per job (regardless of who raised it)
    existing = await db.scalar(
        select(Dispute).where(
            Dispute.service_request_id == body.service_request_id,
            Dispute.status != DisputeStatus.RESOLVED,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="There's already an open dispute for this service request. Use the existing dispute thread.")

    # Validate reason
    try:
        reason = DisputeReason(body.reason)
    except ValueError:
        reason = DisputeReason.OTHER

    assigned_worker_id = req.claimed_by_id
    assigned_to: uuid.UUID | None = assigned_worker_id

    # 4.1.3 — correct entity_type
    dispute = Dispute(
        raised_by=          customer.id,
        entity_type=        DisputeEntityType.MANUAL_SERVICE_REQUEST,
        entity_id=          body.service_request_id,
        reason=             reason,
        status=             DisputeStatus.OPEN,
        assigned_to=        assigned_to,
        assigned_worker_id= assigned_worker_id,
        service_request_id= body.service_request_id,
        zone_id=            customer.zone_id,
    )
    db.add(dispute)
    await db.flush()

    # 4.1.4 — set dispute_id on the service request
    req.dispute_id = dispute.id

    db.add(DisputeMessage(
        dispute_id=dispute.id,
        sender_id=customer.id,
        message=body.message,
        attachment_url=body.attachment_url,
        attachment_name=body.attachment_name,
        attachment_size=body.attachment_size,
    ))
    await db.flush()

    # 4.4 — hold commission
    await _hold_commission(db, req, dispute)
    await db.flush()

    await log_action(
        db, actor_id=customer.id, action="dispute.manual_service.created",
        entity_type="dispute", entity_id=str(dispute.id),
        new_value={"service_request_id": str(body.service_request_id), "reason": reason.value},
    )

    if assigned_worker_id:
        await send_notification(
            db, user_id=assigned_worker_id, type=NotificationType.WARNING,
            title="Service dispute raised",
            body=f"{customer.full_name} has disputed a service you handled — a commission hold has been placed.",
            related_entity_id=dispute.id,
        )
    else:
        await _notify_all_directors(
            db, dispute, "Unassigned service dispute",
            f"{customer.full_name} raised a dispute on a service with no assigned worker.",
        )

    dispute = await _load_dispute(db, dispute.id)
    job_context = await _build_job_context(db, body.service_request_id)
    return _serialize_detail(dispute, customer, job_context=job_context)


# ─── Worker: raise a dispute ─────────────────────────────────────────────────

class CreateWorkerDisputeRequest(BaseModel):
    service_request_id: uuid.UUID
    reason:             str = DisputeReason.OTHER.value  # 4.1.7
    message:            str
    attachment_url:     str | None = None
    attachment_name:    str | None = None
    attachment_size:    int | None = None


@router.post("/manual-service/worker-raise", status_code=201)
async def create_worker_manual_service_dispute(
    body: CreateWorkerDisputeRequest,
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """Service Worker disputes a manual service job they are/were assigned to.
    Routes directly to the Director queue (assigned_to = None).
    4.4 — if the worker raises the dispute on their own completed job, commission is also held.
    """
    req = await db.scalar(
        select(ManualServiceRequest).where(
            ManualServiceRequest.id == body.service_request_id,
            ManualServiceRequest.claimed_by_id == current_user.id,
        )
    )
    if not req:
        raise HTTPException(status_code=404, detail="Job not found or you are not the assigned service worker.")
    if req.status not in (ManualServiceStatus.PROCESSING, ManualServiceStatus.SUCCESSFUL, ManualServiceStatus.FAILED):
        raise HTTPException(status_code=400, detail="Cannot dispute a job in this status.")

    # 4.1.2 — one live dispute per job
    existing = await db.scalar(
        select(Dispute).where(
            Dispute.service_request_id == body.service_request_id,
            Dispute.status != DisputeStatus.RESOLVED,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="There's already an open dispute for this job. Use the existing dispute thread.")

    try:
        reason = DisputeReason(body.reason)
    except ValueError:
        reason = DisputeReason.OTHER

    customer = await db.get(User, req.user_id)
    customer_zone_id = customer.zone_id if customer else None

    # 4.1.3 — correct entity_type
    dispute = Dispute(
        raised_by=          current_user.id,
        entity_type=        DisputeEntityType.MANUAL_SERVICE_REQUEST,
        entity_id=          body.service_request_id,
        reason=             reason,
        status=             DisputeStatus.OPEN,
        assigned_to=        None,
        assigned_worker_id= current_user.id,
        service_request_id= body.service_request_id,
        zone_id=            customer_zone_id,
    )
    db.add(dispute)
    await db.flush()

    # 4.1.4 — set dispute_id on the service request
    req.dispute_id = dispute.id

    db.add(DisputeMessage(
        dispute_id=dispute.id,
        sender_id=current_user.id,
        message=body.message,
        attachment_url=body.attachment_url,
        attachment_name=body.attachment_name,
        attachment_size=body.attachment_size,
    ))
    await db.flush()

    # 4.4 — hold commission (if worker disputes their own successful job)
    if req.status == ManualServiceStatus.SUCCESSFUL:
        await _hold_commission(db, req, dispute)
        await db.flush()

    await log_action(
        db, actor_id=current_user.id, action="dispute.manual_service.worker_raised",
        entity_type="dispute", entity_id=str(dispute.id),
        new_value={"service_request_id": str(body.service_request_id), "reason": reason.value},
    )

    await _notify_all_directors(
        db, dispute, "Worker dispute raised",
        f"{current_user.full_name} raised a dispute on job {str(req.id)[:8]} ({reason.value.replace('_', ' ')}) — tap to review.",
    )

    dispute = await _load_dispute(db, dispute.id)
    job_context = await _build_job_context(db, body.service_request_id)
    return _serialize_detail(dispute, current_user, job_context=job_context)


# ─── Worker: view their disputes ─────────────────────────────────────────────

@router.get("/worker/mine")
async def list_worker_disputes(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Service Worker sees disputes assigned to them or raised by them."""
    if current_user.role != UserRole.SERVICE_WORKER:
        raise HTTPException(status_code=403, detail="Service Workers only")
    result = await db.execute(
        select(Dispute)
        .options(selectinload(Dispute.customer), selectinload(Dispute.handler))
        .where(
            (Dispute.assigned_worker_id == current_user.id) | (Dispute.raised_by == current_user.id)
        )
        .order_by(Dispute.created_at.desc())
    )
    return [_serialize_dispute(d, current_user) for d in result.scalars().all()]