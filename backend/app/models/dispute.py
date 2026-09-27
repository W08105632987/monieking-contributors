import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Enum, ForeignKey, DateTime, Text, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class DisputeEntityType(str, enum.Enum):
    WALLET_TRANSACTION      = "wallet_transaction"
    WITHDRAWAL              = "withdrawal"
    MANUAL_SERVICE_REQUEST  = "manual_service_request"   # ← 4.1.3 fix


class DisputeStatus(str, enum.Enum):
    OPEN          = "open"           # sitting with an officer/worker, or unclaimed in the director queue
    UNDER_REVIEW  = "under_review"   # officer/director has posted at least one reply
    ESCALATED     = "escalated"      # customer disagreed with resolution — back in the director queue
    RESOLVED      = "resolved"       # final — director resolutions are final, officer/worker resolutions can still be escalated


class DisputeReason(str, enum.Enum):
    # Existing (wallet/withdrawal disputes)
    NOT_MINE           = "not_mine"
    AMOUNT_WRONG       = "amount_wrong"
    DUPLICATE          = "duplicate"
    MONEY_NOT_RECEIVED = "money_not_received"
    REJECTED_IN_ERROR  = "rejected_in_error"
    OTHER              = "other"
    # Manual service dispute reasons (4.1.7)
    SERVICE_NOT_COMPLETED_CORRECTLY = "service_not_completed_correctly"
    CUSTOMER_INFO_INCORRECT         = "customer_info_incorrect"
    PORTAL_UNAVAILABLE              = "portal_unavailable"
    COMMISSION_DISPUTE              = "commission_dispute"
    COMMUNICATION_ISSUE             = "communication_issue"


class Dispute(Base):
    __tablename__ = "disputes"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    raised_by:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    entity_type: Mapped[DisputeEntityType] = mapped_column(
        Enum(DisputeEntityType, name="dispute_entity_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    # Not a real FK on purpose — entity_type decides which table entity_id
    # points into, and we never want a dispute to disappear if the underlying
    # row is deleted.
    entity_id:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    reason:      Mapped[DisputeReason] = mapped_column(
        Enum(DisputeReason, name="dispute_reason", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    status: Mapped[DisputeStatus] = mapped_column(
        Enum(DisputeStatus, name="dispute_status", values_callable=lambda x: [e.value for e in x]),
        default=DisputeStatus.OPEN, nullable=False,
    )

    # NULL means "sitting in the open director queue"
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    zone_id:     Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True)

    resolution_summary: Mapped[str | None] = mapped_column(Text)
    resolved_at:         Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Service Worker routing (manual service disputes) — see migration 036
    service_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("manual_service_requests.id", ondelete="SET NULL"),
        nullable=True,
    )
    assigned_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_escalated:    Mapped[bool]             = mapped_column(Boolean, nullable=False, default=False)
    escalated_at:    Mapped[datetime | None]  = mapped_column(DateTime(timezone=True), nullable=True)
    escalation_reason: Mapped[str | None]    = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    customer:        Mapped["User"] = relationship("User", foreign_keys=[raised_by])
    handler:         Mapped["User | None"] = relationship("User", foreign_keys=[assigned_to])
    assigned_worker: Mapped["User | None"] = relationship("User", foreign_keys=[assigned_worker_id])
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

    # File attachment
    attachment_url:  Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attachment_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Internal notes (4.1.10) — hidden from customers
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    dispute: Mapped["Dispute"] = relationship("Dispute", back_populates="messages")
    sender:  Mapped["User"] = relationship("User", foreign_keys=[sender_id])