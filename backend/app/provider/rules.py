"""Pure rules for provider-backed services (no database, no network): unit tested."""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

# What the provider's own status words mean to us. Anything unrecognised is treated as "still waiting"
# (never as success or failure) so an unexpected word can't pay a commission or refund by accident.
SUCCESS_WORDS = {"success", "successful", "completed", "complete", "resolved", "done", "approved"}
FAILED_WORDS = {"failed", "fail", "rejected", "declined", "error", "cancelled", "canceled", "refunded"}

ENDPOINT_RE = re.compile(r"^[a-z][a-z_]{2,40}\.php$")
PARAM_RE = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
DIGIT_PARAMS = {"nin", "phone_number", "bvn"}


def normalize_status(raw: Any) -> str:
    word = str(raw or "").strip().lower().replace(" ", "_")
    if word in SUCCESS_WORDS:
        return "success"
    if word in FAILED_WORDS:
        return "failed"
    return "pending"


def matches_when(when: dict | None, view: dict) -> bool:
    """{"service_type": ["email_retrieval"]} -> true only if the job's value is one of the listed ones."""
    for key, allowed in (when or {}).items():
        allowed = allowed if isinstance(allowed, list) else [allowed]
        if str(view.get(key, "")) not in {str(a) for a in allowed}:
            return False
    return True


def clean_value(param: str, value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value)).strip()
    return re.sub(r"\D", "", text) if param in DIGIT_PARAMS else text


def job_view(form_data: dict | None, service_type: str | None) -> dict:
    view = dict(form_data or {})
    view["service_type"] = service_type or view.get("service_type", "")
    return view


def build_payload(cfg: dict, view: dict) -> tuple[dict, list[str], dict]:
    """-> (payload, missing_labels, files) where files = {param: source value (URL or data URL)}.
    `missing` lists what the job lacks, using the PARAM names, so the worker can see what to fix."""
    payload: dict[str, str] = dict(cfg.get("static_params") or {})
    missing: list[str] = []
    for param, key in (cfg.get("field_map") or {}).items():
        optional = key.startswith("?")          # "?phone_number" = send it when the customer gave it
        val = view.get(key.lstrip("?"))
        if val in (None, "", []):
            if not optional:
                missing.append(param)
        else:
            payload[param] = clean_value(param, val)
    for param, spec in (cfg.get("value_maps") or {}).items():
        raw = str(view.get(spec.get("from", ""), ""))
        mapped = (spec.get("map") or {}).get(raw)
        if mapped is None:
            missing.append(param)
        else:
            payload[param] = mapped
    files: dict[str, str] = {}
    for param, key in (cfg.get("file_params") or {}).items():
        val = view.get(key.lstrip("?"))
        if not val or not isinstance(val, str):
            if not key.startswith("?"):
                missing.append(param)
        else:
            files[param] = val
    return payload, missing, files


def eligibility(cfg: dict | None, view: dict) -> tuple[bool, str]:
    if not cfg or not cfg.get("enabled"):
        return False, "Sending to Techhub is not switched on for this service."
    if not matches_when(cfg.get("applies_when"), view):
        return False, "This kind of request is handled manually, not through Techhub."
    _, missing, _ = build_payload(cfg, view)
    if missing:
        return False, "Missing details Techhub needs: " + ", ".join(sorted(set(missing))) + "."
    return True, ""


def mask_for_preview(param: str, value: str) -> str:
    if param in DIGIT_PARAMS and len(value) > 6:
        return value[:3] + "•" * (len(value) - 6) + value[-3:]
    return value if len(value) <= 80 else value[:77] + "…"


def parse_check_body(body: Any) -> tuple[str, str, dict]:
    """Provider status reply -> (our state, note for people, extras). Extras never include the raw body."""
    if not isinstance(body, dict):
        return "pending", "", {}
    state = normalize_status(body.get("status"))
    note = str(body.get("response") or body.get("note") or body.get("message") or "").strip()
    extras = {k: body[k] for k in ("bvn", "new_nin", "new_tracking_id") if body.get(k)}
    if state == "success" and "bvn" in body and not body.get("bvn"):
        state = "pending"    # "resolved" but no BVN yet: keep waiting rather than paying out on an empty answer
    return state, note[:1000], extras


def success_text(service_code: str, note: str, extras: dict) -> str:
    parts = []
    if extras.get("bvn"):
        parts.append(f"BVN: {extras['bvn']}")
    if extras.get("new_nin"):
        parts.append(f"New NIN: {extras['new_nin']}")
    if extras.get("new_tracking_id"):
        parts.append(f"New tracking ID: {extras['new_tracking_id']}")
    if note:
        parts.append(note)
    return " | ".join(parts) or "Completed successfully."


def overdue(submitted_at: datetime, now: datetime, days: int, alerted_at: datetime | None) -> bool:
    return alerted_at is None and now - submitted_at >= timedelta(days=days)


def due_for_check(last_checked: datetime | None, submitted_at: datetime, now: datetime, poll_minutes: int) -> bool:
    ref = last_checked or submitted_at
    return now - ref >= timedelta(minutes=poll_minutes)


def validate_config_patch(patch: dict, form_keys: set[str] | None = None) -> list[str]:
    errors: list[str] = []
    if "endpoint" in patch and not ENDPOINT_RE.match(str(patch["endpoint"])):
        errors.append("Endpoint must look like nin_validation.php.")
    for k, lo, hi in (("alert_after_days", 1, 60), ("poll_minutes", 5, 720)):
        if k in patch and (isinstance(patch[k], bool) or not isinstance(patch[k], int) or not lo <= patch[k] <= hi):
            errors.append(f"{k.replace('_', ' ').capitalize()} must be a whole number from {lo} to {hi}.")
    for k in ("enabled", "refund_on_failure"):
        if k in patch and not isinstance(patch[k], bool):
            errors.append(f"{k} must be true or false.")
    for k in ("field_map", "file_params"):
        if k in patch:
            m = patch[k]
            if not isinstance(m, dict) or any(not PARAM_RE.match(str(p)) or not isinstance(v, str) or not v for p, v in m.items()):
                errors.append(f"{k} must map provider parameter names to form field keys.")
            elif form_keys is not None:
                bad = sorted({v.lstrip('?') for v in m.values() if v.lstrip('?') not in form_keys})
                if bad:
                    errors.append(f"These form fields do not exist in the service form: {', '.join(bad)}.")
    if "status_param" in patch and patch["status_param"] not in ("ticket_id", "submission_id"):
        errors.append("Status parameter must be ticket_id or submission_id.")
    return errors
