"""
Real push notifications via the standards-based Web Push API (VAPID) — no
Firebase/APNs account or paid service needed. The browser's own underlying
push service delivers the signed payload; we just sign it with our own key
pair.

Deliberately NOT a second, parallel "what should notify" system — this is
called from inside notification_service.send_notification() alongside the
existing SMS dispatch, using the exact same title/body, so every existing
notification trigger point across the app gets push for free without
needing to be touched individually.
"""
import asyncio
import json
import logging
import uuid

from pywebpush import webpush, WebPushException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)


def _send_one(subscription_info: dict, payload: str) -> None:
    """Synchronous — pywebpush is requests-based. Run via asyncio.to_thread
    so it never blocks the event loop."""
    webpush(
        subscription_info=subscription_info,
        data=payload,
        vapid_private_key=settings.VAPID_PRIVATE_KEY_PEM,
        vapid_claims={"sub": settings.VAPID_SUBJECT},
    )


async def send_push(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str,
    deep_link_url: str = "/",
    icon_url: str | None = None,
) -> None:
    """
    Best-effort — never raises. A push failure must never break the
    in-app notification it's riding alongside (same resilience pattern
    already used for the SMS dispatch in notification_service.py).
    """
    if not settings.VAPID_PRIVATE_KEY_PEM:
        # Not configured in this environment — silently skip rather than
        # error on every single notification. See backend/scripts/generate_vapid_keys.py.
        return

    rows = (await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    )).scalars().all()
    if not rows:
        return

    payload = json.dumps({
        "title": title,
        "body": body,
        "deep_link_url": deep_link_url,
        "icon": icon_url or "/icons/icon-192.png",
    })

    dead_subscription_ids: list[uuid.UUID] = []
    for sub in rows:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh_key, "auth": sub.auth_key},
        }
        try:
            await asyncio.to_thread(_send_one, subscription_info, payload)
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410):
                # Endpoint is dead — the browser unsubscribed or the
                # subscription expired. Prune it rather than retrying
                # forever on a push that can never succeed.
                dead_subscription_ids.append(sub.id)
            else:
                logger.warning("Push delivery failed for subscription %s: %s", sub.id, e)
        except Exception as e:
            logger.warning("Unexpected push error for subscription %s: %s", sub.id, e)

    if dead_subscription_ids:
        await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(dead_subscription_ids)))
        await db.flush()
