import uuid
import enum
from datetime import datetime, date, timezone
from sqlalchemy import String, Text, BigInteger, Boolean, ForeignKey, DateTime, Date, Enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class PendingRateChangeStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    CANCELLED = "cancelled"
    APPLIED   = "applied"


class SystemConfig(Base):
    """
    Key/value business settings, director-editable.
    Table already existed in the schema (001_initial_schema.sql) but was
    never wired to the app until now.
    """
    __tablename__ = "system_config"

    key:         Mapped[str]      = mapped_column(String(100), primary_key=True)
    value:       Mapped[str]      = mapped_column(Text, nullable=False)
    description: Mapped[str|None] = mapped_column(Text, nullable=True)
    updated_by:  Mapped[uuid.UUID|None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class PendingRateChange(Base):
    """
    The deferred-pricing mechanic: a rate change requested at any point
    during the year always takes effect on Jan 1 of the following year.
    Only one 'scheduled' row per setting_key at a time (enforced by a
    partial unique index in the migration).
    """
    __tablename__ = "pending_rate_changes"

    id:                 Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    setting_key:        Mapped[str]       = mapped_column(String(100), ForeignKey("system_config.key"), nullable=False)
    current_value_kobo: Mapped[int]       = mapped_column(BigInteger, nullable=False)
    new_value_kobo:     Mapped[int]       = mapped_column(BigInteger, nullable=False)
    effective_date:     Mapped[date]      = mapped_column(Date, nullable=False)
    status:             Mapped[PendingRateChangeStatus] = mapped_column(
        Enum(PendingRateChangeStatus, name="pending_rate_change_status", values_callable=lambda x: [e.value for e in x]),
        default=PendingRateChangeStatus.SCHEDULED,
    )
    created_by:   Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at:   Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    cancelled_by: Mapped[uuid.UUID|None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    cancelled_at: Mapped[datetime|None]  = mapped_column(DateTime(timezone=True), nullable=True)
    notified_at:  Mapped[datetime|None]  = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at:   Mapped[datetime|None]  = mapped_column(DateTime(timezone=True), nullable=True)
