import uuid
from datetime import datetime, timezone
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class FundingFeeSettings(Base):
    """One row (id=1): do we charge customers a fee when they fund their wallet, and the price ranges."""
    __tablename__ = "funding_fee_settings"
    id:               Mapped[int]  = mapped_column(Integer, primary_key=True, default=1)
    charge_customers: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fee_label:        Mapped[str]  = mapped_column(String(40), default="NIPPS charge", nullable=False)   # what the customer sees on the fee line
    pass_monnify_fee: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)   # customer pays Monnify's actual charge and sees the remainder
    tiers:            Mapped[list] = mapped_column(JSONB, nullable=False)
    updated_by:       Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    updated_at:       Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class FundingRecord(Base):
    """One row per wallet funding: what came in, what the customer was charged, what Monnify charged us."""
    __tablename__ = "funding_records"
    id:                Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reference:         Mapped[str]       = mapped_column(String(200), unique=True, nullable=False)
    wallet_id:         Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("wallets.id", ondelete="SET NULL"))
    user_id:           Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    gross_kobo:        Mapped[int] = mapped_column(BigInteger, nullable=False)
    customer_fee_kobo: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    credited_kobo:     Mapped[int] = mapped_column(BigInteger, nullable=False)
    monnify_fee_kobo:  Mapped[int | None] = mapped_column(BigInteger)      # None = Monnify did not tell us
    created_at:        Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
