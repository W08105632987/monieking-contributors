import uuid
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.notification import Notification, NotificationType
from app.models.user import User
from app.integrations.termii import send_sms

logger = logging.getLogger(__name__)


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

    # If the user has active SMS subscription, send real-time SMS alert
    try:
        user_res = await db.execute(select(User).where(User.id == user_id))
        user = user_res.scalar_one_or_none()
        if user and user.sms_alerts_enabled and user.phone_number:
            sms_text = f"MonieKing: {title} - {body}"
            await send_sms(user.phone_number, sms_text)
    except Exception as e:
        logger.warning("Failed to dispatch SMS notification for user %s: %s", user_id, e)

    return notif
