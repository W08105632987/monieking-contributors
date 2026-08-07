import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base


class AuditLog(Base):
    """Immutable append-only audit trail. No UPDATE or DELETE on this table."""
    __tablename__ = "audit_logs"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id:    Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    action:      Mapped[str]       = mapped_column(String(100), nullable=False)   # e.g. "withdrawal.claimed"
    entity_type: Mapped[str]       = mapped_column(String(50),  nullable=False)   # e.g. "withdrawal"
    entity_id:   Mapped[str]       = mapped_column(String(100), nullable=False)

    old_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    ip_address: Mapped[str | None] = mapped_column(String(45))   # IPv4 or IPv6
    user_agent: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
