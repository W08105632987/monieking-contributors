from datetime import datetime
from pydantic import BaseModel, Field
import uuid


class RequiredField(BaseModel):
    key: str
    label: str
    type: str            # "text" | "boolean" | "file"
    required: bool
    hint: str | None = None


class IdentityServiceItem(BaseModel):
    id: uuid.UUID
    category: str
    code: str
    name: str
    description: str | None = None
    provider: str
    provider_endpoint: str | None = None
    price_kobo: int
    is_active: bool
    required_fields: list[RequiredField]
    official_document_note: str | None = None
    updated_at: datetime

    class Config:
        from_attributes = True


class IdentityServicePriceUpdate(BaseModel):
    price_kobo: int = Field(..., ge=0)


class IdentityServiceActiveUpdate(BaseModel):
    is_active: bool = Field(
        ..., description="Director-only kill switch. Flip true ONLY once a service has a confirmed working "
                          "integration — never as a placeholder to 'see how it looks' in production."
    )


class IdentityServiceRequestCreate(BaseModel):
    service_id: uuid.UUID
    # Raw values the customer/officer typed in — the API layer masks
    # sensitive fields (id numbers, phone, etc.) before this ever touches
    # the DB. Never log this payload as-is.
    payload: dict


class IdentityServiceRequestItem(BaseModel):
    """History list/detail row — response_summary and request_payload are
    already masked by the time they reach here."""
    id: uuid.UUID
    service_id: uuid.UUID
    service_name: str
    service_category: str
    customer_id: uuid.UUID
    initiated_by: str
    officer_id: uuid.UUID | None = None
    status: str
    request_payload: dict
    response_summary: dict | None = None
    failure_reason: str | None = None
    amount_charged_kobo: int
    provider_reference: str | None = None
    created_at: datetime
    completed_at: datetime | None = None

    class Config:
        from_attributes = True
