import uuid
import enum
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import String, BigInteger, Boolean, ForeignKey, DateTime, Enum, Text, Numeric
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base
from app.models.identity_service import InitiatedBy   # reused, not duplicated


class BillerCategory(str, enum.Enum):
    AIRTIME     = "airtime"
    DATA        = "data"
    ELECTRICITY = "electricity"
    CABLE_TV    = "cable_tv"
    EDUCATION   = "education"


class BillPaymentStatus(str, enum.Enum):
    PENDING_VALIDATION = "pending_validation"   # electricity/cable only — awaiting customer confirmation
    VALIDATED          = "validated"
    PENDING            = "pending"              # vend call in flight
    COMPLETED          = "completed"
    FAILED             = "failed"
    REVERSED           = "reversed"


class Biller(Base):
    """
    Cached copy of Monnify's Discovery data. Populated/refreshed by
    bill_payment_service.sync_billers() — never fetched live per-request,
    since Monnify's discovery endpoints aren't built for that traffic
    pattern. is_active lets the director hide a biller without deleting
    the sync history.
    """
    __tablename__ = "billers"

    id:                Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    monnify_biller_id: Mapped[str] = mapped_column(String(80), nullable=False)
    category:          Mapped[BillerCategory] = mapped_column(
        Enum(BillerCategory, name="biller_category", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    name:               Mapped[str] = mapped_column(String(160), nullable=False)
    product_id:         Mapped[str] = mapped_column(String(80), nullable=False)
    product_name:       Mapped[str] = mapped_column(String(160), nullable=False)
    # Fixed price for data plans/education PINs; null for variable-amount
    # billers (airtime, electricity) where the customer types an amount.
    # The service layer trusts THIS value over anything the client sends
    # once it's set — see bill_payment_service.pay_bill.
    price_kobo:          Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    requires_validation: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active:          Mapped[bool] = mapped_column(Boolean, default=True)

    # ── Pricing (director-controlled; see services/bill_pricing.py) ────────
    # Monnify's commission on this product, % of the vend amount.
    commission_percent:  Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False, default=Decimal("0"), server_default="0")
    # What the customer pays over (or under, if negative) Monnify's price.
    markup_percent:      Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False, default=Decimal("0"), server_default="0")
    # Explicit customer price for FIXED-price products; wins over markup_percent.
    customer_price_kobo: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Monnify's own limits for variable-amount products (e.g. airtime from ₦100).
    min_amount_kobo:     Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    max_amount_kobo:     Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_synced_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at:         Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class BillPaymentRequest(Base):
    __tablename__ = "bill_payment_requests"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    initiated_by: Mapped[InitiatedBy] = mapped_column(
        Enum(InitiatedBy, name="identity_request_initiated_by", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    officer_id:  Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    biller_id:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("billers.id"), nullable=False)

    # Masked before persistence — see bill_payment_service._mask, same
    # convention as identity_services.
    customer_reference: Mapped[str] = mapped_column(String(80), nullable=False)
    amount_kobo:         Mapped[int] = mapped_column(BigInteger, nullable=False)

    validation_reference:   Mapped[str | None] = mapped_column(String(120), nullable=True)
    validated_account_name: Mapped[str | None] = mapped_column(String(160), nullable=True)

    monnify_transaction_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status:          Mapped[BillPaymentStatus] = mapped_column(
        Enum(BillPaymentStatus, name="bill_payment_status", values_callable=lambda x: [e.value for e in x]),
        nullable=False, default=BillPaymentStatus.PENDING,
    )
    failure_reason:  Mapped[str | None] = mapped_column(Text, nullable=True)
    # Electricity token — deliberately NOT masked. Unlike a NIN/BVN this
    # isn't the customer's personal data, it's the thing they came here
    # to buy; masking it would make the receipt useless.
    token:           Mapped[str | None] = mapped_column(String(60), nullable=True)

    amount_charged_kobo: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # amount_kobo is what the CUSTOMER was charged. These record the rest of the sale:
    vend_amount_kobo: Mapped[int | None] = mapped_column(BigInteger, nullable=True)   # what Monnify was asked to vend
    commission_kobo:  Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    markup_kobo:      Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")  # charged − vend

    created_at:   Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
