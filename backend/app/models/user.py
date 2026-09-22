import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Enum, Boolean, ForeignKey, DateTime, Text, Float, Integer, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class UserRole(str, enum.Enum):
    CUSTOMER       = "customer"
    OFFICER        = "officer"
    ADMIN          = "admin"
    DIRECTOR       = "director"
    SERVICE_WORKER = "service_worker"


class UserStatus(str, enum.Enum):
    ACTIVE               = "active"
    SUSPENDED            = "suspended"
    PENDING_VERIFICATION = "pending_verification"


class LocationConsentStatus(str, enum.Enum):
    NOT_ASKED = "not_asked"
    GRANTED   = "granted"
    DECLINED  = "declined"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # Short, human-friendly public identifier (e.g. 1000, 1001, ...) —
    # shown in the URL bar and UI instead of the UUID `id` above.
    # Assigned by the DB sequence `customer_number_seq`.
    customer_number: Mapped[int] = mapped_column(
        Integer, unique=True, index=True, nullable=False,
        server_default=text("nextval('customer_number_seq')"),
    )

    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    # Bank details (customers + manual customers)
    bank_name:      Mapped[str | None] = mapped_column(String(100))
    bank_code:      Mapped[str | None] = mapped_column(String(10))
    account_number: Mapped[str | None] = mapped_column(String(20))
    account_name:   Mapped[str | None] = mapped_column(String(200))

    # Face verification image
    face_image_url: Mapped[str | None] = mapped_column(Text)

    # Next of kin
    next_of_kin_name:  Mapped[str | None] = mapped_column(String(200))
    next_of_kin_phone: Mapped[str | None] = mapped_column(String(20))

    # KYC (BVN/NIN) — CBN requires every Monnify reserved account to be
    # linked to at least one of these before it can be created at all.
    # We never store the raw number, only whether it's linked and the
    # last 4 digits for the user's own reference — see migration 014.
    bvn_linked:       Mapped[bool]          = mapped_column(Boolean, nullable=False, default=False)
    nin_linked:       Mapped[bool]          = mapped_column(Boolean, nullable=False, default=False)
    bvn_last4:        Mapped[str | None]    = mapped_column(String(4))
    nin_last4:        Mapped[str | None]    = mapped_column(String(4))
    kyc_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Zone assignment
    zone_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True
    )

    # Customer base geography — asked once, right after registration, via
    # a friendly consent screen with a Skip option. Used only to show
    # Directors which states their customer base is concentrated in;
    # never shown per-customer, only aggregated. detected_state is computed
    # server-side from lat/lng via nearest-centroid matching, not trusted
    # from the client.
    location_consent_status: Mapped[LocationConsentStatus] = mapped_column(
        Enum(LocationConsentStatus, name="location_consent_status", values_callable=lambda x: [e.value for e in x]),
        default=LocationConsentStatus.NOT_ASKED,
    )
    location_latitude:  Mapped[float | None] = mapped_column(Float, nullable=True)
    location_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    detected_state:      Mapped[str | None]  = mapped_column(String(50), nullable=True)

    # Temporary, single-use challenge storage for the WebAuthn ceremony —
    # cleared immediately after a successful verify, and rejected if
    # expired. Deliberately on the user row rather than Redis/a separate
    # table: challenges are short-lived (2 min) and per-user by nature,
    # so this is simpler than adding a new store for something this small.
    webauthn_challenge:            Mapped[str | None]      = mapped_column(String(255), nullable=True)
    webauthn_challenge_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Profile picture — Supabase Storage public URL, falls back to
    # initials-avatar in the UI when null
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Withdrawal-password brute-force protection (finding #7 — was
    # defined in config, never wired to anything)
    withdrawal_password_failed_attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    withdrawal_password_locked_until:    Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Escalating login lockout — same idea as the withdrawal-password
    # lockout above, applied to the login password. See
    # 010_login_lockout.sql for the escalation rules.
    login_failed_attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    login_locked_until:    Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    login_lockout_level:   Mapped[int] = mapped_column(default=0, server_default="0")

    # Forgot-password OTP (login password, sent via SMS)
    login_password_reset_otp_hash:       Mapped[str | None]      = mapped_column(String(255), nullable=True)
    login_password_reset_otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Who registered this user
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Manual customer (cash-paying, managed by officer)
    is_manual_customer:   Mapped[bool]            = mapped_column(Boolean, default=False)
    managing_officer_id:  Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Hashed passwords
    login_password_hash:      Mapped[str | None] = mapped_column(Text)
    withdrawal_password_hash: Mapped[str | None] = mapped_column(Text)

    # Set when an officer taps "mark as contacted" on this customer from
    # the inactive-customers list (see customer_stats_service.py). NULL =
    # never contacted. Not role-restricted at the DB level — see 020_
    # migration comment.
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Admin CRM 2FA — see 022_admin_two_factor.sql for why these are
    # separate from the password-reset OTP pair above.
    two_factor_otp_hash:       Mapped[str | None] = mapped_column(Text, nullable=True)
    two_factor_otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Legal acceptance — see 028_legal_acceptance.sql
    terms_accepted_at:      Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    terms_accepted_version: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # SMS transaction notifications preference — see 032_sms_subscription_and_wallet_overdraft.sql
    sms_alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # Service Worker profile — see 036_service_worker_and_job_pool.sql
    onboarding_completed:  Mapped[bool]         = mapped_column(Boolean, default=False, server_default="false")
    state_of_residence:    Mapped[str | None]   = mapped_column(String(50), nullable=True)
    referral_code:         Mapped[str | None]   = mapped_column(String(20), unique=True, nullable=True)
    commission_balance_kobo: Mapped[int]        = mapped_column(default=0, server_default="0")

    @property
    def has_withdrawal_password(self) -> bool:
        """Lets the frontend tell first-time setup (no current password to
        verify) apart from an actual change — without exposing the hash."""
        return self.withdrawal_password_hash is not None

    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status", values_callable=lambda x: [e.value for e in x]), default=UserStatus.PENDING_VERIFICATION
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    wallet: Mapped["Wallet"] = relationship("Wallet", back_populates="owner", uselist=False)
    cards:  Mapped[list["ContributionCard"]] = relationship("ContributionCard", back_populates="owner")
    zone:   Mapped["Zone | None"] = relationship("Zone", foreign_keys=[zone_id])
