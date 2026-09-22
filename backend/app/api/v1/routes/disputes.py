"""Customer dispute routes — wallet transactions and withdrawals only.

Routing: a dispute defaults to the customer's zone officer (User.zone_id,
same live-assignment pattern zone_assignments.py documents). If the
customer has no zone (self-registered), or once a customer escalates
after an officer's resolution, the dispute drops into the open director
queue (assigned_to = NULL) for any director to claim — same optimistic
claim pattern as Withdrawal.claimed_by_director_id.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload, aliased

from app.core.database import get_db
from app.core.dependencies import CurrentUser, CustomerOnly, DirectorOrAdmin
from app.models.dispute import Dispute, DisputeMessage, DisputeStatus, DisputeEntityType
from app.models.user import User, UserRole
from app.models.wallet import Wallet, WalletTransaction
from app.models.withdrawal import Withdrawal
from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus
from app.models.notification import NotificationType
from app.schemas.dispute import (
    CreateDisputeRequest, AddMessageRequest, ResolveDisputeRequest,
    DisputeResponse, DisputeDetailResponse,
)
from app.utils.audit import log_action
from app.services.notification_service import send_notification

router = APIRouter(prefix="/disputes", tags=["disputes"])


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
    if current_user.role == UserRole.OFFICER:
        can_resolve = d.status != DisputeStatus.RESOLVED and _officer_has_zone_access(d, current_user)
    elif current_user.role in (UserRole.DIRECTOR, UserRole.ADMIN):
        can_resolve = d.status != DisputeStatus.RESOLVED and d.assigned_to == current_user.id
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
        "created_at":         d.created_at,
        "updated_at":         d.updated_at,
        "resolved_at":        d.resolved_at,
    }


def _serialize_detail(d: Dispute, current_user: User) -> dict:
    return {
        **_serialize_dispute(d, current_user),
        "service_request_id": str(d.service_request_id) if d.service_request_id else None,
        "assigned_worker_id": str(d.assigned_worker_id) if d.assigned_worker_id else None,
        "is_escalated":       d.is_escalated,
        "escalated_at":       d.escalated_at,
        "escalation_reason":  d.escalation_reason,
        "messages": [
            {
                "id":              m.id,
                "sender_id":       m.sender_id,
                "sender_name":     m.sender.full_name if m.sender else "Unknown",
                "message":         m.message,
                "attachment_url":  m.attachment_url,
                "attachment_name": m.attachment_name,
                "attachment_size": m.attachment_size,
                "read_at":         m.read_at,
                "created_at":      m.created_at,
            }
            for m in d.messages
        ],
    }


async def _load_dispute(db: AsyncSession, dispute_id: uuid.UUID) -> Dispute | None:
    result = await db.execute(
        select(Dispute)
        .options(
            selectinload(Dispute.customer),
            selectinload(Dispute.handler),
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
        # Workers can only view disputes linked to their own jobs
        if dispute.assigned_worker_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")
    # Directors can view any dispute


def _officer_has_zone_access(dispute: Dispute, officer: User) -> bool:
    """Zone-based, not assigned_to-based — same philosophy as customer/
    card access elsewhere: whoever CURRENTLY covers a zone can act on its
    disputes, not just whoever it happened to be routed to originally.
    So if zone coverage gets reassigned mid-dispute, the new officer
    gains access and the old one loses it, same as cards already work.

    Still correctly locked out once escalated or claimed by a director —
    those states mean it's left officer territory entirely, and zone
    coverage shouldn't override that.
    """
    if dispute.assigned_to is None:
        return False  # unclaimed — director queue territory, not zone-based
    if dispute.status == DisputeStatus.ESCALATED:
        return False
    if dispute.handler and dispute.handler.role != UserRole.OFFICER:
        return False  # already claimed by a director
    return dispute.zone_id == officer.zone_id


@router.post("", response_model=DisputeResponse, status_code=201)
async def create_dispute(
    body: CreateDisputeRequest,
    customer: CustomerOnly,
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    # Confirm the disputed entity actually belongs to this customer —
    # otherwise anyone could dispute anyone else's transaction by guessing
    # a UUID.
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

    # One open dispute per entity at a time.
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
        assigned_to = officer.id if officer else None  # zone has no officer right now -> director queue

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
        # No zone officer to route to — every director needs to know this
        # landed in the open queue, not just whoever happens to check.
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
    query = select(Dispute).options(selectinload(Dispute.customer), selectinload(Dispute.handler))

    if current_user.role == UserRole.CUSTOMER:
        query = query.where(Dispute.raised_by == current_user.id)
    elif current_user.role == UserRole.OFFICER:
        # Zone-based, mirroring _officer_has_zone_access — see that
        # function for the full reasoning. Expressed as a join here
        # since SQL can't call the Python helper directly; keep the two
        # in sync if this logic ever changes.
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
    elif current_user.role in (UserRole.DIRECTOR, UserRole.ADMIN):
        # Directors see: unclaimed queue (open director queue) + whatever
        # they've personally claimed. Not every officer's in-progress
        # dispute — those stay with the officer until escalated.
        query = query.where(
            (Dispute.assigned_to.is_(None)) | (Dispute.assigned_to == current_user.id)
        )
    else:
        raise HTTPException(status_code=403, detail="Access denied")

    query = query.order_by(Dispute.created_at.desc())
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

    return _serialize_detail(dispute, current_user)


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

    db.add(DisputeMessage(
        dispute_id=dispute.id,
        sender_id=current_user.id,
        message=body.message,
        attachment_url=getattr(body, 'attachment_url', None),
        attachment_name=getattr(body, 'attachment_name', None),
        attachment_size=getattr(body, 'attachment_size', None),
    ))
    if dispute.status == DisputeStatus.OPEN and current_user.id != dispute.raised_by:
        dispute.status = DisputeStatus.UNDER_REVIEW
    if current_user.role == UserRole.OFFICER and dispute.assigned_to != current_user.id:
        # A different officer than the original one replied — zone
        # coverage must have changed since. Keep assigned_to current so
        # it (and any notifications derived from it) reflect who's
        # actually handling this now.
        dispute.assigned_to = current_user.id
    await db.flush()

    notify_id = dispute.raised_by if current_user.id != dispute.raised_by else dispute.assigned_to
    if notify_id:
        await send_notification(
            db, user_id=notify_id, type=NotificationType.INFO,
            title="New reply on your dispute",
            body=f"{current_user.full_name} replied — tap to view.",
            related_entity_id=dispute.id,
        )

    dispute = await _load_dispute(db, dispute.id)
    return _serialize_detail(dispute, current_user)


@router.post("/{dispute_id}/claim", response_model=DisputeResponse)
async def claim_dispute(
    dispute_id: uuid.UUID,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Director claims an unclaimed (self-registered or escalated) dispute.
    Optimistic lock — same pattern as claim_withdrawal — prevents two
    directors claiming the same dispute at once."""
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

    dispute = await _load_dispute(db, dispute.id)
    return _serialize_dispute(dispute, director)


@router.post("/{dispute_id}/resolve", response_model=DisputeDetailResponse)
async def resolve_dispute(
    dispute_id: uuid.UUID,
    body: ResolveDisputeRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in (UserRole.OFFICER, UserRole.DIRECTOR, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="Access denied")

    dispute = await _load_dispute(db, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")

    if current_user.role == UserRole.OFFICER:
        if not _officer_has_zone_access(dispute, current_user):
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        # Directors resolve only what they've explicitly claimed —
        # unlike officers, directors aren't zone-scoped, so there's no
        # equivalent automatic-access rule for them.
        if dispute.assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    dispute.status              = DisputeStatus.RESOLVED
    dispute.resolution_summary  = body.resolution_summary
    dispute.resolved_at         = datetime.now(timezone.utc)
    # Record who actually resolved it — may be a different zone officer
    # than whoever it was originally routed to at creation, if coverage
    # changed in between. Keeps later notifications (see add_message)
    # routed to whoever's actually current, not a stale snapshot.
    dispute.assigned_to         = current_user.id
    db.add(DisputeMessage(dispute_id=dispute.id, sender_id=current_user.id, message=body.resolution_summary))
    await db.flush()

    await send_notification(
        db, user_id=dispute.raised_by, type=NotificationType.SUCCESS,
        title="Your dispute has been resolved",
        body="Tap to see the resolution.",
        related_entity_id=dispute.id,
    )

    dispute = await _load_dispute(db, dispute.id)
    return _serialize_detail(dispute, current_user)


@router.post("/{dispute_id}/escalate", response_model=DisputeResponse)
async def escalate_dispute(
    dispute_id: uuid.UUID,
    body: dict | None = None,
    current_user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """Customer or Service Worker escalates to Director.
    Customers can only escalate their own disputes.
    Workers can escalate disputes linked to their jobs.
    Director resolutions are final."""
    if body is None:
        body = {}
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    dispute = await _load_dispute(db, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")

    # Access check
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

    await _notify_all_directors(
        db, dispute, "Dispute escalated",
        f"{current_user.full_name} escalated a dispute — tap to review.",
    )

    dispute = await _load_dispute(db, dispute.id)
    return _serialize_dispute(dispute, current_user)


# ─── Manual Service Dispute ──────────────────────────────────────────────────

class CreateManualServiceDisputeRequest(BaseModel):
    service_request_id: uuid.UUID
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
    """
    from pydantic import BaseModel as _BaseModel

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

    # Check for existing open dispute on this service request
    existing = await db.scalar(
        select(Dispute).where(
            Dispute.service_request_id == body.service_request_id,
            Dispute.status != DisputeStatus.RESOLVED,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="There's already an open dispute for this service request.")

    # Route to the service worker who handled the job, or director if none
    assigned_worker_id = req.claimed_by_id
    assigned_to: uuid.UUID | None = assigned_worker_id  # workers use assigned_to column

    # Use a pseudo entity_type for display (wallet_transaction as fallback)
    dispute = Dispute(
        raised_by=          customer.id,
        entity_type=        DisputeEntityType.WALLET_TRANSACTION,  # placeholder; real context from service_request_id
        entity_id=          body.service_request_id,
        reason=             "other",
        status=             DisputeStatus.OPEN,
        assigned_to=        assigned_to,
        assigned_worker_id= assigned_worker_id,
        service_request_id= body.service_request_id,
        zone_id=            customer.zone_id,
    )
    db.add(dispute)
    await db.flush()

    db.add(DisputeMessage(
        dispute_id=dispute.id,
        sender_id=customer.id,
        message=body.message,
        attachment_url=body.attachment_url,
        attachment_name=body.attachment_name,
        attachment_size=body.attachment_size,
    ))
    await db.flush()

    # Notify the assigned worker
    if assigned_worker_id:
        await send_notification(
            db, user_id=assigned_worker_id, type=NotificationType.WARNING,
            title="Service dispute raised",
            body=f"{customer.full_name} has disputed a service you handled.",
            related_entity_id=dispute.id,
        )
    else:
        await _notify_all_directors(
            db, dispute, "Unassigned service dispute",
            f"{customer.full_name} raised a dispute on a service with no assigned worker.",
        )

    dispute = await _load_dispute(db, dispute.id)
    return _serialize_detail(dispute, customer)


# ─── Worker: view their disputes ─────────────────────────────────────────────

@router.get("/worker/mine")
async def list_worker_disputes(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Service Worker sees disputes assigned to them."""
    from app.models.user import UserRole
    if current_user.role != UserRole.SERVICE_WORKER:
        raise HTTPException(status_code=403, detail="Service Workers only")
    result = await db.execute(
        select(Dispute)
        .options(selectinload(Dispute.customer), selectinload(Dispute.handler))
        .where(Dispute.assigned_worker_id == current_user.id)
        .order_by(Dispute.created_at.desc())
    )
    return [_serialize_dispute(d, current_user) for d in result.scalars().all()]