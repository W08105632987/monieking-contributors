import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, BigInteger, Boolean, ForeignKey, DateTime, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class TxType(str, enum.Enum):
    CREDIT = "credit"
    DEBIT  = "debit"


class TxCategory(str, enum.Enum):
    WALLET_FUNDING      = "wallet_funding"
    CONTRIBUTION        = "contribution"
    WITHDRAWAL          = "withdrawal"
    CHARGE              = "charge"
    OFFICER_CONTRIBUTION= "officer_contribution"
    REVERSAL            = "reversal"


class Wallet(Base):
    __tablename__ = "wallets"

    id:       Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    balance_kobo:         Mapped[int]      = mapped_column(BigInteger, default=0, nullable=False)
    virtual_account_number: Mapped[str | None] = mapped_column(String(20), unique=True)
    virtual_account_bank:   Mapped[str | None] = mapped_column(String(100))
    virtual_account_ref:    Mapped[str | None] = mapped_column(String(100), unique=True)
    is_frozen: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    owner:        Mapped["User"]                  = relationship("User", back_populates="wallet")
    transactions: Mapped[list["WalletTransaction"]] = relationship("WalletTransaction", back_populates="wallet")


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    id:        Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wallet_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("wallets.id", ondelete="CASCADE"), nullable=False)

    type:     Mapped[TxType]     = mapped_column(Enum(TxType, name="tx_type", values_callable=lambda x: [e.value for e in x]), nullable=False)
    category: Mapped[TxCategory] = mapped_column(Enum(TxCategory, name="tx_category", values_callable=lambda x: [e.value for e in x]), nullable=False)

    amount_kobo:       Mapped[int]      = mapped_column(BigInteger, nullable=False)
    balance_after_kobo:Mapped[int]      = mapped_column(BigInteger, nullable=False)
    reference:         Mapped[str]      = mapped_column(String(100), unique=True, nullable=False)
    description:       Mapped[str|None] = mapped_column(Text)

    related_card_id:       Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("contribution_cards.id", ondelete="SET NULL"))
    related_withdrawal_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("withdrawals.id", ondelete="SET NULL"))
    initiated_by:          Mapped[uuid.UUID]        = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    wallet: Mapped["Wallet"] = relationship("Wallet", back_populates="transactions")
