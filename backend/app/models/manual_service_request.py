import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Enum, Boolean, ForeignKey, DateTime, Text, BigInteger, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base


class ManualServiceStatus(str, enum.Enum):
    PENDING    = "pending"
    PROCESSING = "processing"
    SUCCESSFUL = "successful"
    FAILED     = "failed"


class CommissionStatus(str, enum.Enum):
    CLEARED  = "cleared"   # commission credited normally, no active hold
    HELD     = "held"      # dispute active, commission moved to held balance
    REVERSED = "reversed"  # dispute resolved against worker, commission forfeited


class ManualServiceRequest(Base):
    """
    A customer/officer-submitted manual service request that enters the open
    Job Pool and can be claimed by a Service Worker for processing.
    See migration 036_service_worker_and_job_pool.sql.
    """
    __tablename__ = "manual_service_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Who submitted the request
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # Service classification
    service_category: Mapped[str] = mapped_column(String(100), nullable=False)
    service_type:     Mapped[str] = mapped_column(String(100), nullable=False)

    # All form fields as captured by the frontend
    form_data:      Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    uploaded_files: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Which published service template version this request was submitted under (NULL = legacy form).
    # Column added by migration 044.
    template_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service_template_versions.id", ondelete="SET NULL"), nullable=True
    )

    # Pricing & consent
    price_kobo:    Mapped[int]  = mapped_column(BigInteger, nullable=False, default=0)
    consent_given: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Optional referral to a specific worker by the customer
    referred_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Job lifecycle
    status:       Mapped[ManualServiceStatus] = mapped_column(
        Enum(ManualServiceStatus, name="manual_service_status",
             values_callable=lambda x: [e.value for e in x]),
        nullable=False, default=ManualServiceStatus.PENDING,
    )
    claimed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    claimed_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Worker resolution fields
    worker_status:          Mapped[str | None] = mapped_column(String(50), nullable=True)
    worker_response:        Mapped[str | None] = mapped_column(Text, nullable=True)
    worker_remarks:         Mapped[str | None] = mapped_column(Text, nullable=True)
    worker_additional_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    worker_result_file_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Commission awarded upon successful completion
    worker_commission_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    commission_status: Mapped[CommissionStatus] = mapped_column(
        Enum(CommissionStatus, name="commission_status", values_callable=lambda x: [e.value for e in x]),
        nullable=False, default=CommissionStatus.CLEARED, server_default="cleared",
    )

    # Linked dispute (nullable FK — set when customer disputes this service)
    dispute_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    customer:        Mapped["User"] = relationship("User", foreign_keys=[user_id])
    claimed_by:      Mapped["User | None"] = relationship("User", foreign_keys=[claimed_by_id])
    referred_worker: Mapped["User | None"] = relationship("User", foreign_keys=[referred_worker_id])
