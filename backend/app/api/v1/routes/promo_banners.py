import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly
from app.models.promo_banner import PromoBanner
from app.schemas.promo_banner import PromoBannerCreate, PromoBannerUpdate, PromoBannerResponse
from app.utils.audit import log_action

router = APIRouter(prefix="/promo-banners", tags=["promo-banners"])


@router.get("/active", response_model=list[PromoBannerResponse])
async def get_active_banners(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """What the dashboard carousel fetches — active, in-date-range, audience-matching banners."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PromoBanner)
        .where(PromoBanner.is_active == True)  # noqa: E712
        .order_by(PromoBanner.display_order.asc())
    )
    candidates = result.scalars().all()

    role = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    out = []
    for b in candidates:
        if b.start_at and b.start_at > now:
            continue
        if b.end_at and b.end_at < now:
            continue
        targets = [t.strip() for t in b.target_roles.split(",")]
        if b.target_roles == "all" or role in targets:
            out.append(b)
    return out


@router.get("", response_model=list[PromoBannerResponse])
async def list_banners(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PromoBanner).order_by(PromoBanner.display_order.asc()))
    return result.scalars().all()


@router.post("", response_model=PromoBannerResponse, status_code=201)
async def create_banner(
    body: PromoBannerCreate,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    banner = PromoBanner(**body.model_dump(), created_by=director.id)
    db.add(banner)
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="promo_banner.created",
        entity_type="promo_banner", entity_id=str(banner.id),
        new_value={"title": body.title},
    )
    return banner


@router.patch("/{banner_id}", response_model=PromoBannerResponse)
async def update_banner(
    banner_id: uuid.UUID,
    body: PromoBannerUpdate,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PromoBanner).where(PromoBanner.id == banner_id))
    banner = result.scalar_one_or_none()
    if not banner:
        raise HTTPException(status_code=404, detail="Promo banner not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(banner, field, value)
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="promo_banner.updated",
        entity_type="promo_banner", entity_id=str(banner.id),
    )
    return banner


@router.post("/{banner_id}/archive", status_code=200)
async def archive_banner(
    banner_id: uuid.UUID,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete: marks is_active=False instead of hard-deleting, preserving analytics history."""
    result = await db.execute(select(PromoBanner).where(PromoBanner.id == banner_id))
    banner = result.scalar_one_or_none()
    if not banner:
        raise HTTPException(status_code=404, detail="Promo banner not found")

    banner.is_active = False
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="promo_banner.archived",
        entity_type="promo_banner", entity_id=str(banner_id),
    )
    return {"message": "Promo banner archived"}


@router.post("/{banner_id}/impression", status_code=204)
async def track_banner_impression(
    banner_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Records an impression (carousel render) on a promo banner."""
    await db.execute(
        update(PromoBanner)
        .where(PromoBanner.id == banner_id)
        .values(impressions=PromoBanner.impressions + 1)
    )
    await db.flush()


@router.post("/{banner_id}/click", status_code=204)
async def track_banner_click(
    banner_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Records a click/tap event on a banner."""
    await db.execute(
        update(PromoBanner)
        .where(PromoBanner.id == banner_id)
        .values(clicks=PromoBanner.clicks + 1)
    )
    await db.flush()


@router.delete("/{banner_id}", status_code=200)
async def delete_banner(
    banner_id: uuid.UUID,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PromoBanner).where(PromoBanner.id == banner_id))
    banner = result.scalar_one_or_none()
    if not banner:
        raise HTTPException(status_code=404, detail="Promo banner not found")

    await db.delete(banner)
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="promo_banner.deleted",
        entity_type="promo_banner", entity_id=str(banner_id),
    )
    return {"message": "Promo banner deleted"}
