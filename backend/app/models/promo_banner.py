import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, Float, Boolean, ForeignKey, DateTime, Enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class PromoBannerLinkType(str, enum.Enum):
    NONE            = "none"
    INTERNAL_ROUTE  = "internal_route"
    EXTERNAL_URL    = "external_url"


class PromoBannerLayoutStyle(str, enum.Enum):
    GRADIENT_ONLY     = "gradient_only"
    FULL_BLEED_IMAGE  = "full_bleed_image"
    SPLIT_IMAGE_TEXT  = "split_image_text"


class PromoBanner(Base):
    """
    OPay-style dashboard carousel banner. Supports gradient-only, full-bleed
    image, and split image+text layouts with focal-point centering.
    """
    __tablename__ = "promo_banners"

    id:            Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title:         Mapped[str]       = mapped_column(String(200), nullable=False)
    subtitle:      Mapped[str|None]  = mapped_column(String(300), nullable=True)
    gradient_from: Mapped[str]       = mapped_column(String(7), default="#052E16")
    gradient_to:   Mapped[str]       = mapped_column(String(7), default="#D97706")
    layout_style:  Mapped[PromoBannerLayoutStyle] = mapped_column(
        Enum(PromoBannerLayoutStyle, name="promo_banner_layout_style", values_callable=lambda x: [e.value for e in x]),
        default=PromoBannerLayoutStyle.GRADIENT_ONLY,
        server_default="gradient_only",
    )
    image_url:     Mapped[str|None]  = mapped_column(Text, nullable=True)
    image_focal_x: Mapped[float]     = mapped_column(Float, default=0.5, server_default="0.5")
    image_focal_y: Mapped[float]     = mapped_column(Float, default=0.5, server_default="0.5")
    link_type:     Mapped[PromoBannerLinkType] = mapped_column(
        Enum(PromoBannerLinkType, name="promo_banner_link_type", values_callable=lambda x: [e.value for e in x]),
        default=PromoBannerLinkType.NONE,
    )
    link_target:   Mapped[str|None]  = mapped_column(Text, nullable=True)
    display_order: Mapped[int]       = mapped_column(Integer, default=0)
    is_active:     Mapped[bool]      = mapped_column(Boolean, default=True)
    start_at:      Mapped[datetime|None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at:        Mapped[datetime|None] = mapped_column(DateTime(timezone=True), nullable=True)
    target_roles:  Mapped[str]       = mapped_column(String(200), default="all")
    created_by:    Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at:    Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    impressions:   Mapped[int]       = mapped_column(Integer, default=0, server_default="0")
    clicks:        Mapped[int]       = mapped_column(Integer, default=0, server_default="0")


class PromoBannerEvent(Base):
    """
    Append-only tracking table for promo banner impressions and clicks.
    Avoids hot-row UPDATE contention and dead tuples on promo_banners.
    """
    __tablename__ = "promo_banner_events"

    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    banner_id:  Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("promo_banners.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str]       = mapped_column(String(20), nullable=False)  # 'impression' | 'click'
    user_id:    Mapped[uuid.UUID|None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

