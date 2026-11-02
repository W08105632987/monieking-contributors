import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, BigInteger, Integer, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class MarkingCorrection(Base):
    """What a director removed from a card to fix a wrong marking (kept forever so it can be audited)."""
    __tablename__ = "marking_corrections"

    id:               Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dispute_id:       Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("disputes.id", ondelete="SET NULL"))
    card_id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("contribution_cards.id", ondelete="CASCADE"), nullable=False)
    corrected_by:     Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    officer_id:       Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    mode:             Mapped[str] = mapped_column(String(20), nullable=False)
    days_removed:     Mapped[int] = mapped_column(Integer, nullable=False)
    amount_kobo:      Mapped[int] = mapped_column(BigInteger, nullable=False)
    refund_reference: Mapped[str | None] = mapped_column(String(100))
    note:             Mapped[str | None] = mapped_column(Text)
    created_at:       Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
