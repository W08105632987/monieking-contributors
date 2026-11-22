"""Company-funds balancing: the transfer log, counted balances of accounts we cannot see, and the closed days. See 074_*.sql."""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now():
    return datetime.now(timezone.utc)


class FundTransfer(Base):
    """A movement of company money. Never edited or deleted: a mistake is voided with a reason and entered again."""
    __tablename__ = "fund_transfers"
    id:           Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    occurred_on:  Mapped[date]      = mapped_column(Date, nullable=False)
    kind:         Mapped[str]       = mapped_column(String(12), nullable=False)   # transfer | injection | drawing | goodwill
    from_account: Mapped[str | None] = mapped_column(String(20))
    to_account:   Mapped[str | None] = mapped_column(String(20))
    amount_kobo:  Mapped[int]       = mapped_column(BigInteger, nullable=False)
    fee_kobo:     Mapped[int]       = mapped_column(BigInteger, default=0, nullable=False)
    reference:    Mapped[str | None] = mapped_column(String(120))
    note:         Mapped[str | None] = mapped_column(String(300))
    created_by:   Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    voided_at:    Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_by:    Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    void_reason:  Mapped[str | None] = mapped_column(String(300))


class FundAccountBalance(Base):
    """What a director counted in an account the app cannot see (the central account, other funds)."""
    __tablename__ = "fund_account_balances"
    account:      Mapped[str]       = mapped_column(String(20), primary_key=True)
    counted_kobo: Mapped[int]       = mapped_column(BigInteger, nullable=False)
    counted_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    counted_by:   Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))


class DayClosing(Base):
    __tablename__ = "day_closings"
    day:                  Mapped[date]     = mapped_column(Date, primary_key=True)
    closed_at:            Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    closed_by:            Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    auto_closed:          Mapped[bool]     = mapped_column(Boolean, default=False, nullable=False)
    opening_capital_kobo: Mapped[int]      = mapped_column(BigInteger, nullable=False)
    profit_kobo:          Mapped[int]      = mapped_column(BigInteger, nullable=False)
    injections_kobo:      Mapped[int]      = mapped_column(BigInteger, default=0, nullable=False)
    drawings_kobo:        Mapped[int]      = mapped_column(BigInteger, default=0, nullable=False)
    goodwill_kobo:        Mapped[int]      = mapped_column(BigInteger, default=0, nullable=False)
    transfer_fees_kobo:   Mapped[int]      = mapped_column(BigInteger, default=0, nullable=False)
    closing_capital_kobo: Mapped[int]      = mapped_column(BigInteger, nullable=False)
    obligations_kobo:     Mapped[int]      = mapped_column(BigInteger, nullable=False)
    expected_total_kobo:  Mapped[int]      = mapped_column(BigInteger, nullable=False)
    actual_total_kobo:    Mapped[int]      = mapped_column(BigInteger, nullable=False)
    difference_kobo:      Mapped[int]      = mapped_column(BigInteger, nullable=False)
    snapshot:             Mapped[dict]     = mapped_column(JSONB, default=dict, nullable=False)
    note:                 Mapped[str | None] = mapped_column(String(300))
