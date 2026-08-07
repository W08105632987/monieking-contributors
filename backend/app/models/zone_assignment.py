import uuid
from datetime import datetime, timezone
from sqlalchemy import ForeignKey, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class ZoneAssignment(Base):
    """
    History log of which officer covered which zone, and when. Purely an
    audit trail — the LIVE/current assignment is read directly off
    User.zone_id (fast, no join needed for the authorization checks that
    run on every card/contribution request). A row here with
    ended_at=None is the officer's current assignment; every reassignment
    closes out the old row (sets ended_at) and opens a new one.
    """
    __tablename__ = "zone_assignments"

    id:                      Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # SET NULL, not CASCADE — deleting a zone should never destroy the
    # historical record of who covered it and when. zone_name is a
    # snapshot so history stays readable even after the zone is gone.
    zone_id:                  Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True)
    zone_name:                Mapped[str] = mapped_column(String(100), nullable=False)
    officer_id:               Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    assigned_by_director_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    started_at:               Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at:                 Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
