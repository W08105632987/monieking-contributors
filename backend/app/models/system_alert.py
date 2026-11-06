"""One row per incident. See 070_system_alerts_and_bill_health.sql."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SystemAlert(Base):
    __tablename__ = "system_alerts"

    id:              Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at:      Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now)
    last_seen_at:    Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=_now)
    severity:        Mapped[str]       = mapped_column(String(10), nullable=False)
    category:        Mapped[str]       = mapped_column(String(30), nullable=False)
    title:           Mapped[str]       = mapped_column(String(200), nullable=False)
    detail:          Mapped[dict]      = mapped_column(JSONB().with_variant(JSON(), "sqlite"), nullable=False, default=dict)
    dedupe_key:      Mapped[str]       = mapped_column(String(200), nullable=False)
    occurrences:     Mapped[int]       = mapped_column(Integer, nullable=False, default=1)
    status:          Mapped[str]       = mapped_column(String(14), nullable=False, default="open")
    emailed_at:      Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_ok:        Mapped[bool | None]     = mapped_column(Boolean, nullable=True)
    sms_at:          Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at:     Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
