import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, BigInteger, Integer, ForeignKey, DateTime, Enum, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class EntitlementStatus(str, enum.Enum):
    ACTIVE    = "active"      # Qualified, ready for pickup on Dec 10
    USED      = "used"        # Successfully collected
    REVOKED   = "revoked"     # Cancelled by Director/Admin
    EXPIRED   = "expired"     # Never collected past distribution window


class FoodCollectionPoint(Base):
    __tablename__ = "food_collection_points"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name:        Mapped[str]       = mapped_column(String(120), nullable=False)
    address:     Mapped[str]       = mapped_column(Text, nullable=False)
    zone_id:     Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active:   Mapped[bool]      = mapped_column(Boolean, default=True, nullable=False)
    created_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class FoodEntitlement(Base):
    __tablename__ = "food_entitlements"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    card_id:     Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("contribution_cards.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Cryptographically random token encoded in the QR code (e.g. MKF_xxxxxx)
    qr_token:    Mapped[str]       = mapped_column(String(64), unique=True, nullable=False, index=True)

    # 4-digit collection PIN known only to the customer (stored hashed or plain 4-digit for collection validation)
    collection_pin: Mapped[str]    = mapped_column(String(10), nullable=False)

    package_name:   Mapped[str]    = mapped_column(String(120), default="Standard Holiday Food Package", nullable=False)
    year:           Mapped[int]    = mapped_column(Integer, nullable=False)
    status:         Mapped[EntitlementStatus] = mapped_column(
        Enum(EntitlementStatus, name="food_entitlement_status", values_callable=lambda x: [e.value for e in x]),
        default=EntitlementStatus.ACTIVE,
        nullable=False,
        index=True
    )

    failed_attempts: Mapped[int]   = mapped_column(Integer, default=0, nullable=False)
    collection_point_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("food_collection_points.id", ondelete="SET NULL"), nullable=True)

    collected_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    collected_by:  Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    created_at:    Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    card:          Mapped["ContributionCard"] = relationship("ContributionCard")
    customer:      Mapped["User"]             = relationship("User", foreign_keys=[customer_id])


class FoodCollectionAudit(Base):
    __tablename__ = "food_collection_audits"

    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    audit_code:     Mapped[str]       = mapped_column(String(32), unique=True, nullable=False, index=True) # e.g. FC-2026-XXXX
    entitlement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("food_entitlements.id"), nullable=False, index=True)
    officer_id:     Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    action:         Mapped[str]       = mapped_column(String(50), nullable=False) # "SCANNED", "CONFIRMED", "PIN_FAILED", "REVOKED"
    ip_address:     Mapped[str | None]= mapped_column(String(50), nullable=True)
    notes:          Mapped[str | None]= mapped_column(Text, nullable=True)
    created_at:     Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
