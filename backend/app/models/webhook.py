import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base


class PaymentWebhook(Base):
    """Raw Monnify webhook payloads — idempotency and audit."""
    __tablename__ = "payment_webhooks"

    id:                  Mapped[uuid.UUID]   = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider:            Mapped[str]         = mapped_column(String(50), default="monnify")
    transaction_reference: Mapped[str]       = mapped_column(String(200), unique=True, nullable=False)
    amount_kobo:         Mapped[int | None]  = mapped_column(nullable=True)
    account_number:      Mapped[str | None]  = mapped_column(String(20))
    raw_payload:         Mapped[dict]        = mapped_column(JSONB, nullable=False)
    processed:           Mapped[bool]        = mapped_column(Boolean, default=False)
    processing_error:    Mapped[str | None]  = mapped_column(Text)
    received_at:         Mapped[datetime]    = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    processed_at:        Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
