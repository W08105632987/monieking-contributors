import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, BigInteger, Boolean, ForeignKey, DateTime, Enum, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base


class IdentityServiceCategory(str, enum.Enum):
    """
    Maps 1:1 to the customer-facing Quick Action tiles. NIN-family and
    BVN-family services are grouped under one tile each on purpose (see
    the dashboard redesign) — this is what that grouping key drives.
    """
    NIMC        = "nimc"          # NIN verification, personalisation, modification, validation
    BVN         = "bvn"           # verification, modification, retrieval (phone/CRM), IPE clearance, license onboarding, delinking
    TIN         = "tin"
    ATTESTATION = "attestation"
    CAC         = "cac"
    VENDOR      = "vendor"
    AIRTIME     = "airtime"
    BILLS       = "bills"


class IdentityRequestStatus(str, enum.Enum):
    PENDING   = "pending"     # sent to provider, awaiting response
    COMPLETED = "completed"   # provider returned a result (found or not_found — see response_summary)
    FAILED    = "failed"      # provider/network error, nothing charged
    REVERSED  = "reversed"    # charged but later refunded (e.g. provider returned not_found on a paid lookup)


class InitiatedBy(str, enum.Enum):
    CUSTOMER = "customer"     # self-service, from the customer app
    OFFICER  = "officer"      # officer ran it on a customer's behalf


class IdentityService(Base):
    """
    The service catalog. One row per Quick Action sub-service (e.g. 'BVN
    modification', 'NIN verification'). Price is director-editable and
    takes effect immediately — unlike food_card_rate_kobo in system_config,
    there's no already-locked-in customer commitment to protect here, so
    no deferred-change flow is needed.

    required_fields describes the form the frontend renders for this
    service — sourced directly from the provider's (Youverify) documented
    request schema, not guessed. Keep this in sync with their docs; it's
    the single source of truth every portal's form reads from.
    """
    __tablename__ = "identity_services"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category:    Mapped[IdentityServiceCategory] = mapped_column(
        Enum(IdentityServiceCategory, name="identity_service_category", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    code:        Mapped[str]  = mapped_column(String(80), unique=True, nullable=False)   # e.g. "bvn_verification", "nin_modification"
    name:        Mapped[str]  = mapped_column(String(120), nullable=False)               # e.g. "BVN verification"
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Which vendor/integration actually services this request. "manual" means
    # it's a Tier-2 gated service with no live API yet — see MonieKing's own
    # FEP-licensing status before flipping is_active on any "manual" row.
    provider:       Mapped[str]  = mapped_column(String(40), nullable=False, default="youverify")
    provider_endpoint: Mapped[str | None] = mapped_column(String(160), nullable=True)     # e.g. "/v2/api/identity/ng/bvn"

    price_kobo:  Mapped[int]  = mapped_column(BigInteger, nullable=False, default=0)
    is_active:   Mapped[bool] = mapped_column(Boolean, default=False)   # OFF by default — flip on only once the integration is real, never as a placeholder

    # Customer-facing clarification shown next to any result/reference PDF
    # for this service — see migration 030 for why this exists. NULL means
    # no note is needed. Set once per service in seed_identity_services.py;
    # never editable from the price/active PATCH endpoints — this is a
    # factual/legal clarification, not a marketing string a director should
    # be able to freely rewrite.
    official_document_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # JSON Schema-ish description of the form: [{key, label, type, required, ...}]
    required_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class IdentityServiceNotifyRequest(Base):
    """
    'Notify me' taps on Coming Soon services. One row per (service,
    customer) — this is the real-demand signal that decides which
    manual/gated services actually get built next, not a guess.
    """
    __tablename__ = "identity_service_notify_requests"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service_id:  Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("identity_services.id"), nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class IdentityServiceRequest(Base):
    """
    The history log every portal reads from — 'NIN verification history',
    'BVN modification history', etc. are all just this one table filtered
    by service.category / service_id. One row per attempt, append-only
    (like AuditLog); a retry is a new row, not an update to this one.

    request_payload is the REDACTED form the customer/officer submitted —
    never store a raw NIN/BVN/document image here. See note below.
    """
    __tablename__ = "identity_service_requests"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service_id:  Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("identity_services.id"), nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    initiated_by: Mapped[InitiatedBy] = mapped_column(
        Enum(InitiatedBy, name="identity_request_initiated_by", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    officer_id:  Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    status: Mapped[IdentityRequestStatus] = mapped_column(
        Enum(IdentityRequestStatus, name="identity_request_status", values_callable=lambda x: [e.value for e in x]),
        default=IdentityRequestStatus.PENDING,
    )

    # SECURITY NOTE: mask before writing here — e.g. bvn "12345678901" ->
    # "1234•••8901". Full numbers live only in-flight (request memory) and
    # in the provider's own system, never at rest in our DB. Same for any
    # uploaded ID document: store a reference to encrypted object storage,
    # never the raw file or its base64 in this JSONB column.
    request_payload:  Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    response_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)   # provider's result, also masked
    failure_reason:   Mapped[str | None] = mapped_column(Text, nullable=True)

    amount_charged_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    provider_reference:  Mapped[str | None] = mapped_column(String(120), nullable=True)  # provider's own request/tracking ID

    created_at:   Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
