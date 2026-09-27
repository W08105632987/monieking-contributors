from datetime import datetime
from pydantic import BaseModel, Field
import uuid


class PromoBannerCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)
    gradient_from: str = Field(default="#052E16", pattern="^#[0-9A-Fa-f]{6}$")
    gradient_to: str = Field(default="#D97706", pattern="^#[0-9A-Fa-f]{6}$")
    link_type: str = Field(default="none", pattern="^(none|internal_route|external_url)$")
    link_target: str | None = None
    display_order: int = 0
    start_at: datetime | None = None
    end_at: datetime | None = None
    target_roles: str = Field(default="all")


class PromoBannerUpdate(BaseModel):
    title: str | None = None
    subtitle: str | None = None
    gradient_from: str | None = Field(default=None, pattern="^#[0-9A-Fa-f]{6}$")
    gradient_to: str | None = Field(default=None, pattern="^#[0-9A-Fa-f]{6}$")
    link_type: str | None = Field(default=None, pattern="^(none|internal_route|external_url)$")
    link_target: str | None = None
    display_order: int | None = None
    is_active: bool | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    target_roles: str | None = None


class PromoBannerResponse(BaseModel):
    id: uuid.UUID
    title: str
    subtitle: str | None
    gradient_from: str
    gradient_to: str
    link_type: str
    link_target: str | None
    display_order: int
    is_active: bool
    start_at: datetime | None
    end_at: datetime | None
    target_roles: str
    created_by: uuid.UUID
    created_at: datetime
    impressions: int = 0
    clicks: int = 0

    class Config:
        from_attributes = True
