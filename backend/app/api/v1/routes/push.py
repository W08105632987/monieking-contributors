import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.dependencies import CurrentUser
from app.core.config import settings
from app.models.push_subscription import PushSubscription
from app.services.push_service import push_is_configured, send_push

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """Public by design — this key is meant to be embedded in the frontend
    (it's the whole point of VAPID's public/private split)."""
    if not settings.VAPID_PUBLIC_KEY_B64:
        raise HTTPException(status_code=503, detail="Push notifications are not configured on this server")
    return {"public_key": settings.VAPID_PUBLIC_KEY_B64}


@router.get("/status")
async def push_status(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Lets the app (and you, when debugging) see what's actually true:
    is the server configured to send, and does the server have a record of
    this user's device(s)? The browser can say "subscribed" while the server
    has nothing, and that mismatch is invisible without this."""
    count = await db.scalar(
        select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == current_user.id)
    )
    return {"configured": push_is_configured(), "device_count": int(count or 0)}


@router.post("/test")
async def send_test_push(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Sends a real push to the caller's own devices so 'is it working?'
    has a one-click answer instead of waiting for a business event."""
    if not push_is_configured():
        raise HTTPException(status_code=503, detail="Push notifications are not configured on this server")
    delivered = await send_push(
        db, user_id=current_user.id,
        title="MonieKing test notification",
        body="Push notifications are working on this device.",
        deep_link_url="/",
    )
    if delivered == 0:
        raise HTTPException(
            status_code=409,
            detail="No device accepted the test push. Turn notifications off and on again in Settings, then retry.",
        )
    return {"delivered": delivered}


@router.post("/subscribe", status_code=201)
async def subscribe(body: dict, current_user: CurrentUser, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Body shape matches PushSubscriptionJSON from the browser's Push API:
    { endpoint, keys: { p256dh, auth } }
    """
    endpoint = body.get("endpoint")
    keys = body.get("keys") or {}
    p256dh = keys.get("p256dh")
    auth = keys.get("auth")
    if not endpoint or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="Invalid subscription payload")

    existing = (await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    )).scalar_one_or_none()

    if existing:
        # Re-subscribing with the same endpoint (e.g. after a token refresh) —
        # just reassign to the current user and refresh the keys/timestamp
        # rather than erroring on the unique constraint.
        existing.user_id = current_user.id
        existing.p256dh_key = p256dh
        existing.auth_key = auth
        existing.user_agent = request.headers.get("user-agent")
        existing.last_used_at = datetime.now(timezone.utc)
        await db.flush()
        return {"id": str(existing.id)}

    sub = PushSubscription(
        user_id=current_user.id,
        endpoint=endpoint,
        p256dh_key=p256dh,
        auth_key=auth,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(sub)
    await db.flush()
    return {"id": str(sub.id)}


@router.post("/unsubscribe")
async def unsubscribe(body: dict, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    endpoint = body.get("endpoint")
    if not endpoint:
        raise HTTPException(status_code=400, detail="endpoint is required")
    sub = (await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == endpoint,
            PushSubscription.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if sub:
        await db.delete(sub)
        await db.flush()
    return {"ok": True}


@router.get("/subscriptions")
async def list_subscriptions(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """So a user can see/manage which of their own devices have push
    enabled — e.g. in a notification-settings screen."""
    rows = (await db.execute(
        select(PushSubscription)
        .where(PushSubscription.user_id == current_user.id)
        .order_by(PushSubscription.created_at.desc())
    )).scalars().all()
    return [
        {
            "id": str(r.id),
            "user_agent": r.user_agent or "Unknown device",
            "created_at": r.created_at.isoformat(),
            "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
        }
        for r in rows
    ]


@router.delete("/subscriptions/{subscription_id}")
async def remove_subscription(subscription_id: uuid.UUID, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    sub = await db.get(PushSubscription, subscription_id)
    if not sub or sub.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Subscription not found")
    await db.delete(sub)
    await db.flush()
    return {"ok": True}
