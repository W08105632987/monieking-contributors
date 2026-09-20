import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class HealthCheckResult(Base):
    """One run of one check — see 027_system_health_monitor.sql."""
    __tablename__ = "health_check_results"

    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    check_name: Mapped[str]       = mapped_column(String(50), nullable=False)
    status:     Mapped[str]       = mapped_column(String(20), nullable=False)   # healthy | degraded | down
    message:    Mapped[str | None] = mapped_column(Text, nullable=True)
    metrics:    Mapped[dict | None] = mapped_column(JSON, nullable=True)
    checked_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class HealthAlertState(Base):
    """One row per check_name — last known status and when an alert was
    last actually sent, for cooldown purposes."""
    __tablename__ = "health_alert_state"

    check_name:      Mapped[str]      = mapped_column(String(50), primary_key=True)
    last_status:     Mapped[str]      = mapped_column(String(20), nullable=False)
    last_alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at:      Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
