from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly
from app.models.instant_message import InstantMessage
from app.schemas.instant_message import InstantMessageCreate, InstantMessageResponse
from app.utils.audit import log_action

router = APIRouter(prefix="/instant-messages", tags=["instant-messages"])


@router.get("/active", response_model=InstantMessageResponse | None)
async def get_active_message(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """
    What every role's ticker bar polls. Returns the single active,
    non-expired message that targets this user's role (or 'all'), or
    null if nothing is currently active for them.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(InstantMessage)
        .where(InstantMessage.is_active == True)  # noqa: E712
        .order_by(InstantMessage.created_at.desc())
    )
    candidates = result.scalars().all()

    role = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    for msg in candidates:
        if msg.expires_at and msg.expires_at < now:
            continue
        targets = [t.strip() for t in msg.target_roles.split(",")]
        if msg.target_roles == "all" or role in targets:
            return msg
    return None


@router.get("", response_model=list[InstantMessageResponse])
async def list_messages(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InstantMessage).order_by(InstantMessage.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=InstantMessageResponse, status_code=201)
async def create_message(
    body: InstantMessageCreate,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    # Activating a new message deactivates only PREVIOUS active messages
    # whose audience actually overlaps with this one's — not everything.
    # (Previously this unconditionally deactivated every active message
    # regardless of audience, so an officer-only urgent message would
    # silently kill an unrelated customer-only message still meant to be
    # showing — the comment always claimed "overlapping audience" but the
    # code never actually checked that.)
    new_targets = {t.strip() for t in body.target_roles.split(",")}
    active_result = await db.execute(
        select(InstantMessage).where(InstantMessage.is_active == True)  # noqa: E712
    )
    for existing in active_result.scalars().all():
        existing_targets = {t.strip() for t in existing.target_roles.split(",")}
        overlaps = (
            "all" in new_targets or "all" in existing_targets
            or bool(new_targets & existing_targets)
        )
        if overlaps:
            existing.is_active = False

    msg = InstantMessage(
        message=      body.message,
        priority=     body.priority,
        target_roles= body.target_roles,
        expires_at=   body.expires_at,
        created_by=   director.id,
    )
    db.add(msg)
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="instant_message.created",
        entity_type="instant_message", entity_id=str(msg.id),
        new_value={"message": body.message, "priority": body.priority},
    )
    return msg


@router.patch("/{message_id}/deactivate", response_model=InstantMessageResponse)
async def deactivate_message(
    message_id: str,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(InstantMessage).where(InstantMessage.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Instant message not found")

    msg.is_active = False
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="instant_message.deactivated",
        entity_type="instant_message", entity_id=str(msg.id),
    )
    return msg
