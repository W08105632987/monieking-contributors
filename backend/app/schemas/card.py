from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional
import uuid
from datetime import datetime
from app.models.card import CardType, CardStatus, CardCompletionStatus, ContributionMethod


class CreateCardRequest(BaseModel):
    card_type:  CardType
    rate_kobo:  int
    owner_id:   Optional[uuid.UUID] = None

    @field_validator("rate_kobo")
    @classmethod
    def valid_rate(cls, v: int) -> int:
        if v < 5_000:   # minimum ₦50
            raise ValueError("Minimum card rate is ₦50 (5,000 kobo)")
        if v % 5_000 != 0:
            raise ValueError("Card rate must be a multiple of ₦50")
        return v


class ContributeRequest(BaseModel):
    card_id:     uuid.UUID
    amount_kobo: int

    @field_validator("amount_kobo")
    @classmethod
    def positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Amount must be positive")
        return v


class CloseCardRequest(BaseModel):
    withdrawal_password: str


class CardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:                     uuid.UUID
    card_number:            int
    owner_id:               uuid.UUID
    card_type:              CardType
    rate_kobo:              int
    total_days_contributed: int
    total_contributed_kobo: int
    status:                 CardStatus
    completion_status:      Optional[CardCompletionStatus]
    food_eligibility_lost_at: Optional[datetime]
    created_at:             datetime
    completed_at:           Optional[datetime]
    latest_withdrawal_id:   Optional[uuid.UUID] = None


class ContributionRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:             uuid.UUID
    card_id:        uuid.UUID
    logical_month:  int
    logical_day:    int
    amount_kobo:    int
    contributed_by: uuid.UUID
    method:         ContributionMethod
    reference:      str
    created_at:     datetime


class GridCell(BaseModel):
    month:           int
    day:             int
    filled:          bool
    withdrawn:       bool = False
    contribution_id: Optional[uuid.UUID] = None


class CardGridResponse(BaseModel):
    card_id: uuid.UUID
    grid:    list[list[GridCell]]   # [12][31]
