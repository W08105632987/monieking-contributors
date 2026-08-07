from datetime import datetime
from pydantic import BaseModel, Field
import uuid


class InstantMessageCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)
    priority: str = Field(default="normal", pattern="^(normal|urgent)$")
    target_roles: str = Field(default="all")
    expires_at: datetime | None = None


class InstantMessageResponse(BaseModel):
    id: uuid.UUID
    message: str
    priority: str
    target_roles: str
    is_active: bool
    expires_at: datetime | None
    created_by: uuid.UUID
    created_at: datetime

    class Config:
        from_attributes = True
