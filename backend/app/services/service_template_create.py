"""
Creating a brand-new director-built service (Phase 4c).
=======================================================
Pure Python (standard library + the template engine), no database.

A builder-made service has no "original form" to fall back to, so it always runs through the
template flow. It is created SWITCHED OFF; the director edits the form, checks the preview and
switches it on when ready.
"""
from __future__ import annotations

import re
from typing import Any

from app.services import service_template_engine as eng

# The customer-app tiles a manual service can sit under (the others are API / utility tiles).
TILES = ("nimc", "bvn", "tin", "attestation", "cac")

# Words that would collide with routes such as /service-templates/admin/live.
RESERVED_CODES = frozenset({
    "admin", "all", "live", "parity", "pricing", "quote", "my-requests", "enabled", "archive", "preview",
    "publish", "revert", "create",
})

CODE_RE = re.compile(r"^[a-z][a-z0-9_]{2,59}$")
TITLE_MAX = 120
DESCRIPTION_MAX = 500
MAX_PRICE_KOBO = 100_000_000_00   # ₦100 million: a typo guard, not a business rule


def slug_code(title: str) -> str:
    """'Passport Renewal Help!' -> 'passport_renewal_help'. Always starts with a letter, at most 60 chars."""
    code = re.sub(r"[^a-z0-9]+", "_", title.strip().lower()).strip("_")
    if not code:
        code = "service"
    if not code[0].isalpha():
        code = f"service_{code}"
    return code[:60].rstrip("_") or "service"


def unique_code(base: str, taken: set[str]) -> str:
    """base, or base_2, base_3 ... the first that is free and not reserved."""
    code, n = base, 2
    while code in taken or code in RESERVED_CODES:
        suffix = f"_{n}"
        code = f"{base[: 60 - len(suffix)].rstrip('_')}{suffix}"
        n += 1
    return code


def validate_new_service(title: Any, description: Any, category: Any, price_kobo: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(title, str) or not title.strip():
        errors.append("Give the service a name.")
    elif len(title.strip()) > TITLE_MAX:
        errors.append(f"The name can be at most {TITLE_MAX} characters.")
    if description is not None and (not isinstance(description, str) or len(description) > DESCRIPTION_MAX):
        errors.append(f"The description can be at most {DESCRIPTION_MAX} characters.")
    if category not in TILES:
        errors.append("Pick which section of the app this service belongs to.")
    if isinstance(price_kobo, bool) or not isinstance(price_kobo, int) or price_kobo <= 0:
        errors.append("Set a starting price above ₦0.")
    elif price_kobo > MAX_PRICE_KOBO:
        errors.append("That price looks too high. Please check it.")
    return errors


def code_problems(code: str, taken: set[str]) -> list[str]:
    if not CODE_RE.match(code):
        return ["The service id must be 3-60 lowercase letters, digits or underscores, starting with a letter."]
    if code in RESERVED_CODES:
        return [f"'{code}' can't be used as a service id."]
    if code in taken:
        return [f"A service with the id '{code}' already exists."]
    return []


def starter_schema(title: str) -> dict:
    """A small, sensible first form the director then edits. No types: one form, one price."""
    schema = {
        "schema_version": eng.SCHEMA_VERSION,
        "selectors": [],
        "fields": [
            {"key": "full_name", "label": "Full Name", "type": "text", "required": True, "width": "full",
             "section": "Your details", "placeholder": "e.g. John Doe"},
            {"key": "phone_number", "label": "Phone Number", "type": "phone", "required": True, "width": "full",
             "section": "Your details", "placeholder": "e.g. 08012345678"},
            {"key": "details", "label": "What do you need?", "type": "textarea", "required": True, "width": "full",
             "section": "Request", "help": "Tell us what you need done, with any numbers or names that matter."},
            {"key": "supporting_document", "label": "Supporting document (optional)", "type": "file", "required": False,
             "width": "full", "section": "Documents", "accept": "image/*,application/pdf"},
        ],
        "fixed_service_type": "standard",
        "uploaded_file_fields": ["supporting_document"],
    }
    return schema


def starter_rules(price_kobo: int) -> list[dict]:
    return [{"when": {}, "price_kobo": int(price_kobo), "per": "flat"}]


def build_new_service(title: str, description: str | None, category: str, price_kobo: int, taken: set[str],
                      requested_code: str | None = None) -> dict[str, Any]:
    """Validate everything and return {errors, code, schema, rules}. Nothing is written."""
    errors = validate_new_service(title, description, category, price_kobo)
    if errors:
        return {"errors": errors, "code": None, "schema": None, "rules": None}
    code = requested_code.strip().lower() if requested_code and requested_code.strip() else unique_code(slug_code(title), taken)
    errors = code_problems(code, taken)
    schema, rules = starter_schema(title), starter_rules(price_kobo)
    errors += eng.validate_schema(schema)
    price_errors, _ = eng.validate_price_rules(rules, schema)
    errors += price_errors
    return {"errors": errors, "code": code, "schema": schema, "rules": rules}


def from_price_kobo(schema: dict, rules: list[dict]) -> int | None:
    """The lowest price a customer could be charged for one item: the 'From ₦X' on the service card."""
    prices = [m["price_kobo"] for m in eng.price_matrix(schema, rules)]
    if not prices:
        try:
            prices = [eng.compute_price(rules, {}, 1)]
        except eng.NoPriceError:
            return None
    return min(prices) if prices else None
