import uuid
from datetime import datetime, date, timezone
from sqlalchemy import String, BigInteger, Integer, ForeignKey, DateTime, Date, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class OfflineImportBatch(Base):
    """One Excel upload (or single add) of customers who already have offline records."""
    __tablename__ = "offline_import_batches"

    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    source:     Mapped[str]       = mapped_column(String, nullable=False, default="excel")
    filename:   Mapped[str | None] = mapped_column(String, nullable=True)
    row_count:  Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    undone_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PendingOfflineCustomer(Base):
    """An offline customer waiting for their app account. Linked by phone number at sign-up."""
    __tablename__ = "pending_offline_customers"

    id:       Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("offline_import_batches.id", ondelete="CASCADE"), nullable=True)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False)
    full_name:    Mapped[str] = mapped_column(String(200), nullable=False)
    zone_id:      Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id"), nullable=False)
    card_type:    Mapped[str] = mapped_column(String(20), nullable=False, default="regular")
    rate_kobo:    Mapped[int] = mapped_column(BigInteger, nullable=False)
    days_contributed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    days_withdrawn:   Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    withdrawn_kobo:   Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    start_date:   Mapped[date | None] = mapped_column(Date, nullable=True)
    handled_by:   Mapped[str] = mapped_column(String(20), nullable=False, default="self")   # 'self' | 'officer'
    notes:        Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    claimed_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    claimed_at:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at:   Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
