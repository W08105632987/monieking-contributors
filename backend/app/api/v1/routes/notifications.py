"""Notification and broadcast routes."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOrAdmin
from app.models.notification import Notification, Broadcast, NotificationType
from app.models.user import User, UserRole
from app.schemas.notification import BroadcastRequest

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/unread-count")
async def get_unread_count(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Cheap endpoint for background polling — just a number, not the full list."""
    result = await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
        )
    )
    return {"unread_count": result.scalar_one()}


@router.get("", response_model=list[dict])
async def get_my_notifications(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    page_size: int = 30,
):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return [
        {
            "id":               str(n.id),
            "title":            n.title,
            "body":             n.body,
            "type":             n.type.value,
            "is_read":          n.is_read,
            "related_entity_id":str(n.related_entity_id) if n.related_entity_id else None,
            "created_at":       n.created_at.isoformat(),
        }
        for n in result.scalars().all()
    ]


@router.patch("/{notification_id}/read", status_code=200)
async def mark_notification_read(
    notification_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    await db.flush()
    return {"message": "Marked as read"}


@router.patch("/mark-all-read", status_code=200)
async def mark_all_read(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.is_read == False)
        .values(is_read=True)
    )
    return {"message": "All notifications marked as read"}


@router.post("/broadcasts", status_code=201)
async def send_broadcast(
    body: BroadcastRequest,
    staff: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Admin or Director sends a broadcast to all or targeted users."""
    title        = body.title
    message_body = body.body
    target_roles = body.target_roles
    zone_id      = body.zone_id

    broadcast = Broadcast(
        sent_by=       staff.id,
        title=         title,
        body=          message_body,
        target_roles=  target_roles,
        target_zone_id=zone_id,
    )
    db.add(broadcast)
    await db.flush()

    # Fan-out: create individual notification records for target users
    query = select(User).where(User.status == "active")
    if target_roles != "all":
        roles = [r.strip() for r in target_roles.split(",")]
        query = query.where(User.role.in_(roles))
    if zone_id:
        query = query.where(User.zone_id == zone_id)

    result = await db.execute(query)
    users  = result.scalars().all()

    for user in users:
        notif = Notification(
            user_id= user.id,
            title=   title,
            body=    message_body,
            type=    NotificationType.BROADCAST,
            related_entity_id= broadcast.id,
        )
        db.add(notif)

    await db.flush()
    return {"message": f"Broadcast sent to {len(users)} user(s)", "broadcast_id": str(broadcast.id)}
