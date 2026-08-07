import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import BigInteger, ForeignKey, DateTime, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class WithdrawalStatus(str, enum.Enum):
    PENDING  = "pending"
    CLAIMED  = "claimed"
    PAID     = "paid"
    REJECTED = "rejected"


class WithdrawalSource(str, enum.Enum):
    CARD   = "card"
    WALLET = "wallet"


class Withdrawal(Base):
    __tablename__ = "withdrawals"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    card_id:     Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("contribution_cards.id"), nullable=True)
    source: Mapped[WithdrawalSource] = mapped_column(
        Enum(WithdrawalSource, name="withdrawal_source", values_callable=lambda x: [e.value for e in x]),
        default=WithdrawalSource.CARD, nullable=False,
    )

    requested_amount_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    charge_kobo:           Mapped[int] = mapped_column(BigInteger, nullable=False)
    net_payable_kobo:      Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Snapshot of bank details at time of request
    bank_name:      Mapped[str] = mapped_column(String(100), nullable=False)
    account_number: Mapped[str] = mapped_column(String(20),  nullable=False)
    account_name:   Mapped[str] = mapped_column(String(200), nullable=False)

    status: Mapped[WithdrawalStatus] = mapped_column(
        Enum(WithdrawalStatus, name="withdrawal_status", values_callable=lambda x: [e.value for e in x]), default=WithdrawalStatus.PENDING
    )

    # Optimistic lock — only one director can claim
    claimed_by_director_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    claimed_at:    Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None]   = mapped_column(Text)

    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    customer: Mapped["User"] = relationship("User", foreign_keys=[customer_id])
    director: Mapped["User | None"] = relationship("User", foreign_keys=[claimed_by_director_id])
    card:     Mapped["ContributionCard | None"] = relationship("ContributionCard")
