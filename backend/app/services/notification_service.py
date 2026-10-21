import uuid
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.notification import Notification, NotificationType
from app.models.user import User
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
        link=              deep_link_url if deep_link_url and deep_link_url != "/" else None,
    )
    db.add(notif)
    await db.flush()

    # NOTE: no SMS here any more. SMS goes out only when a card is marked, or when a
    # director sends one (see app/services/sms_service.py).

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
