import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Text, Boolean, ForeignKey, DateTime, Enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class InstantMessagePriority(str, enum.Enum):
    NORMAL = "normal"
    URGENT = "urgent"


class InstantMessage(Base):
    """
    The scrolling ticker bar pinned above the bottom nav on every page.
    Separate from the notification inbox — for things that need to be
    seen immediately without opening notifications.
    Only one active message per audience is meaningful; activating a new
    one deactivates the previous (enforced in the route, not the DB).
    """
    __tablename__ = "instant_messages"

    id:           Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message:      Mapped[str]       = mapped_column(Text, nullable=False)
    priority:     Mapped[InstantMessagePriority] = mapped_column(
        Enum(InstantMessagePriority, name="instant_message_priority", values_callable=lambda x: [e.value for e in x]),
        default=InstantMessagePriority.NORMAL,
    )
    target_roles: Mapped[str]       = mapped_column(String(200), default="all")
    is_active:    Mapped[bool]      = mapped_column(Boolean, default=True)
    expires_at:   Mapped[datetime|None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
