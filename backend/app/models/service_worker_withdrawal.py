import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Enum, ForeignKey, DateTime, Text, BigInteger
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class SWWithdrawalStatus(str, enum.Enum):
    PENDING    = "pending"
    PROCESSING = "processing"
    PAID       = "paid"
    REJECTED   = "rejected"


class ServiceWorkerWithdrawal(Base):
    """
    A commission payout request raised by a Service Worker.
    Director reviews and marks as paid/rejected.
    See migration 036_service_worker_and_job_pool.sql.
    """
    __tablename__ = "service_worker_withdrawals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    worker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    amount_kobo:    Mapped[int] = mapped_column(BigInteger, nullable=False)
    account_number: Mapped[str] = mapped_column(String(20),  nullable=False)
    account_name:   Mapped[str] = mapped_column(String(200), nullable=False)
    bank_name:      Mapped[str] = mapped_column(String(100), nullable=False)

    status: Mapped[SWWithdrawalStatus] = mapped_column(
        Enum(SWWithdrawalStatus, name="sw_withdrawal_status",
             values_callable=lambda x: [e.value for e in x]),
        nullable=False, default=SWWithdrawalStatus.PENDING,
    )

    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    worker:   Mapped["User"] = relationship("User", foreign_keys=[worker_id])
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewed_by])
