import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Text, Boolean, ForeignKey, DateTime, Enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class NotificationType(str, enum.Enum):
    INFO      = "info"
    SUCCESS   = "success"
    WARNING   = "warning"
    ERROR     = "error"
    BROADCAST = "broadcast"


class Notification(Base):
    __tablename__ = "notifications"

    id:      Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    title: Mapped[str]       = mapped_column(String(200), nullable=False)
    body:  Mapped[str]       = mapped_column(Text, nullable=False)
    type:  Mapped[NotificationType] = mapped_column(Enum(NotificationType, name="notification_type", values_callable=lambda x: [e.value for e in x]), default=NotificationType.INFO)

    is_read:          Mapped[bool]           = mapped_column(Boolean, default=False)
    related_entity_id:Mapped[uuid.UUID|None] = mapped_column(UUID(as_uuid=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id:            Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sent_by:       Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title:         Mapped[str]       = mapped_column(String(200), nullable=False)
    body:          Mapped[str]       = mapped_column(Text, nullable=False)
    target_roles:  Mapped[str]       = mapped_column(String(200), default="all")  # comma-separated roles or "all"
    target_zone_id:Mapped[uuid.UUID|None] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id"), nullable=True)
    created_at:    Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
