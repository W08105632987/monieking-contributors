import base64
import pytest
from fastapi import HTTPException
from app.schemas.promo_banner import (
    validate_promo_link,
    validate_promo_layout,
    PromoBannerCreate,
    ALLOWED_INTERNAL_ROUTES,
)
from app.api.v1.routes.promo_banners import validate_and_upload_banner_image


def test_validate_promo_link_none():
    assert validate_promo_link("none", None) is None
    assert validate_promo_link("none", "") is None

    with pytest.raises(ValueError, match="link_target must be empty"):
        validate_promo_link("none", "https://example.com")

    with pytest.raises(ValueError, match="link_target must be empty"):
        validate_promo_link("none", "/customer/wallet")


def test_validate_promo_link_internal_route():
    # Valid route in allowlist
    assert validate_promo_link("internal_route", "/customer/wallet") == "/customer/wallet"
    assert validate_promo_link("internal_route", "/customer/cards") == "/customer/cards"
    assert validate_promo_link("internal_route", "/worker/dashboard") == "/worker/dashboard"

    # Missing target
    with pytest.raises(ValueError, match="link_target is required"):
        validate_promo_link("internal_route", None)
    with pytest.raises(ValueError, match="link_target is required"):
        validate_promo_link("internal_route", "")

    # Invalid route (not in App.tsx allowlist)
    with pytest.raises(ValueError, match="Invalid internal route"):
        validate_promo_link("internal_route", "/admin/super-secret")

    with pytest.raises(ValueError, match="Invalid internal route"):
        validate_promo_link("internal_route", "javascript:alert(1)")


def test_validate_promo_link_external_url():
    # Valid https URL
    assert validate_promo_link("external_url", "https://monieking.com/promo") == "https://monieking.com/promo"

    # Non-https URLs must be rejected
    with pytest.raises(ValueError, match="External URL must start with 'https://'"):
        validate_promo_link("external_url", "http://insecure.com")

    # Attack vectors must be rejected
    with pytest.raises(ValueError, match="External URL must start with 'https://'"):
        validate_promo_link("external_url", "javascript:alert(1)")

    with pytest.raises(ValueError, match="External URL must start with 'https://'"):
        validate_promo_link("external_url", "data:text/html,<script>alert(1)</script>")

    with pytest.raises(ValueError, match="External URL must start with 'https://'"):
        validate_promo_link("external_url", "ftp://example.com")


def test_validate_promo_layout():
    # gradient_only needs no image
    validate_promo_layout("gradient_only", None)
    validate_promo_layout("gradient_only", "")

    # full_bleed_image requires image
    with pytest.raises(ValueError, match="An image is required"):
        validate_promo_layout("full_bleed_image", None)
    with pytest.raises(ValueError, match="An image is required"):
        validate_promo_layout("full_bleed_image", "  ")

    validate_promo_layout("full_bleed_image", "https://supabase.co/promo.jpg")

    # split_image_text requires image
    with pytest.raises(ValueError, match="An image is required"):
        validate_promo_layout("split_image_text", None)

    validate_promo_layout("split_image_text", "https://supabase.co/promo.jpg")


def test_promo_banner_create_schema():
    # Valid gradient_only
    data = {
        "title": "Summer promo",
        "layout_style": "gradient_only",
        "link_type": "none",
    }
    banner = PromoBannerCreate(**data)
    assert banner.layout_style == "gradient_only"
    assert banner.link_target is None

    # Valid internal route
    data_internal = {
        "title": "Wallet promo",
        "link_type": "internal_route",
        "link_target": "/customer/wallet",
    }
    banner_internal = PromoBannerCreate(**data_internal)
    assert banner_internal.link_target == "/customer/wallet"

    # Reject full_bleed_image without image
    with pytest.raises(ValueError):
        PromoBannerCreate(
            title="Image promo",
            layout_style="full_bleed_image",
            link_type="none",
        )

    # Reject invalid external url
    with pytest.raises(ValueError):
        PromoBannerCreate(
            title="External promo",
            link_type="external_url",
            link_target="javascript:alert(1)",
        )


@pytest.mark.asyncio
async def test_image_magic_bytes_validation():
    # Invalid magic bytes (plain text masquerading as png)
    fake_png = "data:image/png;base64," + base64.b64encode(b"not an image").decode()
    with pytest.raises(HTTPException) as exc:
        await validate_and_upload_banner_image(fake_png)
    assert exc.value.status_code == 400
    assert "Invalid image format" in exc.value.detail

    # Oversized payload (> 5MB)
    large_payload = b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024 + 10)
    encoded_large = "data:image/jpeg;base64," + base64.b64encode(large_payload).decode()
    with pytest.raises(HTTPException) as exc_large:
        await validate_and_upload_banner_image(encoded_large)
    assert exc_large.value.status_code == 400
    assert "Image too large" in exc_large.value.detail
