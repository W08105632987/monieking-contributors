from datetime import datetime
from pydantic import BaseModel, Field
import uuid


class BillerItem(BaseModel):
    id: uuid.UUID
    category: str
    name: str
    product_id: str
    product_name: str
    price_kobo: int | None = None   # set for fixed-price products (data/education); null means customer enters an amount
    requires_validation: bool
    markup_percent: float = 0          # lets the app preview what a typed amount will cost
    min_amount_kobo: int | None = None
    max_amount_kobo: int | None = None

    class Config:
        from_attributes = True


class PricingPatch(BaseModel):
    markup_percent: float | None = None
    commission_percent: float | None = None
    customer_price_kobo: int | None = None   # null clears the override (only if sent explicitly)
    is_active: bool | None = None


class BulkPricing(BaseModel):
    category: str | None = None
    name_contains: str | None = Field(None, max_length=60)
    markup_percent: float | None = None
    commission_percent: float | None = None
    clear_overrides: bool = False


class ValidateBillRequest(BaseModel):
    biller_id: uuid.UUID
    customer_reference: str = Field(..., description="Meter number, smartcard number, or phone number")


class ValidateBillResponse(BaseModel):
    validation_reference: str | None = None   # null when the biller doesn't require validation (airtime/data)
    validated_account_name: str | None = None
    requires_validation: bool


class PayBillRequest(BaseModel):
    biller_id: uuid.UUID
    customer_reference: str
    # Required only for variable-amount billers (airtime, electricity).
    # Ignored — and safely overridden server-side — for fixed-price
    # products (data, education), where biller.price_kobo is authoritative.
    amount_kobo: int | None = Field(None, gt=0)
    quantity: int = Field(1, ge=1, le=50)   # education PIN bulk purchases
    validation_reference: str | None = None   # required when the biller's requires_validation is true
    pin: str | None = None   # the payer's 4-digit payment PIN


class BillPaymentRequestItem(BaseModel):
    id: uuid.UUID
    biller_id: uuid.UUID
    biller_name: str
    biller_category: str
    biller_product_name: str | None = None
    customer_id: uuid.UUID
    initiated_by: str
    officer_id: uuid.UUID | None = None
    customer_reference: str            # already masked by the time it reaches here
    amount_kobo: int
    validated_account_name: str | None = None
    status: str
    failure_reason: str | None = None
    token: str | None = None
    amount_charged_kobo: int | None = None
    monnify_transaction_reference: str | None = None
    created_at: datetime
    completed_at: datetime | None = None

    class Config:
        from_attributes = True
