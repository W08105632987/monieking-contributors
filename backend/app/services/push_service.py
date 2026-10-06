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
from functools import lru_cache
from types import SimpleNamespace

from py_vapid import Vapid
from pywebpush import webpush, WebPushException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)

# A push service that is slow or unreachable must not hold a customer's
# request open. pywebpush's own default is NO timeout at all.
PUSH_TIMEOUT_SECONDS = 10
# How long the browser's push service may hold a message for a device that
# is offline (phone off / no signal). pywebpush's default is 0, which means
# "drop it if the device isn't reachable right this second".
PUSH_TTL_SECONDS = 24 * 60 * 60


def _normalise_pem(raw: str) -> str:
    """Env-var UIs often store a multi-line PEM as one line with literal
    backslash-n, or wrap it in quotes. Accept those so a correct key that was
    pasted slightly differently still works."""
    pem = (raw or "").strip().strip('"').strip("'")
    return pem.replace("\\n", "\n").strip()


@lru_cache(maxsize=4)
def _load_vapid(pem: str) -> Vapid:
    # webpush() accepts a Vapid object or a raw base64 key. It does NOT accept
    # a PEM string (-> "Could not deserialize key data"), which is what the
    # previous code handed it, so no push was ever actually sent.
    return Vapid.from_pem(pem.encode())


def push_is_configured() -> bool:
    return bool(settings.VAPID_PRIVATE_KEY_PEM and settings.VAPID_PUBLIC_KEY_B64)


def _send_one(subscription_info: dict, payload: str) -> None:
    """Synchronous — pywebpush is requests-based. Run via asyncio.to_thread
    so it never blocks the event loop."""
    webpush(
        subscription_info=subscription_info,
        data=payload,
        vapid_private_key=_load_vapid(_normalise_pem(settings.VAPID_PRIVATE_KEY_PEM)),
        vapid_claims={"sub": settings.VAPID_SUBJECT},
        ttl=PUSH_TTL_SECONDS,
        timeout=PUSH_TIMEOUT_SECONDS,
        headers={"Urgency": "high"},
    )


async def _deliver(sub, payload: str) -> tuple[uuid.UUID, str]:
    """Returns (subscription_id, outcome) where outcome is 'ok', 'dead' or 'failed'."""
    subscription_info = {
        "endpoint": sub.endpoint,
        "keys": {"p256dh": sub.p256dh_key, "auth": sub.auth_key},
    }
    try:
        await asyncio.to_thread(_send_one, subscription_info, payload)
        return sub.id, "ok"
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            # Endpoint is dead — the browser unsubscribed or the
            # subscription expired. Prune it rather than retrying
            # forever on a push that can never succeed.
            return sub.id, "dead"
        logger.warning("Push delivery failed for subscription %s (HTTP %s): %s", sub.id, status, e)
        return sub.id, "failed"
    except Exception as e:
        logger.warning("Unexpected push error for subscription %s: %s: %s", sub.id, type(e).__name__, e)
        return sub.id, "failed"


async def send_push(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str,
    deep_link_url: str = "/",
    icon_url: str | None = None,
) -> int:
    """
    Best-effort — never raises. A push failure must never break the
    in-app notification it's riding alongside (same resilience pattern
    already used for the SMS dispatch in notification_service.py).

    Returns the number of devices the push service accepted.
    """
    if not push_is_configured():
        # Not configured in this environment — skip rather than error on
        # every single notification. See backend/scripts/generate_vapid_keys.py.
        return 0

    # The subscription lookup/prune runs inside a SAVEPOINT. On Postgres a
    # failed statement (for example the push_subscriptions table not existing
    # yet because migration 043 hasn't been run) aborts the WHOLE transaction,
    # and the caller's except-and-continue would then COMMIT as a silent
    # rollback, losing the in-app notification and every business write made
    # earlier in the same request. A savepoint confines the damage to this
    # optional side effect.
    try:
        async with db.begin_nested():
            rows = (await db.execute(
                select(PushSubscription).where(PushSubscription.user_id == user_id)
            )).scalars().all()
            # Detach plain data so the network calls below don't touch the session.
            subs = [
                SimpleNamespace(id=r.id, endpoint=r.endpoint, p256dh_key=r.p256dh_key, auth_key=r.auth_key)
                for r in rows
            ]
    except Exception as e:
        logger.error("Push skipped for user %s — could not read push_subscriptions "
                     "(is migration 043 applied?): %s", user_id, e)
        return 0
    if not subs:
        return 0

    payload = json.dumps({
        "title": title,
        "body": body,
        "deep_link_url": deep_link_url,
        "icon": icon_url or "/icons/icon-192.png",
    })

    results = await asyncio.gather(*(_deliver(s, payload) for s in subs))
    delivered = sum(1 for _, o in results if o == "ok")
    dead_ids = [sid for sid, o in results if o == "dead"]
    logger.info("Push for user %s: %d/%d device(s) accepted, %d expired",
                user_id, delivered, len(subs), len(dead_ids))

    if dead_ids:
        try:
            async with db.begin_nested():
                await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(dead_ids)))
        except Exception as e:
            logger.warning("Could not prune expired push subscriptions %s: %s", dead_ids, e)
    return delivered
