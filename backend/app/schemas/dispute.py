import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from app.models.dispute import DisputeEntityType, DisputeStatus, DisputeReason


class CreateDisputeRequest(BaseModel):
    entity_type: DisputeEntityType
    entity_id:   uuid.UUID
    reason:      DisputeReason
    message:     str = Field(min_length=1, max_length=1000)


class AddMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class ResolveDisputeRequest(BaseModel):
    resolution_summary: str = Field(min_length=1, max_length=1000)


class DisputeMessageResponse(BaseModel):
    id:         uuid.UUID
    sender_id:  uuid.UUID
    sender_name: str
    message:    str
    read_at:    datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class DisputeResponse(BaseModel):
    id:           uuid.UUID
    raised_by:    uuid.UUID
    customer_name: str
    entity_type:  DisputeEntityType
    entity_id:    uuid.UUID
    reason:       DisputeReason
    status:       DisputeStatus
    assigned_to:  uuid.UUID | None
    handler_name: str | None
    resolution_summary: str | None
    can_resolve:  bool = False
    created_at:   datetime
    updated_at:   datetime
    resolved_at:  datetime | None

    class Config:
        from_attributes = True


class DisputeDetailResponse(DisputeResponse):
    messages: list[DisputeMessageResponse]