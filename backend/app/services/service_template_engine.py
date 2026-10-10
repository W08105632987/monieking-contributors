"""
Service template engine (Phase 2 of the services rebuild).
==========================================================
Pure Python, standard library only, no database. Everything the director-built
templates need to be *safe* lives here so it can be tested without a server:

  * validate_schema        - field/selector rules (permanent keys, reserved names, ...)
  * validate_price_rules   - a template must have a catch-all price > 0 to be published
  * compute_price          - ordered rules, FIRST MATCH WINS (the one price function)
  * visible_fields / missing_required / strip_hidden - server-side form validation

Template schema (JSON, versioned, immutable once published):
{
  "schema_version": 1,
  "selectors": [   # the "types" a customer picks first; they drive visibility and price
    {"key": "service_type", "label": "...", "required": true,
     "options": [{"value": "update_name", "label": "Update Name", "description": "..."}]}
  ],
  "fields": [
    {"key": "first_name", "label": "First Name", "type": "text", "required": true,
     "width": "half", "section": "Personal Information", "sensitive": false,
     "visible_when": [{"field": "service_type", "in": ["update_name"]}], ...}
  ],
  "legacy_extras": [{"key": "selected_modification", "from": "service_type", "as": "value"}]
}

Price rules (ordered list, first match wins; the LAST rule must be a catch-all):
  [{"when": {"service_type": ["update_name"]}, "price_kobo": 500000, "per": "flat"},
   {"when": {}, "price_kobo": 500000, "per": "flat"}]
  "per": "bulk_count" multiplies the price by the number of items (min 1).
"""
from __future__ import annotations

import re
from typing import Any

SCHEMA_VERSION = 1

FIELD_TYPES = {"text", "textarea", "phone", "email", "date", "select", "digits", "file", "nin_list"}
WIDTHS = {"full", "half", "third"}
PER_MODES = {"flat", "bulk_count"}

MAX_FIELDS = 150
MAX_OPTIONS = 100
MAX_RULES = 200
PLACEHOLDER_MAX = 120
HELP_MAX = 300

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,59}$")

# Keys the platform writes into form_data (or the request itself). A director-made
# field may never use them, otherwise it could overwrite or spoof a system value.
RESERVED_KEYS = frozenset({
    "id", "user_id", "price_kobo", "status", "consent_given", "service_category",
    "service_type", "enrollment_bank", "bulk_count", "uploaded_files",
    "referral_code", "referred_worker", "referred_worker_id", "submitted_by_officer_id",
    "worker_status", "worker_response", "worker_remarks", "worker_additional_info",
    "worker_result_file_url", "worker_commission_kobo", "form_data",
    "created_at", "updated_at", "claimed_at", "completed_at", "expires_at",
    "template_version_id", "withdrawal_password", "transaction_pin",
})

# Selector keys are allowed to use the two reserved names the backend already
# understands, because the charge reads them.
SELECTOR_KEYS_ALLOWED_RESERVED = frozenset({"service_type", "enrollment_bank"})

# Price rules may match on these dimensions plus any selector key in the schema.
BUILTIN_PRICE_DIMENSIONS = frozenset({"service_type", "enrollment_bank"})


class NoPriceError(ValueError):
    """No rule matched (cannot happen for a published template: it has a catch-all)."""


# ─── Helpers ─────────────────────────────────────────────────────────────────

def normalize_value(value: Any) -> str:
    """Same normalisation the old charge used for banks: lowercase, spaces -> '_'."""
    return str(value).strip().lower().replace(" ", "_")


def _option_value(opt: Any) -> str:
    return str(opt["value"]) if isinstance(opt, dict) else str(opt)


def _is_blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or v == [] or v == {}


# ─── Schema validation ───────────────────────────────────────────────────────

def validate_schema(schema: Any) -> list[str]:
    """Return a list of human-readable problems. Empty list means valid."""
    errors: list[str] = []
    if not isinstance(schema, dict):
        return ["Schema must be an object."]
    selectors = schema.get("selectors", [])
    fields = schema.get("fields", [])
    if not isinstance(selectors, list) or not isinstance(fields, list):
        return ["'selectors' and 'fields' must be lists."]
    if len(fields) + len(selectors) > MAX_FIELDS:
        errors.append(f"Too many fields (max {MAX_FIELDS}).")

    seen: dict[str, str] = {}

    def claim(key: Any, where: str, allow_reserved: bool) -> bool:
        if not isinstance(key, str) or not KEY_RE.match(key):
            errors.append(f"{where}: key {key!r} must be lowercase letters, digits or underscores, starting with a letter (max 60).")
            return False
        if key in RESERVED_KEYS and not (allow_reserved and key in SELECTOR_KEYS_ALLOWED_RESERVED):
            errors.append(f"{where}: key '{key}' is reserved by the system.")
            return False
        if key in seen:
            errors.append(f"{where}: key '{key}' is used twice.")
            return False
        seen[key] = where
        return True

    selector_values: dict[str, set[str]] = {}
    for i, sel in enumerate(selectors):
        where = f"selector #{i + 1}"
        if not isinstance(sel, dict):
            errors.append(f"{where}: must be an object.")
            continue
        if not claim(sel.get("key"), where, allow_reserved=True):
            continue
        if not str(sel.get("label", "")).strip():
            errors.append(f"{where} ('{sel['key']}'): label is required.")
        options = sel.get("options")
        if not isinstance(options, list) or not options:
            errors.append(f"{where} ('{sel['key']}'): needs at least one option.")
            continue
        if len(options) > MAX_OPTIONS:
            errors.append(f"{where} ('{sel['key']}'): too many options (max {MAX_OPTIONS}).")
        vals: set[str] = set()
        for o in options:
            if not isinstance(o, dict) or not str(o.get("value", "")).strip() or not str(o.get("label", "")).strip():
                errors.append(f"{where} ('{sel['key']}'): every option needs a value and a label.")
                continue
            v = str(o["value"])
            if v in vals:
                errors.append(f"{where} ('{sel['key']}'): option '{v}' is listed twice.")
            vals.add(v)
        selector_values[sel["key"]] = vals

    field_keys: list[str] = []
    for i, f in enumerate(fields):
        where = f"field #{i + 1}"
        if not isinstance(f, dict):
            errors.append(f"{where}: must be an object.")
            continue
        key = f.get("key")
        if not claim(key, where, allow_reserved=False):
            continue
        field_keys.append(key)
        where = f"field '{key}'"
        if not str(f.get("label", "")).strip():
            errors.append(f"{where}: label is required.")
        ftype = f.get("type")
        if ftype not in FIELD_TYPES:
            errors.append(f"{where}: type {ftype!r} is not supported.")
        if f.get("width", "full") not in WIDTHS:
            errors.append(f"{where}: width must be one of {sorted(WIDTHS)}.")
        if ftype == "select":
            opts = f.get("options")
            if not isinstance(opts, list) or not opts:
                errors.append(f"{where}: a dropdown needs at least one option.")
            elif len(opts) > MAX_OPTIONS:
                errors.append(f"{where}: too many options (max {MAX_OPTIONS}).")
        if ftype == "digits":
            n = f.get("length")
            if n is not None and (isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= 30):
                errors.append(f"{where}: length must be a whole number from 1 to 30.")
        if "sensitive" in f and not isinstance(f["sensitive"], bool):
            errors.append(f"{where}: 'sensitive' must be true or false.")
        for text_key, limit in (("placeholder", PLACEHOLDER_MAX), ("help", HELP_MAX)):
            if text_key in f and (not isinstance(f[text_key], str) or len(f[text_key]) > limit):
                errors.append(f"{where}: '{text_key}' must be text of at most {limit} characters.")

    # visible_when: refer only to existing keys, never to itself, no cycles.
    graph: dict[str, set[str]] = {}
    all_keys = set(seen)
    for f in fields:
        if not isinstance(f, dict) or not isinstance(f.get("key"), str):
            continue
        key = f["key"]
        conds = f.get("visible_when", [])
        if not isinstance(conds, list):
            errors.append(f"field '{key}': visible_when must be a list.")
            continue
        deps: set[str] = set()
        for c in conds:
            if not isinstance(c, dict) or "field" not in c or ("in" not in c and "not_in" not in c):
                errors.append(f"field '{key}': each visibility rule needs 'field' and 'in' or 'not_in'.")
                continue
            ref = c["field"]
            if ref == key:
                errors.append(f"field '{key}': cannot depend on itself.")
            elif ref not in all_keys:
                errors.append(f"field '{key}': visibility rule refers to unknown field '{ref}'.")
            else:
                deps.add(ref)
        graph[key] = deps
    state: dict[str, int] = {}

    def cyclic(node: str) -> bool:
        if state.get(node) == 1:
            return True
        if state.get(node) == 2:
            return False
        state[node] = 1
        for d in graph.get(node, ()):
            if d in graph and cyclic(d):
                return True
        state[node] = 2
        return False

    for k in list(graph):
        if cyclic(k):
            errors.append(f"field '{k}': visibility rules form a loop.")
            break
    return errors


# ─── Price rules ─────────────────────────────────────────────────────────────

def validate_price_rules(rules: Any, schema: dict | None = None) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). Errors block publishing; warnings are shown to the director."""
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(rules, list) or not rules:
        return ["A service needs at least one price rule (a default price)."], warnings
    if len(rules) > MAX_RULES:
        return [f"Too many price rules (max {MAX_RULES})."], warnings

    dims = set(BUILTIN_PRICE_DIMENSIONS)
    if schema:
        dims |= {s.get("key") for s in schema.get("selectors", []) if isinstance(s, dict)}

    seen_when: list[dict] = []
    catch_all_index: int | None = None
    prices: list[int] = []
    for i, r in enumerate(rules):
        where = f"price rule #{i + 1}"
        if not isinstance(r, dict):
            errors.append(f"{where}: must be an object.")
            continue
        p = r.get("price_kobo")
        if isinstance(p, bool) or not isinstance(p, int) or p <= 0:
            errors.append(f"{where}: price must be a whole number of kobo greater than zero.")
        else:
            prices.append(p)
        if r.get("per", "flat") not in PER_MODES:
            errors.append(f"{where}: 'per' must be one of {sorted(PER_MODES)}.")
        when = r.get("when", {})
        if not isinstance(when, dict):
            errors.append(f"{where}: 'when' must be an object.")
            continue
        for dim, vals in when.items():
            if dim not in dims:
                errors.append(f"{where}: cannot price on '{dim}'.")
            if not isinstance(vals, list) or not vals or not all(isinstance(v, str) and v.strip() for v in vals):
                errors.append(f"{where}: '{dim}' needs a non-empty list of values.")
        if catch_all_index is not None:
            warnings.append(f"{where} can never apply: an earlier rule already matches everything.")
        if not when:
            catch_all_index = i
        elif when in seen_when:
            warnings.append(f"{where} repeats an earlier rule's conditions and will never apply.")
        seen_when.append(when)

    if catch_all_index is None:
        errors.append("The last price rule must be a default that matches everything, so no order is ever unpriced.")
    elif catch_all_index != len(rules) - 1:
        errors.append("The default (match-everything) price rule must be last.")

    # Sanity check for the classic extra-zero typo: a price wildly out of line with its siblings.
    if len(prices) >= 3:
        s = sorted(prices)
        median = s[len(s) // 2]
        for i, r in enumerate(rules):
            p = r.get("price_kobo") if isinstance(r, dict) else None
            if isinstance(p, int) and not isinstance(p, bool) and median > 0 and (p >= 8 * median or p * 8 <= median):
                warnings.append(
                    f"price rule #{i + 1} (₦{p / 100:,.0f}) is very different from the typical ₦{median / 100:,.0f} for this service. Please double-check it."
                )
    return errors, warnings


def _rule_matches(when: dict, selections: dict[str, Any]) -> bool:
    for dim, allowed in when.items():
        got = selections.get(dim)
        if _is_blank(got):
            return False
        norm_allowed = {normalize_value(a) for a in allowed}
        if normalize_value(got) not in norm_allowed:
            return False
    return True


def compute_price(rules: list[dict], selections: dict[str, Any], bulk_count: int = 1) -> int:
    """THE price function for templates: first matching rule wins."""
    for r in rules:
        if _rule_matches(r.get("when", {}), selections):
            price = int(r["price_kobo"])
            if r.get("per", "flat") == "bulk_count":
                price *= max(1, int(bulk_count or 1))
            return price
    raise NoPriceError("No price rule matched this selection.")


# ─── Form validation (server side) ───────────────────────────────────────────

def _condition_ok(cond: dict, answers: dict[str, Any]) -> bool:
    got = answers.get(cond["field"])
    got_n = None if _is_blank(got) else normalize_value(got)
    if "in" in cond:
        return got_n is not None and got_n in {normalize_value(v) for v in cond["in"]}
    return got_n is None or got_n not in {normalize_value(v) for v in cond["not_in"]}


def visible_fields(schema: dict, answers: dict[str, Any]) -> list[dict]:
    """Fields that are on screen for these answers (selectors always are)."""
    out = []
    for f in schema.get("fields", []):
        if all(_condition_ok(c, answers) for c in f.get("visible_when", [])):
            out.append(f)
    return out


def missing_required(schema: dict, answers: dict[str, Any]) -> list[str]:
    """Labels of required fields (selectors included) that are empty or invalid."""
    problems: list[str] = []
    for sel in schema.get("selectors", []):
        if sel.get("required", True) and _is_blank(answers.get(sel["key"])):
            problems.append(sel["label"])
    for f in visible_fields(schema, answers):
        v = answers.get(f["key"])
        if f.get("required") and _is_blank(v):
            problems.append(f["label"])
        elif f.get("type") == "digits" and not _is_blank(v) and f.get("length"):
            if not (str(v).isdigit() and len(str(v)) == f["length"]):
                problems.append(f"{f['label']} (must be {f['length']} digits)")
    return problems


def strip_hidden(schema: dict, answers: dict[str, Any]) -> dict[str, Any]:
    """Drop answers for fields that are not visible, and any key the template doesn't define."""
    keep = {f["key"] for f in visible_fields(schema, answers)}
    keep |= {s["key"] for s in schema.get("selectors", [])}
    return {k: v for k, v in answers.items() if k in keep and not _is_blank(v)}


def option_label(schema: dict, selector_key: str, value: str) -> str | None:
    for s in schema.get("selectors", []):
        if s.get("key") == selector_key:
            for o in s.get("options", []):
                if str(o.get("value")) == str(value):
                    return o.get("label")
    return None


def price_matrix(schema: dict, rules: list[dict], limit: int = 2000) -> list[dict]:
    """Every combination of the selectors' options with the unit price the engine gives it, so a
    screen can show the exact price of each option without having a price function of its own.
    Combinations no rule prices are left out (a price is never guessed)."""
    from itertools import product

    selectors = [s for s in schema.get("selectors", []) if s.get("options")]
    if not selectors:
        return []
    out: list[dict] = []
    for combo in product(*[[(s["key"], str(o["value"])) for o in s["options"]] for s in selectors]):
        selections = dict(combo)
        try:
            out.append({"selections": selections, "price_kobo": compute_price(rules, selections, 1)})
        except NoPriceError:
            continue
        if len(out) >= limit:
            break
    return out
