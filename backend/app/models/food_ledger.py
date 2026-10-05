import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, BigInteger, Integer, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class FoodPackageItem(Base):
    """
    What's actually in a food package — director/admin-editable. Shared
    source of truth for the customer-facing rules modal AND the year-end
    cost-entry step (migration 042); previously hardcoded in the frontend.
    """
    __tablename__ = "food_package_items"

    id:            Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name:          Mapped[str]       = mapped_column(String(120), nullable=False)
    description:   Mapped[str | None] = mapped_column(Text)
    icon:          Mapped[str | None] = mapped_column(String(20))
    display_order: Mapped[int]       = mapped_column(Integer, default=0, nullable=False)
    is_active:     Mapped[bool]      = mapped_column(Boolean, default=True, nullable=False)
    created_at:    Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at:    Mapped[datetime]  = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class FoodCollectionYearArchive(Base):
    """
    One row per closed distribution year — a read-only, final financial
    record once created. See food_collections_ledger.py for the close
    workflow; nothing here is ever editable after insert.
    """
    __tablename__ = "food_collection_year_archives"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    year_label:  Mapped[str]       = mapped_column(String(10), unique=True, nullable=False)
    closed_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    closed_by:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    total_qualified:     Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_collected:     Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_not_collected: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    total_customer_contributions_kobo: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    adjustment_kobo: Mapped[int]      = mapped_column(BigInteger, default=0, nullable=False)
    adjustment_note: Mapped[str | None] = mapped_column(Text)

    total_cost_kobo: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    net_result_kobo: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    closed_by_user: Mapped["User"] = relationship("User", foreign_keys=[closed_by])
    cost_lines: Mapped[list["FoodCollectionYearArchiveCost"]] = relationship(
        "FoodCollectionYearArchiveCost", back_populates="archive", cascade="all, delete-orphan",
    )


class FoodCollectionYearArchiveCost(Base):
    """
    Per-item unit cost as entered at close time — snapshotted so a later
    change to the live FoodPackageItem's description/price never alters
    a historical year's already-closed financial record.
    """
    __tablename__ = "food_collection_year_archive_costs"

    id:                 Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    archive_id:         Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("food_collection_year_archives.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    item_id:            Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("food_package_items.id", ondelete="SET NULL"), nullable=True,
    )
    item_name_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    unit_cost_kobo:     Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    created_at:         Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    archive: Mapped["FoodCollectionYearArchive"] = relationship("FoodCollectionYearArchive", back_populates="cost_lines")
