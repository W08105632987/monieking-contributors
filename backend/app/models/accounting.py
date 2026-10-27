import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now():
    return datetime.now(timezone.utc)


class CostRate(Base):
    """What an outside provider charges us. Never edited: a new price is a new row, so old periods keep the price that applied then."""
    __tablename__ = "cost_rates"
    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rate_key:       Mapped[str]       = mapped_column(String(120), nullable=False)
    mode:           Mapped[str]       = mapped_column(String(10), default="flat", nullable=False)   # flat (naira per event) | percent
    value:          Mapped[Decimal]   = mapped_column(Numeric(14, 2), default=0, nullable=False)
    cap_kobo:       Mapped[int | None] = mapped_column(BigInteger)
    effective_from: Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    note:           Mapped[str | None] = mapped_column(String(300))
    created_by:     Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at:     Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class Expense(Base):
    __tablename__ = "expenses"
    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    spent_on:    Mapped[date]      = mapped_column(Date, nullable=False)
    category:    Mapped[str]       = mapped_column(String(60), nullable=False)
    description: Mapped[str]       = mapped_column(String(300), nullable=False)
    amount_kobo: Mapped[int]       = mapped_column(BigInteger, nullable=False)
    created_by:  Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class ProviderUsage(Base):
    __tablename__ = "provider_usage"
    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rate_key:   Mapped[str]       = mapped_column(String(120), nullable=False)
    quantity:   Mapped[int]       = mapped_column(Integer, default=1, nullable=False)
    ok:         Mapped[bool]      = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class AccountingSettings(Base):
    __tablename__ = "accounting_settings"
    id:          Mapped[int]      = mapped_column(Integer, primary_key=True, default=1)
    buffer_days: Mapped[int]      = mapped_column(Integer, default=14, nullable=False)
    updated_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
