import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now():
    return datetime.now(timezone.utc)


class ProviderServiceConfig(Base):
    __tablename__ = "provider_service_config"

    service_code: Mapped[str] = mapped_column(String(100), primary_key=True)
    provider: Mapped[str] = mapped_column(String(30), nullable=False, default="techhub")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    endpoint: Mapped[str] = mapped_column(String(80), nullable=False)
    field_map: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    value_maps: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    static_params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    file_params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    applies_when: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status_param: Mapped[str] = mapped_column(String(30), nullable=False, default="ticket_id")
    refund_on_failure: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    alert_after_days: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    poll_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ProviderTicket(Base):
    __tablename__ = "provider_tickets"
    __table_args__ = (UniqueConstraint("job_id", "seq", name="provider_tickets_job_id_seq_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("manual_service_requests.id", ondelete="CASCADE"), nullable=False)
    service_code: Mapped[str] = mapped_column(String(100), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    provider: Mapped[str] = mapped_column(String(30), nullable=False, default="techhub")
    ticket_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="sending")
    cost_raw: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
