"""
Manual-service pricing rules, kept free of framework imports so they can be
unit-tested on their own and reused by the charge, the quote endpoint and the
director pricing screen. ONE place decides what a service costs.

`PRICE_MAP` and `get_price` are moved here unchanged from
app/api/v1/routes/manual_services.py (Phase 1 of the services rebuild); the
golden fixture tests/unit/golden/manual_pricing_golden.json records what they
returned before the move, and tests/unit/test_manual_pricing.py proves the
numbers did not change.
"""
from __future__ import annotations

import copy
import json
from typing import Any

# ─── Pricing constants (in kobo) ──────────────────────────────────────────────
PRICE_MAP: dict[str, dict[str, int]] = {
    "nin_modification": {
        "update_name":       500_000,  # ₦5,000
        "update_phone":      500_000,  # ₦5,000
        "update_dob":        500_000,  # ₦5,000
        "update_address":    500_000,  # ₦5,000
        "update_name_dob":   500_000,  # ₦5,000
        "update_name_phone": 500_000,  # ₦5,000
        "default":           500_000,
    },
    "nin_validation": {
        "no_record":               100_000,  # ₦1,000
        "sim_validation":          100_000,  # ₦1,000
        "vnin_validation":         120_000,  # ₦1,200
        "update_records":          100_000,  # ₦1,000
        "bank_validation":         100_000,  # ₦1,000
        "modification_validation": 120_000,  # ₦1,200
        "photographic_error":      120_000,  # ₦1,200
        "single":                  100_000,  # ₦1,000
        "default":                 100_000,
    },
    "bvn_modification": {
        # Bank-specific prices for single modifications (name, phone, dob, address)
        "agency":        600_000,    # ₦6,000
        "access_bank":   950_000,    # ₦9,500
        "boa_bank":      700_000,    # ₦7,000
        "first_bank":    750_000,    # ₦7,500
        "gtbank":        800_000,    # ₦8,000
        "heritage_bank": 700_000,    # ₦7,000
        "jaiz_bank":     1_000_000,  # ₦10,000
        "keystone_bank": 700_000,    # ₦7,000
        # Combination updates are fixed ₦9,000
        "update_name_dob":     900_000,
        "update_name_phone":   900_000,
        "update_name_address": 900_000,
        "update_dob_phone":    900_000,
        "default":             700_000,
    },
    "bvn_retrieval": {
        "phone_number":      70_000,   # ₦700
        "crm_investigation": 200_000,  # ₦2,000
        "default":           70_000,
    },
    "bvn_license": {
        "default": 700_000,  # ₦7,000
    },
    "nin_delinking": {
        "self_service_delinking": 350_000,  # ₦3,500
        "email_retrieval":        350_000,  # ₦3,500
        "default":                350_000,
    },
    "self_service_modification": {
        "update_name":       450_000,  # ₦4,500
        "update_phone":      450_000,  # ₦4,500
        "update_address":    450_000,  # ₦4,500
        "update_name_phone": 90_000,   # ₦900
        "update_name_dob":   500_000,  # ₦5,000
        "default":           450_000,
    },
    "modification_after_delinking": {
        "update_name":       450_000,  # ₦4,500
        "update_phone":      450_000,  # ₦4,500
        "update_dob":        450_000,  # ₦4,500
        "update_address":    450_000,  # ₦4,500
        "update_name_dob":   450_000,  # ₦4,500
        "update_name_phone": 450_000,  # ₦4,500
        "default":           450_000,
    },
    "tin_registration": {
        "individual": 150_000,  # ₦1,500
        "company":    450_000,  # ₦4,500
        "default":    150_000,
    },
    "nin_attestation": {
        "default": 1_500_000,  # ₦15,000
    },
    "cac_registration": {
        "business_name": 3_500_000,  # ₦35,000
        "company":       5_000_000,  # ₦50,000
        "default":       3_500_000,
    },
}


def get_price(
    category: str,
    service_type: str,
    enrollment_bank: str | None = None,
    bulk_count: int = 1,
    custom_map: dict | None = None,
) -> int:
    source_map = custom_map or PRICE_MAP
    category_map = source_map.get(category, {})

    # NIN Validation Bulk mode
    if category == "nin_validation" and bulk_count > 1:
        unit_price = category_map.get(service_type, category_map.get("default", 100_000))
        return unit_price * bulk_count

    # BVN Modification dynamic pricing by enrollment bank
    if category == "bvn_modification":
        # Check if combination update
        if service_type in ["update_name_dob", "update_name_phone", "update_name_address", "update_dob_phone"]:
            return category_map.get(service_type, 900_000)
        # Single update: use enrollment_bank if provided
        if enrollment_bank:
            bank_key = enrollment_bank.lower().replace(" ", "_")
            if bank_key in category_map:
                return category_map[bank_key]
        return category_map.get(service_type, category_map.get("default", 700_000))

    return category_map.get(service_type, category_map.get("default", 0))


# ─── Service codes that share a price category ───────────────────────────────
# The customer-facing catalog uses these codes, while the charge looks prices up
# by the category the form sends. Before this map existed the director screen
# saved prices under the catalog code, so for these services the saved price
# was never the one the charge read.
CATEGORY_ALIASES: dict[str, str] = {
    "attestation": "nin_attestation",
    "bvn_license_onboarding": "bvn_license",
    "bvn_retrieval_phone": "bvn_retrieval",
    "bvn_retrieval_crm": "bvn_retrieval",
    "bvn_self_service_delinking": "nin_delinking",
}

# The static "From ₦X" labels the backend used to serve for every card. Several
# no longer matched what is charged (e.g. attestation said ₦3,000, charges
# ₦15,000). They are kept ONLY so a stored label that is just a frozen copy of
# one of these is recognised and replaced by the live price.
LEGACY_DEFAULT_COVER_LABELS: dict[str, str] = {
    "nin_modification": "From ₦5,000",
    "nin_validation": "From ₦700",
    "nin_delinking": "From ₦3,500",
    "bvn_modification": "From ₦6,000",
    "bvn_retrieval": "From ₦700",
    "bvn_license_onboarding": "From ₦15,000",
    "bvn_license": "From ₦15,000",
    "tin_registration": "From ₦2,000",
    "attestation": "From ₦3,000",
    "nin_attestation": "From ₦3,000",
    "cac_registration": "From ₦15,000",
    "self_service_modification": "From ₦5,000",
}


def resolve_category(code: str) -> str:
    """Catalog code -> the price category the charge uses."""
    return CATEGORY_ALIASES.get(code, code)


def merge_price_map(stored_json: str | None) -> dict[str, dict[str, int]]:
    """Built-in prices overlaid with the director's saved prices.

    Always returns a fresh deep copy. (The previous version could hand back the
    module-level PRICE_MAP itself and the PATCH route then edited it in place,
    silently changing the in-memory defaults for the whole process.)
    """
    merged = copy.deepcopy(PRICE_MAP)
    if not stored_json:
        return merged
    try:
        custom = json.loads(stored_json)
    except Exception:
        return merged
    if not isinstance(custom, dict):
        return merged
    for cat, sub in custom.items():
        if not isinstance(sub, dict):
            continue
        key = resolve_category(cat)
        merged.setdefault(key, {})
        merged[key] = {**merged[key], **sub}
    return merged


def is_known_category(category: str, price_map: dict[str, dict[str, int]]) -> bool:
    return category in price_map


def starting_price(category: str, price_map: dict[str, dict[str, int]]) -> int | None:
    """Lowest positive price a customer can be charged in this category (kobo)."""
    tiers = price_map.get(resolve_category(category))
    if not tiers:
        return None
    named = [v for k, v in tiers.items() if k != "default" and isinstance(v, int) and v > 0]
    if named:
        return min(named)
    default = tiers.get("default")
    return default if isinstance(default, int) and default > 0 else None


def format_from_label(kobo: int) -> str:
    naira = kobo / 100
    return f"From ₦{naira:,.0f}" if naira == int(naira) else f"From ₦{naira:,.2f}"


def effective_cover_labels(
    price_map: dict[str, dict[str, int]],
    stored_labels: dict[str, Any] | None,
) -> dict[str, str]:
    """The label shown on each service card.

    A label the director typed wins. Otherwise (nothing saved, an empty string,
    or just a frozen copy of an old built-in label) the label is computed from
    the live prices, so the card can no longer disagree with the charge.
    """
    stored = stored_labels if isinstance(stored_labels, dict) else {}
    codes = set(LEGACY_DEFAULT_COVER_LABELS) | set(price_map) | set(CATEGORY_ALIASES)
    out: dict[str, str] = {}
    for code in sorted(codes):
        explicit = stored.get(code)
        explicit = explicit.strip() if isinstance(explicit, str) else ""
        if explicit and explicit != LEGACY_DEFAULT_COVER_LABELS.get(code):
            out[code] = explicit
            continue
        start = starting_price(code, price_map)
        if start is not None:
            out[code] = format_from_label(start)
    return out


def normalize_pricing_update(incoming: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Validate a director price edit and file it under the category the charge reads.

    Raises ValueError (with a message safe to show the director) on a price that
    is not a whole number of kobo greater than zero.
    """
    clean: dict[str, dict[str, int]] = {}
    for cat, sub in incoming.items():
        if not isinstance(sub, dict):
            continue
        key = resolve_category(cat)
        for tier, value in sub.items():
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"Price for {cat} / {tier} must be a whole number of kobo.")
            if value <= 0:
                raise ValueError(f"Price for {cat} / {tier} must be greater than ₦0.")
            clean.setdefault(key, {})[tier] = value
    return clean
