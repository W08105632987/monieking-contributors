import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Boolean, Integer, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base


class DirectorActivity(Base):
    """One row per state-changing request made by a director or admin. Written automatically (core/journal.py)."""
    __tablename__ = "director_activity"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id:    Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    actor_name:  Mapped[str]       = mapped_column(String(200), nullable=False)
    method:      Mapped[str]       = mapped_column(String(8), nullable=False)
    path:        Mapped[str]       = mapped_column(Text, nullable=False)
    route:       Mapped[str | None] = mapped_column(Text)
    label:       Mapped[str]       = mapped_column(String(160), nullable=False)
    category:    Mapped[str]       = mapped_column(String(40), nullable=False, default="general")
    sensitive:   Mapped[bool]      = mapped_column(Boolean, nullable=False, default=False)
    target_id:   Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    target_name: Mapped[str | None] = mapped_column(String(200))
    details:     Mapped[dict | None] = mapped_column(JSONB)
    status_code: Mapped[int]       = mapped_column(Integer, nullable=False)
    ip_address:  Mapped[str | None] = mapped_column(String(45))
    user_agent:  Mapped[str | None] = mapped_column(Text)
    created_at:  Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
