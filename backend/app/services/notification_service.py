import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.notification import Notification, NotificationType


async def send_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str,
    type: NotificationType = NotificationType.INFO,
    related_entity_id: uuid.UUID | None = None,
) -> Notification:
    notif = Notification(
        user_id=           user_id,
        title=             title,
        body=              body,
        type=              type,
        related_entity_id= related_entity_id,
    )
    db.add(notif)
    await db.flush()
    return notif
