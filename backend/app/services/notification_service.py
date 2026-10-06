import uuid
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.notification import Notification, NotificationType
from app.models.user import User
from app.integrations.termii import send_sms
from app.services.push_service import send_push

logger = logging.getLogger(__name__)


async def send_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str,
    type: NotificationType = NotificationType.INFO,
    related_entity_id: uuid.UUID | None = None,
    deep_link_url: str = "/",
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

    # Push rides the same trigger — every existing call site that creates
    # an in-app notification gets a real OS-level push for free, no need
    # to touch each one individually. deep_link_url defaults to the app
    # home screen for callers that haven't been updated to pass a specific
    # page yet; pass one explicitly wherever it's easy to (see food_ledger.py's
    # ping endpoint for an example once that's updated, or any new caller).
    try:
        await send_push(
            db, user_id=user_id, title=title, body=body, deep_link_url=deep_link_url,
        )
    except Exception as e:
        logger.warning("Failed to dispatch push notification for user %s: %s", user_id, e)

    return notif
