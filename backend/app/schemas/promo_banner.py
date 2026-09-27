from datetime import datetime
from pydantic import BaseModel, Field, model_validator
import uuid

# Explicit allowlist of valid in-app destinations defined in apps/web/src/App.tsx
ALLOWED_INTERNAL_ROUTES: set[str] = {
    # Customer routes
    "/customer/dashboard",
    "/customer/cards",
    "/customer/wallet",
    "/customer/wallet/transactions",
    "/customer/withdrawals/new",
    "/customer/services",
    "/customer/services/history",
    "/customer/airtime-data",
    "/customer/bill-payments",
    "/customer/education-payments",
    "/customer/disputes",
    "/customer/notifications",
    "/customer/profile",
    # Officer routes
    "/officer/dashboard",
    "/officer/customers",
    "/officer/wallet",
    "/officer/wallet/transactions",
    "/officer/notifications",
    "/officer/profile",
    "/officer/disputes",
    # Service Worker routes
    "/worker/dashboard",
    "/worker/my-jobs",
    "/worker/earnings",
    "/worker/disputes",
    "/worker/profile",
    "/worker/notifications",
}


def validate_promo_link(link_type: str, link_target: str | None) -> str | None:
    """
    Validates link_type and link_target combination:
      - 'none': link_target must be null/empty.
      - 'internal_route': link_target must be in ALLOWED_INTERNAL_ROUTES.
      - 'external_url': link_target must strictly begin with 'https://'.
    """
    if link_type == "none":
        if link_target and link_target.strip():
            raise ValueError("link_target must be empty or null when link_type is 'none'")
        return None

    if link_type == "internal_route":
        if not link_target or not link_target.strip():
            raise ValueError("link_target is required when link_type is 'internal_route'")
        target = link_target.strip()
        if target not in ALLOWED_INTERNAL_ROUTES:
            allowed_list = sorted(list(ALLOWED_INTERNAL_ROUTES))
            raise ValueError(f"Invalid internal route '{target}'. Allowed options: {allowed_list}")
        return target

    if link_type == "external_url":
        if not link_target or not link_target.strip():
            raise ValueError("link_target is required when link_type is 'external_url'")
        target = link_target.strip()
        if not target.startswith("https://"):
            raise ValueError("External URL must start with 'https://' (e.g. https://monieking.com)")
        return target

    raise ValueError(f"Unsupported link_type '{link_type}'")


def validate_promo_layout(layout_style: str, image_url: str | None) -> None:
    """
    Requires an image_url when using full_bleed_image or split_image_text layouts.
    """
    if layout_style in ("full_bleed_image", "split_image_text"):
        if not image_url or not str(image_url).strip():
            raise ValueError(f"An image is required for '{layout_style}' layout style")


class BannerImageUploadRequest(BaseModel):
    image_base64: str = Field(..., min_length=1, description="Base64 data URL (e.g. data:image/png;base64,...)")


class PromoBannerCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)
    gradient_from: str = Field(default="#052E16", pattern="^#[0-9A-Fa-f]{6}$")
    gradient_to: str = Field(default="#D97706", pattern="^#[0-9A-Fa-f]{6}$")
    layout_style: str = Field(default="gradient_only", pattern="^(gradient_only|full_bleed_image|split_image_text)$")
    image_url: str | None = None
    image_base64: str | None = None
    image_focal_x: float = Field(default=0.5, ge=0.0, le=1.0)
    image_focal_y: float = Field(default=0.5, ge=0.0, le=1.0)
    link_type: str = Field(default="none", pattern="^(none|internal_route|external_url)$")
    link_target: str | None = None
    display_order: int = 0
    start_at: datetime | None = None
    end_at: datetime | None = None
    target_roles: str = Field(default="all")

    @model_validator(mode="after")
    def validate_fields(self):
        self.link_target = validate_promo_link(self.link_type, self.link_target)
        effective_image = self.image_url or self.image_base64
        validate_promo_layout(self.layout_style, effective_image)
        return self


class PromoBannerUpdate(BaseModel):
    title: str | None = None
    subtitle: str | None = None
    gradient_from: str | None = Field(default=None, pattern="^#[0-9A-Fa-f]{6}$")
    gradient_to: str | None = Field(default=None, pattern="^#[0-9A-Fa-f]{6}$")
    layout_style: str | None = Field(default=None, pattern="^(gradient_only|full_bleed_image|split_image_text)$")
    image_url: str | None = None
    image_base64: str | None = None
    image_focal_x: float | None = Field(default=None, ge=0.0, le=1.0)
    image_focal_y: float | None = Field(default=None, ge=0.0, le=1.0)
    link_type: str | None = Field(default=None, pattern="^(none|internal_route|external_url)$")
    link_target: str | None = None
    display_order: int | None = None
    is_active: bool | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    target_roles: str | None = None

    @model_validator(mode="after")
    def validate_fields(self):
        # If both link_type and link_target are supplied, validate immediately
        if self.link_type is not None and self.link_target is not None:
            self.link_target = validate_promo_link(self.link_type, self.link_target)
        elif self.link_type == "none":
            self.link_target = None
        return self


class PromoBannerResponse(BaseModel):
    id: uuid.UUID
    title: str
    subtitle: str | None
    gradient_from: str
    gradient_to: str
    layout_style: str = "gradient_only"
    image_url: str | None = None
    image_focal_x: float = 0.5
    image_focal_y: float = 0.5
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
