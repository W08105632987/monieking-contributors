import uuid
from datetime import datetime, timezone
from sqlalchemy import Text, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class PushSubscription(Base):
    """
    One row per subscribed device. A user can have several active at once
    (phone + desktop simultaneously) — never assume one-per-user.
    """
    __tablename__ = "push_subscriptions"

    id:           Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id:      Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint:     Mapped[str]       = mapped_column(Text, unique=True, nullable=False)
    p256dh_key:   Mapped[str]       = mapped_column(Text, nullable=False)
    auth_key:     Mapped[str]       = mapped_column(Text, nullable=False)
    user_agent:   Mapped[str | None] = mapped_column(Text)
    created_at:   Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
