from datetime import datetime, date
from pydantic import BaseModel, Field
import uuid


class SystemConfigItem(BaseModel):
    key: str
    value: str
    description: str | None = None
    updated_by: uuid.UUID | None = None
    updated_at: datetime

    class Config:
        from_attributes = True


class SystemConfigUpdate(BaseModel):
    value: str = Field(..., description="New value, stored as text (parsed by the consumer)")


# ── Deferred rate change ────────────────────────────────────────
class RateChangeRequest(BaseModel):
    setting_key: str = Field(..., description="Currently only 'food_card_rate_kobo' supports deferral")
    new_value_kobo: int = Field(..., gt=0)


class RateChangePreview(BaseModel):
    """Returned before confirmation, to power the info modal."""
    setting_key: str
    current_value_kobo: int
    new_value_kobo: int
    effective_date: date
    days_until_effective: int
    customers_will_be_notified_on: date


class PendingRateChangeResponse(BaseModel):
    id: uuid.UUID
    setting_key: str
    current_value_kobo: int
    new_value_kobo: int
    effective_date: date
    status: str
    created_by: uuid.UUID
    created_at: datetime
    cancelled_at: datetime | None
    notified_at: datetime | None
    days_until_effective: int | None = None

    class Config:
        from_attributes = True


class RateChangeEditRequest(BaseModel):
    new_value_kobo: int = Field(..., gt=0)
