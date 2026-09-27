import base64
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly
from app.models.promo_banner import PromoBanner, PromoBannerLayoutStyle
from app.schemas.promo_banner import (
    BannerImageUploadRequest,
    PromoBannerCreate,
    PromoBannerUpdate,
    PromoBannerResponse,
    validate_promo_link,
    validate_promo_layout,
)
from app.utils.audit import log_action
from app.utils.supabase_admin_client import supabase_admin_request

router = APIRouter(prefix="/promo-banners", tags=["promo-banners"])

# 5MB cap: promo banners are wide hero cards, so 5MB allows high visual fidelity
# while keeping upload sizes bounded for mobile data networks.
MAX_BANNER_IMAGE_BYTES = 5 * 1024 * 1024


async def validate_and_upload_banner_image(data_url: str) -> str:
    """
    Validates base64 image data via file signature (magic bytes) server-side,
    enforces a 5MB size cap, and uploads to the 'promo-banners' Supabase storage bucket.
    Returns the public image URL.
    """
    if not data_url or "base64," not in data_url:
        raise HTTPException(status_code=400, detail="No image provided")

    header, encoded = data_url.split("base64,", 1)
    try:
        image_bytes = base64.b64decode(encoded)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    if len(image_bytes) > MAX_BANNER_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image too large — please use an image under 5MB")

    # Real server-side magic bytes / file signature validation (do not trust client MIME type)
    if image_bytes.startswith(b"\xff\xd8\xff"):
        ext = "jpg"
        content_type = "image/jpeg"
    elif image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        ext = "png"
        content_type = "image/png"
    elif len(image_bytes) >= 12 and image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        ext = "webp"
        content_type = "image/webp"
    else:
        raise HTTPException(
            status_code=400,
            detail="Invalid image format. Only real JPEG, PNG, and WebP images are allowed.",
        )

    filename = f"{uuid.uuid4()}.{ext}"
    await supabase_admin_request(
        "POST",
        f"/storage/v1/object/promo-banners/{filename}",
        content=image_bytes,
        extra_headers={"Content-Type": content_type, "x-upsert": "true"},
        failure_detail="Could not upload banner image — please try again",
    )

    return f"{settings.SUPABASE_URL}/storage/v1/object/public/promo-banners/{filename}"


@router.post("/upload-image", response_model=dict, status_code=200)
async def upload_banner_image(
    body: BannerImageUploadRequest,
    director: DirectorOnly,
):
    """Director-only standalone image upload endpoint returning the hosted public image URL."""
    image_url = await validate_and_upload_banner_image(body.image_base64)
    return {"image_url": image_url}


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
    image_url = body.image_url
    if body.image_base64:
        image_url = await validate_and_upload_banner_image(body.image_base64)

    # Validate link and layout rules
    try:
        validated_target = validate_promo_link(body.link_type, body.link_target)
        validate_promo_layout(body.layout_style, image_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    banner_data = body.model_dump(exclude={"image_base64"})
    banner_data["image_url"] = image_url
    banner_data["link_target"] = validated_target

    banner = PromoBanner(**banner_data, created_by=director.id)
    db.add(banner)
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="promo_banner.created",
        entity_type="promo_banner", entity_id=str(banner.id),
        new_value={"title": body.title, "layout_style": body.layout_style},
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

    update_dict = body.model_dump(exclude_unset=True, exclude={"image_base64"})

    # Handle image upload if provided as base64
    if body.image_base64:
        uploaded_url = await validate_and_upload_banner_image(body.image_base64)
        update_dict["image_url"] = uploaded_url

    # Check resulting link combination
    current_link_type = banner.link_type.value if hasattr(banner.link_type, "value") else str(banner.link_type)
    effective_link_type = update_dict.get("link_type", current_link_type)
    effective_link_target = update_dict.get("link_target", banner.link_target)

    if "link_type" in update_dict or "link_target" in update_dict:
        try:
            update_dict["link_target"] = validate_promo_link(effective_link_type, effective_link_target)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Check resulting layout style and image
    current_layout = banner.layout_style.value if hasattr(banner.layout_style, "value") else str(banner.layout_style)
    effective_layout = update_dict.get("layout_style", current_layout)
    effective_image = update_dict.get("image_url", banner.image_url)

    # If image_url was explicitly set to null/empty without changing layout_style,
    # auto-fallback to gradient_only to prevent broken rendering
    if "image_url" in update_dict and not update_dict["image_url"]:
        update_dict["image_url"] = None
        effective_image = None
        if "layout_style" not in update_dict:
            effective_layout = "gradient_only"
            update_dict["layout_style"] = "gradient_only"

    try:
        validate_promo_layout(effective_layout, effective_image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    for field, value in update_dict.items():
        setattr(banner, field, value)
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="promo_banner.updated",
        entity_type="promo_banner", entity_id=str(banner.id),
    )
    return banner


@router.post("/{banner_id}/image", response_model=PromoBannerResponse)
async def update_banner_image(
    banner_id: uuid.UUID,
    body: BannerImageUploadRequest,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    """Uploads or replaces an existing banner's image."""
    result = await db.execute(select(PromoBanner).where(PromoBanner.id == banner_id))
    banner = result.scalar_one_or_none()
    if not banner:
        raise HTTPException(status_code=404, detail="Promo banner not found")

    image_url = await validate_and_upload_banner_image(body.image_base64)
    banner.image_url = image_url
    await db.flush()

    await log_action(
        db, actor_id=director.id, action="promo_banner.image_uploaded",
        entity_type="promo_banner", entity_id=str(banner.id),
    )
    return banner


@router.delete("/{banner_id}/image", response_model=PromoBannerResponse)
async def remove_banner_image(
    banner_id: uuid.UUID,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    """
    Removes an image from a banner.
    If the banner was using an image layout (full bleed or split image),
    automatically falls back the layout_style to 'gradient_only'.
    """
    result = await db.execute(select(PromoBanner).where(PromoBanner.id == banner_id))
    banner = result.scalar_one_or_none()
    if not banner:
        raise HTTPException(status_code=404, detail="Promo banner not found")

    banner.image_url = None
    if banner.layout_style != PromoBannerLayoutStyle.GRADIENT_ONLY:
        banner.layout_style = PromoBannerLayoutStyle.GRADIENT_ONLY

    await db.flush()

    await log_action(
        db, actor_id=director.id, action="promo_banner.image_removed",
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
