import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, LargeBinary, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class WebAuthnCredential(Base):
    """
    A registered platform authenticator (Face ID, fingerprint, or a
    security key) for a user. WebAuthn itself doesn't let the server
    finely choose which biometric fires — that's the OS/browser's
    decision based on what the device supports — so `nickname` is just
    what the user called it at registration time (e.g. "Face ID"),
    for their own reference in the credential list, not a technical
    distinction the server enforces.
    """
    __tablename__ = "webauthn_credentials"

    id:               Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    credential_id:    Mapped[bytes]     = mapped_column(LargeBinary, nullable=False, unique=True)
    public_key:       Mapped[bytes]     = mapped_column(LargeBinary, nullable=False)
    sign_count:       Mapped[int]       = mapped_column(Integer, nullable=False, default=0)
    nickname:         Mapped[str]       = mapped_column(String(50), default="Biometric login")
    created_at:       Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_used_at:     Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
