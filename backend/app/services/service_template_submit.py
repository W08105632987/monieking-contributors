"""
Turn a customer's submission into a validated, priced, stored request using a
service template (Phase 3). Pure Python, standard library only: no database, so
every rule here is unit-tested without a server.

What it guarantees (and the old per-form code did NOT):
  * required fields are enforced on the server, not just by the screen;
  * answers for fields that are hidden for the chosen option are dropped;
  * keys the template doesn't define are dropped (no spoofed system keys);
  * the number of NINs in a bulk validation is counted from the NINs themselves,
    not taken from a number the browser sends (the old code trusted that number,
    so a tampered request could pay for 1 and submit 50);
  * the stored form_data keeps the same keys workers, receipts and disputes already read.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.services import service_template_engine as eng

MAX_TEXT_LENGTH = 5000
NIN_RE = re.compile(r"^\d{11}$")


@dataclass
class PreparedSubmission:
    errors: list[str] = field(default_factory=list)
    price_kobo: int = 0
    form_data: dict[str, Any] = field(default_factory=dict)
    uploaded_files: list[str] = field(default_factory=list)
    service_type: str = ""
    enrollment_bank: str | None = None
    bulk_count: int = 1


def _selector_keys(schema: dict) -> list[str]:
    return [s["key"] for s in schema.get("selectors", [])]


def _parse_nin_list(value: Any) -> list[str]:
    if value is None:
        return []
    items = value.splitlines() if isinstance(value, str) else list(value)
    out = []
    for it in items:
        digits = re.sub(r"\D", "", str(it))
        if NIN_RE.match(digits):
            out.append(digits)
    return out


def prepare_submission(
    schema: dict,
    price_rules: list[dict],
    *,
    service_type: str | None,
    enrollment_bank: str | None,
    form_data: dict[str, Any] | None,
) -> PreparedSubmission:
    out = PreparedSubmission()
    answers: dict[str, Any] = dict(form_data or {})

    # selectors: service_type / enrollment_bank arrive top-level, the rest inside form_data
    fixed = schema.get("fixed_service_type")
    answers["service_type"] = fixed if fixed else (service_type or "")
    if enrollment_bank:
        answers["enrollment_bank"] = enrollment_bank
    else:
        answers.pop("enrollment_bank", None)

    for sel in schema.get("selectors", []):
        key = sel["key"]
        got = answers.get(key)
        valid = {str(o["value"]) for o in sel.get("options", [])}
        if eng._is_blank(got):
            if sel.get("required", True):
                out.errors.append(f"{sel['label']} is required.")
        elif str(got) not in valid:
            out.errors.append(f"{sel['label']}: '{got}' is not an available option.")

    # numbered NINs (bulk validation): parse before the generic checks
    qty = schema.get("quantity_from")
    bulk_count = 1
    nin_lists: dict[str, list[str]] = {}
    for f in schema.get("fields", []):
        if f.get("type") == "nin_list":
            parsed = _parse_nin_list(answers.get(f["key"]))
            nin_lists[f["key"]] = parsed
            answers[f["key"]] = parsed
            cap = f.get("max_items")
            if cap and len(parsed) > cap:
                out.errors.append(f"{f['label']}: at most {cap} NINs per request.")
    if qty:
        wanted = qty.get("when", {})
        if all(str(answers.get(k)) == str(v) for k, v in wanted.items()):
            bulk_count = max(1, len(nin_lists.get(qty["field"], [])))

    # required fields / formats (only for fields visible for these answers)
    out.errors.extend(f"{p}." if "(must be" in p else f"{p} is required." for p in eng.missing_required(schema, answers))

    # dropdown values must be one of the offered options; text length is capped
    for f in eng.visible_fields(schema, answers):
        v = answers.get(f["key"])
        if eng._is_blank(v):
            continue
        if f["type"] == "select":
            allowed = {str(o["value"]) if isinstance(o, dict) else str(o) for o in f.get("options", [])}
            if str(v) not in allowed:
                out.errors.append(f"{f['label']}: '{v}' is not an available option.")
        if f["type"] not in ("file", "nin_list") and isinstance(v, str) and len(v) > MAX_TEXT_LENGTH:
            out.errors.append(f"{f['label']} is too long.")
        if f["type"] == "file" and not isinstance(v, str):
            out.errors.append(f"{f['label']}: invalid upload.")

    if out.errors:
        return out

    cleaned = eng.strip_hidden(schema, answers)

    # price: first matching rule wins (selections = every selector's chosen value)
    selections = {k: answers.get(k) for k in _selector_keys(schema)}
    try:
        out.price_kobo = eng.compute_price(price_rules, selections, bulk_count)
    except eng.NoPriceError:
        out.errors.append("This option has no price set, so it can't be ordered right now.")
        return out

    # stored form_data: selector keys removed, legacy extras re-added so readers see the same keys
    stored = {k: v for k, v in cleaned.items() if k not in _selector_keys(schema)}
    for extra in schema.get("legacy_extras", []):
        src = extra["from"]
        raw = answers.get(src)
        if eng._is_blank(raw):
            continue
        if extra.get("as") == "label":
            stored[extra["key"]] = eng.option_label(schema, src, str(raw)) or str(raw)
        else:
            stored[extra["key"]] = raw
    for new_key, old_key in (schema.get("legacy_key_aliases") or {}).items():
        if new_key in stored:
            stored[old_key] = stored.pop(new_key)

    if qty:
        field_key = qty["field"]
        in_bulk = bulk_count > 1 or all(str(answers.get(k)) == str(v) for k, v in qty.get("when", {}).items())
        ninlist = nin_lists.get(field_key, [])
        stored.pop(field_key, None)
        stored["bulk_nins"] = ninlist if in_bulk else []
        stored["count"] = len(ninlist) if in_bulk else 1
        if in_bulk:
            stored["nin"] = ninlist[0] if ninlist else ""

    out.form_data = stored
    out.uploaded_files = [
        str(cleaned[k]) for k in schema.get("uploaded_file_fields", []) if cleaned.get(k)
    ]
    out.service_type = str(answers["service_type"])
    out.enrollment_bank = str(answers["enrollment_bank"]) if answers.get("enrollment_bank") else None
    out.bulk_count = bulk_count
    return out
