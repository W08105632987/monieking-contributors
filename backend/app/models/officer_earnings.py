"""Commission earned by affiliated officers, and their payout requests. See 066_affiliated_officers.sql."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class OfficerCommission(Base):
    __tablename__ = "officer_commissions"

    id:                  Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    officer_id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    customer_id:         Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    withdrawal_id:       Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("withdrawals.id", ondelete="CASCADE"), nullable=False, unique=True)
    company_charge_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    percent:             Mapped[int] = mapped_column(SmallInteger, nullable=False)
    amount_kobo:         Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at:          Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class OfficerPayout(Base):
    __tablename__ = "officer_payouts"

    id:               Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    officer_id:       Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    amount_kobo:      Mapped[int] = mapped_column(BigInteger, nullable=False)
    bank_name:        Mapped[str] = mapped_column(String(100), nullable=False)
    account_number:   Mapped[str] = mapped_column(String(20), nullable=False)
    account_name:     Mapped[str] = mapped_column(String(200), nullable=False)
    status:           Mapped[str] = mapped_column(String(10), nullable=False, default="pending")   # pending | paid | rejected
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    processed_by:     Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    requested_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    processed_at:     Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
