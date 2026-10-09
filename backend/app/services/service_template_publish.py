"""
Publishing a new template version safely (Phase 4a).
====================================================
Pure Python, standard library + the template engine. No database.

`analyse_change` answers, BEFORE anything is saved: is this new version valid, what exactly
does it change for customers' prices, and does it break anything the system relies on?

Safeguards (the ones agreed with the owner):
  * A version cannot be published without a valid default price (engine rules).
  * Any change to what a customer would be charged must be confirmed (`price_changes`).
  * A price far out of line with its siblings is a warning the director must acknowledge.
  * System plumbing (`legacy_extras`, `legacy_key_aliases`, `quantity_from`, `fixed_service_type`,
    `schema_version`) cannot be changed from the builder: workers' screens depend on it.
  * `uploaded_file_fields` is derived from the file fields, so a new upload box can never be
    forgotten (and its file always reaches the worker).
  * A field's type cannot change under the same key (old orders keep their meaning).
  * API-provider services (kind="api"): only label / width / placeholder / help / section / order
    may change. Provider fields stay locked. Prices stay under the director's control.
"""
from __future__ import annotations

import copy
import json
from typing import Any

from app.services import service_template_engine as eng

SYSTEM_KEYS = ("schema_version", "legacy_extras", "legacy_key_aliases", "quantity_from", "fixed_service_type")
# What an API-service director may still edit on a field / selector.
API_EDITABLE_FIELD_KEYS = frozenset({"label", "width", "placeholder", "help", "section"})
API_EDITABLE_OPTION_KEYS = frozenset({"label", "description"})
MAX_LISTED_CHANGES = 50


def normalize_schema(schema: dict) -> dict:
    """Server-owned fields: derive `uploaded_file_fields` from the file-type fields (copy, input untouched)."""
    out = copy.deepcopy(schema)
    file_keys = [f["key"] for f in out.get("fields", []) if isinstance(f, dict) and f.get("type") == "file" and isinstance(f.get("key"), str)]
    if file_keys:
        out["uploaded_file_fields"] = file_keys
    else:
        out.pop("uploaded_file_fields", None)
    return out


def _priced_options(schema: dict, rules: list[dict]) -> dict[str, dict[str, int]]:
    """{selection-key: {"unit": price for 1 item, "x5": price for 5 items}} for every option combination,
    plus the no-selection default. Two sizes, so a change to a per-item price is seen too."""
    out: dict[str, dict[str, int]] = {}
    combos: list[dict[str, str]] = [m["selections"] for m in eng.price_matrix(schema, rules)] or []
    combos.append({})
    for sel in combos:
        try:
            out[json.dumps(sel, sort_keys=True)] = {
                "unit": eng.compute_price(rules, sel, 1),
                "x5": eng.compute_price(rules, sel, 5),
            }
        except eng.NoPriceError:
            continue
    return out


def price_changes(prev_schema: dict, prev_rules: list[dict], new_schema: dict, new_rules: list[dict]) -> list[dict]:
    """Every option combination whose customer price differs between two versions."""
    try:
        before = _priced_options(prev_schema, prev_rules)
    except Exception:
        before = {}
    try:
        after = _priced_options(new_schema, new_rules)
    except Exception:
        after = {}
    changes = []
    for k in sorted(set(before) | set(after)):
        b, a = before.get(k), after.get(k)
        if b == a:
            continue
        changes.append({
            "selections": json.loads(k),
            "before_kobo": b["unit"] if b else None,
            "after_kobo": a["unit"] if a else None,
            "per_item_changed": bool(b and a and b["unit"] == a["unit"] and b["x5"] != a["x5"]),
        })
    return changes


def _field_map(schema: dict) -> dict[str, dict]:
    return {f["key"]: f for f in schema.get("fields", []) if isinstance(f, dict) and isinstance(f.get("key"), str)}


def _locked_form(schema: dict) -> dict:
    """Everything an API-service director may NOT change, with the editable bits removed and order ignored."""
    s = copy.deepcopy(schema)
    s["fields"] = sorted(
        ({k: v for k, v in f.items() if k not in API_EDITABLE_FIELD_KEYS} for f in s.get("fields", []) if isinstance(f, dict)),
        key=lambda f: str(f.get("key")),
    )
    sels = []
    for sel in s.get("selectors", []):
        if not isinstance(sel, dict):
            continue
        sel = {k: v for k, v in sel.items() if k != "label"}
        sel["options"] = [{k: v for k, v in o.items() if k not in API_EDITABLE_OPTION_KEYS} for o in sel.get("options", []) if isinstance(o, dict)]
        sels.append(sel)
    s["selectors"] = sorted(sels, key=lambda x: str(x.get("key")))
    if isinstance(s.get("uploaded_file_fields"), list):   # derived from field order; order is not a provider matter
        s["uploaded_file_fields"] = sorted(s["uploaded_file_fields"])
    return s


def analyse_change(
    prev_schema: dict, prev_rules: list[dict], new_schema: dict, new_rules: list[dict], kind: str = "manual",
) -> dict[str, Any]:
    """
    Returns {errors, warnings, price_changes, price_changes_total, added_fields, removed_fields,
             needs_price_confirmation, normalized_schema}.  `errors` non-empty => cannot publish.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(new_schema, dict):
        return {"errors": ["Schema must be an object."], "warnings": [], "price_changes": [], "price_changes_total": 0,
                "added_fields": [], "removed_fields": [], "needs_price_confirmation": False, "normalized_schema": None}

    for key in SYSTEM_KEYS:
        if new_schema.get(key) != prev_schema.get(key):
            errors.append(f"'{key}' is managed by the system and can't be changed here.")

    normalized = normalize_schema(new_schema)
    errors += eng.validate_schema(normalized)
    price_errors, price_warnings = eng.validate_price_rules(new_rules, normalized)
    errors += price_errors
    warnings += price_warnings

    prev_fields, new_fields = _field_map(prev_schema), _field_map(normalized)
    removed = sorted(set(prev_fields) - set(new_fields))
    added = sorted(set(new_fields) - set(prev_fields))
    for k in sorted(set(prev_fields) & set(new_fields)):
        if prev_fields[k].get("type") != new_fields[k].get("type"):
            errors.append(
                f"Field '{k}' changed type ({prev_fields[k].get('type')} to {new_fields[k].get('type')}). "
                "Add a new field instead so older orders keep their meaning."
            )
    for k in removed:
        warnings.append(f"Field '{k}' is removed. New orders won't ask for it; older orders keep their answers.")

    prev_opts = {s["key"]: {str(o["value"]) for o in s.get("options", []) if isinstance(o, dict) and "value" in o}
                 for s in prev_schema.get("selectors", []) if isinstance(s, dict) and "key" in s}
    new_opts = {s["key"]: {str(o["value"]) for o in s.get("options", []) if isinstance(o, dict) and "value" in o}
                for s in normalized.get("selectors", []) if isinstance(s, dict) and "key" in s}
    for sk, vals in prev_opts.items():
        gone = sorted(vals - new_opts.get(sk, set()))
        if gone:
            warnings.append(f"Option(s) {', '.join(gone)} of '{sk}' are removed. Customers can no longer pick them.")

    if kind == "api" and _locked_form(prev_schema) != _locked_form(normalized):
        errors.append("This service is connected to an outside provider. Only labels, order, width, hints and help text can be changed.")

    changes: list[dict] = []
    if not errors:
        changes = price_changes(prev_schema, prev_rules, normalized, new_rules)

    return {
        "errors": errors,
        "warnings": warnings,
        "price_changes": changes[:MAX_LISTED_CHANGES],
        "price_changes_total": len(changes),
        "added_fields": added,
        "removed_fields": removed,
        "needs_price_confirmation": bool(changes),
        "normalized_schema": normalized,
    }


def next_version_number(existing: list[int]) -> int:
    return (max(existing) if existing else 0) + 1
