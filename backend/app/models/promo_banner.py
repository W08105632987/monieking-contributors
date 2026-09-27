import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, Boolean, ForeignKey, DateTime, Enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class PromoBannerLinkType(str, enum.Enum):
    NONE            = "none"
    INTERNAL_ROUTE  = "internal_route"
    EXTERNAL_URL    = "external_url"


class PromoBanner(Base):
    """
    OPay-style dashboard carousel banner. v1 is styled text + gradient
    (with a shimmer sweep on the frontend), not image upload.
    """
    __tablename__ = "promo_banners"

    id:            Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title:         Mapped[str]       = mapped_column(String(200), nullable=False)
    subtitle:      Mapped[str|None]  = mapped_column(String(300), nullable=True)
    gradient_from: Mapped[str]       = mapped_column(String(7), default="#052E16")
    gradient_to:   Mapped[str]       = mapped_column(String(7), default="#D97706")
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
