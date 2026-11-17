"""Airtime to Cash requests. See 072_airtime_to_cash.sql. The SIM PIN and OTP are never stored."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AirtimeCashRequest(Base):
    __tablename__ = "airtime_cash_requests"

    id:                   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    network:              Mapped[str] = mapped_column(String(12), nullable=False)
    phone:                Mapped[str] = mapped_column(String(20), nullable=False)
    amount_kobo:          Mapped[int] = mapped_column(BigInteger, nullable=False)
    provider_credit_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    payout_kobo:          Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    fee_kobo:             Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    status:               Mapped[str] = mapped_column(String(16), nullable=False, default="started")
    provider_identifier:  Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider_session:     Mapped[str | None] = mapped_column(String(160), nullable=True)
    provider_reference:   Mapped[str | None] = mapped_column(String(120), nullable=True)
    failure_reason:       Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by:          Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at:           Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at:         Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
