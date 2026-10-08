"""
Parity check: does the template price engine charge exactly what the existing
charge function (manual_pricing.get_price) charges, for every option a customer
could pick? Pure function; used by the tests, by the seeding script (it refuses
to seed on any mismatch) and by the director-only /service-templates/admin/parity
endpoint (a read-only runtime check against live data).
"""
from __future__ import annotations

from typing import Any

from app.services import manual_pricing as mp
from app.services import service_template_engine as eng


def _selector_values(schema: dict, key: str) -> list[str | None]:
    for s in schema.get("selectors", []):
        if s.get("key") == key:
            return [str(o["value"]) for o in s.get("options", [])]
    return [None]


def parity_report(
    templates: dict[str, tuple[dict, list[dict]]],
    price_map: dict[str, dict[str, int]],
) -> dict[str, Any]:
    """templates: {service_code: (schema, price_rules)}. Returns {checked, mismatches}."""
    checked = 0
    mismatches: list[dict] = []
    for code, (schema, rules) in templates.items():
        category = mp.resolve_category(code)
        types = _selector_values(schema, "service_type")
        if types == [None] and schema.get("fixed_service_type"):
            types = [schema["fixed_service_type"]]
        banks = _selector_values(schema, "enrollment_bank")
        bulks = [1, 2, 5] if category == "nin_validation" else [1]
        for t in types:
            for b in banks:
                for n in bulks:
                    checked += 1
                    expected = mp.get_price(
                        category, t or "", enrollment_bank=b, bulk_count=n, custom_map=price_map,
                    )
                    sel = {"service_type": t}
                    if b:
                        sel["enrollment_bank"] = b
                    try:
                        got: int | None = eng.compute_price(rules, sel, n)
                    except eng.NoPriceError:
                        got = None
                    if got != expected:
                        mismatches.append({
                            "service": code, "service_type": t, "enrollment_bank": b,
                            "bulk_count": n, "charge_function": expected, "template_engine": got,
                        })
    return {"checked": checked, "mismatches": mismatches}
