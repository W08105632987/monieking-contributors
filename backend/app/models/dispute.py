import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Enum, ForeignKey, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class DisputeEntityType(str, enum.Enum):
    WALLET_TRANSACTION = "wallet_transaction"
    WITHDRAWAL         = "withdrawal"


class DisputeStatus(str, enum.Enum):
    OPEN          = "open"           # sitting with an officer, or unclaimed in the director queue
    UNDER_REVIEW  = "under_review"    # officer/director has posted at least one reply
    ESCALATED     = "escalated"       # customer disagreed with an officer's resolution — back in the director queue
    RESOLVED      = "resolved"        # final — director resolutions are final, officer resolutions can still be escalated


class DisputeReason(str, enum.Enum):
    NOT_MINE          = "not_mine"           # "I didn't make/request this"
    AMOUNT_WRONG      = "amount_wrong"
    DUPLICATE         = "duplicate"
    MONEY_NOT_RECEIVED = "money_not_received"
    REJECTED_IN_ERROR = "rejected_in_error"
    OTHER             = "other"


class Dispute(Base):
    __tablename__ = "disputes"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    raised_by:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    entity_type: Mapped[DisputeEntityType] = mapped_column(
        Enum(DisputeEntityType, name="dispute_entity_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    # Not a real FK on purpose — entity_type decides which table entity_id
    # points into (wallet_transactions.id or withdrawals.id), and we never
    # want a dispute to disappear if the underlying row is ever deleted.
    entity_id:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    reason:      Mapped[DisputeReason] = mapped_column(
        Enum(DisputeReason, name="dispute_reason", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    status: Mapped[DisputeStatus] = mapped_column(
        Enum(DisputeStatus, name="dispute_status", values_callable=lambda x: [e.value for e in x]),
        default=DisputeStatus.OPEN, nullable=False,
    )

    # NULL means "sitting in the open director queue" — either the
    # customer was self-registered with no zone officer, or the dispute
    # was escalated and dropped back into the queue for any director to
    # claim. Mirrors Withdrawal.claimed_by_director_id's claim pattern.
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # Snapshot of the customer's zone at the time the dispute was raised —
    # kept even if they're later reassigned, purely for record-keeping.
    zone_id:     Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True)

    resolution_summary: Mapped[str | None] = mapped_column(Text)
    resolved_at:         Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    customer: Mapped["User"] = relationship("User", foreign_keys=[raised_by])
    handler:  Mapped["User | None"] = relationship("User", foreign_keys=[assigned_to])
    messages: Mapped[list["DisputeMessage"]] = relationship(
        "DisputeMessage", back_populates="dispute", order_by="DisputeMessage.created_at",
        cascade="all, delete-orphan",
    )


class DisputeMessage(Base):
    __tablename__ = "dispute_messages"

    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dispute_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("disputes.id", ondelete="CASCADE"), nullable=False)
    sender_id:  Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    message:    Mapped[str] = mapped_column(Text, nullable=False)
    read_at:    Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    dispute: Mapped["Dispute"] = relationship("Dispute", back_populates="messages")
    sender:  Mapped["User"] = relationship("User", foreign_keys=[sender_id])