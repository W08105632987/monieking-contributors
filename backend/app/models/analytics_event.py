import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class AnalyticsEvent(Base):
    """A single pageview or click, feeding the live-metrics dashboard.
    See 026_analytics_events.sql for the full reasoning — self-hosted
    rather than a third-party script, admin/director-only to read."""
    __tablename__ = "analytics_events"

    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str]       = mapped_column(String(20), nullable=False)   # 'pageview' | 'click'
    path:       Mapped[str]       = mapped_column(Text, nullable=False)
    label:      Mapped[str | None] = mapped_column(Text, nullable=True)
    session_id: Mapped[str]       = mapped_column(String(64), nullable=False)
    user_id:    Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    role:       Mapped[str | None] = mapped_column(String(20), nullable=True)
    referrer:   Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
