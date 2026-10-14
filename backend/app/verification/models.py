"""ORM models. Source of truth for the DDL: supabase/migrations/046_techhub_verification.sql"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now():
    return datetime.now(timezone.utc)


class VerificationLookup(Base):
    __tablename__ = "verification_lookups"
    __table_args__ = (UniqueConstraint("initiated_by_id", "client_request_id", name="verification_lookups_req_uq"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    initiated_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    officer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    client_request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    failure_reason: Mapped[str | None] = mapped_column(String(200))
    tier_used: Mapped[str | None] = mapped_column(String(12))
    fee_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    fee_reference: Mapped[str | None] = mapped_column(String(100))
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    summary: Mapped[dict | None] = mapped_column(JSONB)
    result_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    pdf_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    photo_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class VerificationSlip(Base):
    __tablename__ = "verification_slips"
    __table_args__ = (UniqueConstraint("lookup_id", "tier", name="verification_slips_once_uq"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lookup_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("verification_lookups.id", ondelete="CASCADE"), nullable=False)
    tier: Mapped[str] = mapped_column(String(12), nullable=False)
    price_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reference: Mapped[str] = mapped_column(String(100), nullable=False)
    pdf_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class VerificationServiceState(Base):
    __tablename__ = "verification_service_state"

    service: Mapped[str] = mapped_column(String(8), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reason: Mapped[str | None] = mapped_column(String(40))
    alerted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
