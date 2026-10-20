"""Pure-logic tests for Techhub-backed manual services (no network, no database)."""
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

for _mod, _attrs in (("httpx", {"Timeout": lambda **k: None, "AsyncClient": object,
                                "TimeoutException": type("TimeoutException", (Exception,), {}),
                                "HTTPError": type("HTTPError", (Exception,), {})}),):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = types.SimpleNamespace(**_attrs)
try:
    import app.core.config  # noqa: F401
except Exception:
    _cfg = types.ModuleType("app.core.config")
    _cfg.settings = types.SimpleNamespace(TECHHUB_API_KEY="", TECHHUB_BASE_URL="", VERIFICATION_ENCRYPTION_KEY="", SUPABASE_URL="")
    sys.modules["app.core.config"] = _cfg

from app.provider import client as K  # noqa: E402
from app.provider import defaults as D  # noqa: E402
from app.provider import rules as R  # noqa: E402
from app.services import service_template_engine as eng  # noqa: E402

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


def _cfg(code, **over):
    c = {"enabled": True, "endpoint": "x.php", "field_map": {}, "value_maps": {}, "static_params": {},
         "file_params": {}, "applies_when": {}, "status_param": "ticket_id"}
    c.update(D.DEFAULT_CONFIGS[code])
    c.update(over)
    return c


# ── status words ──────────────────────────────────────────────────────────
def test_status_words_never_guess_success_or_failure():
    for w in ("success", "Successful", "resolved", "completed"):
        assert R.normalize_status(w) == "success"
    for w in ("failed", "rejected", "Refunded", "declined"):
        assert R.normalize_status(w) == "failed"
    for w in ("pending", "submitted", "under_review", "processing", "", None, "something new"):
        assert R.normalize_status(w) == "pending"


def test_parse_check_body_waits_when_resolved_but_no_bvn_yet():
    assert R.parse_check_body({"status": "success", "bvn": None, "response": "x"})[0] == "pending"
    state, note, extras = R.parse_check_body({"status": "resolved", "bvn": "22212345678", "response": "ok"})
    assert state == "success" and extras == {"bvn": "22212345678"}
    assert R.parse_check_body({"status": "failed", "response": "No record"})[:2] == ("failed", "No record")
    assert R.parse_check_body("garbage") == ("pending", "", {})


def test_success_text_includes_what_the_customer_needs():
    t = R.success_text("ipe_clearance", "Cleared", {"new_tracking_id": "ABC1", "new_nin": "12345678901"})
    assert "ABC1" in t and "12345678901" in t and "Cleared" in t


# ── payload building from a job ───────────────────────────────────────────
def test_delinking_needs_email_so_self_service_stays_manual():
    cfg = _cfg("nin_delinking")
    email_job = R.job_view({"nin": "123 4567 8901", "email": "a@b.com"}, "email_retrieval")
    ok, why = R.eligibility(cfg, email_job)
    assert ok, why
    payload, missing, _ = R.build_payload(cfg, email_job)
    assert payload == {"nin": "12345678901", "email": "a@b.com"} and not missing
    ok, why = R.eligibility(cfg, R.job_view({"nin": "12345678901"}, "self_service_delinking"))
    assert not ok and "manually" in why
    ok, why = R.eligibility(cfg, R.job_view({"nin": "12345678901"}, "email_retrieval"))
    assert not ok and "email" in why


def test_validation_maps_our_types_to_techhub_types_and_bulk_stays_manual():
    cfg = _cfg("nin_validation")
    for ours, theirs in D.VALIDATION_TYPE_MAP.items():
        payload, missing, _ = R.build_payload(cfg, R.job_view({"nin": "12345678901", "submit_mode": "single"}, ours))
        assert payload["validation_type"] == theirs and not missing
    assert not R.eligibility(cfg, R.job_view({"nin": "1", "submit_mode": "bulk"}, "sim_validation"))[0]
    _, missing, _ = R.build_payload(cfg, R.job_view({"nin": "12345678901"}, "something_unmapped"))
    assert "validation_type" in missing


def test_bvn_retrieval_only_for_phone_type():
    cfg = _cfg("bvn_retrieval")
    job = {"first_name": "A", "last_name": "B", "phone_number": "0801 234 5678"}
    ok, _ = R.eligibility(cfg, R.job_view(job, "phone_number"))
    assert ok
    assert R.build_payload(cfg, R.job_view(job, "phone_number"))[0]["phone_number"] == "08012345678"
    assert not R.eligibility(cfg, R.job_view(job, "crm_investigation"))[0]


def test_crm_optional_fields_and_screenshot():
    cfg = _cfg("bvn_crm")
    base = {"batch_id": "4935767", "enrollment_ticket_id": "TKT-1", "issue_description": "sync failed",
            "screenshot": "https://x/storage/v1/object/public/avatars/a.png"}
    payload, missing, files = R.build_payload(cfg, R.job_view(base, "standard"))
    assert not missing and payload["ticket_id"] == "TKT-1" and "phone_number" not in payload
    assert files == {"screenshot": base["screenshot"]}
    assert cfg["status_param"] == "submission_id"
    _, missing, _ = R.build_payload(cfg, R.job_view({k: v for k, v in base.items() if k != "screenshot"}, "standard"))
    assert missing == ["screenshot"]


def test_switched_off_service_cannot_be_sent():
    cfg = _cfg("ipe_clearance", enabled=False)
    ok, why = R.eligibility(cfg, R.job_view({"tracking_id": "ABC123"}, "standard"))
    assert not ok and "not switched on" in why


# ── provider replies ──────────────────────────────────────────────────────
def test_submit_replies_are_classified_safely():
    ok = K.interpret_submit(200, {"success": True, "ticket_id": "TKT1", "status": "pending", "amount_charged": 300})
    assert ok.kind == "ok" and ok.ticket_ref == "TKT1" and ok.cost_raw == 300
    crm = K.interpret_submit(200, {"success": True, "submission_id": "CRM-1", "status": "submitted", "amount_charged": 1000})
    assert crm.kind == "ok" and crm.ticket_ref == "CRM-1"
    assert K.interpret_submit(200, {"success": True}).kind == "unknown"          # accepted but no reference: never assume
    assert K.interpret_submit(400, {"success": False, "message": "Insufficient balance"}).kind == "balance"
    assert K.interpret_submit(400, {"success": False, "message": "not priced for this account yet"}).kind == "off"
    assert K.interpret_submit(400, {"success": False, "message": "Invalid NIN"}).kind == "rejected"
    assert K.interpret_submit(429, {}).kind == "busy"
    assert K.interpret_submit(401, {}).kind == "auth"
    assert K.interpret_submit(503, {"message": "off"}).kind == "off"
    assert K.interpret_submit(502, None).kind == "unknown"                       # may have gone through
    assert K.interpret_submit(200, "not json").kind == "unknown"


# ── timing ────────────────────────────────────────────────────────────────
def test_overdue_alert_uses_director_days_and_fires_once():
    sub = NOW - timedelta(days=5, minutes=1)
    assert R.overdue(sub, NOW, 5, None)
    assert not R.overdue(sub, NOW, 6, None)
    assert not R.overdue(sub, NOW, 5, NOW)
    assert R.due_for_check(None, NOW - timedelta(minutes=31), NOW, 30)
    assert not R.due_for_check(NOW - timedelta(minutes=5), NOW - timedelta(days=1), NOW, 30)


# ── director settings validation ──────────────────────────────────────────
def test_config_patch_validation():
    keys = {"nin", "email", "service_type"}
    assert R.validate_config_patch({"alert_after_days": 5, "poll_minutes": 30, "refund_on_failure": False}, keys) == []
    assert R.validate_config_patch({"alert_after_days": 0})
    assert R.validate_config_patch({"alert_after_days": True})
    assert R.validate_config_patch({"poll_minutes": 2})
    assert R.validate_config_patch({"endpoint": "../../etc/passwd"})
    assert R.validate_config_patch({"endpoint": "nin_validation.php"}) == []
    assert R.validate_config_patch({"refund_on_failure": "no"})
    assert R.validate_config_patch({"field_map": {"nin": "missing_field"}}, keys)
    assert R.validate_config_patch({"field_map": {"nin": "?nin"}}, keys) == []
    assert R.validate_config_patch({"status_param": "id"})


# ── defaults ──────────────────────────────────────────────────────────────
def test_new_services_are_valid_templates_and_defaults_are_refundable():
    assert set(D.DEFAULT_CONFIGS) == {"nin_delinking", "nin_validation", "nin_personalization", "bvn_retrieval",
                                      "ipe_clearance", "bvn_crm"}
    for code, s in D.NEW_SERVICES.items():
        assert eng.validate_schema(s["schema"]) == []
        assert eng.validate_price_rules([{"when": {}, "price_kobo": s["price_kobo"], "per": "flat"}], s["schema"])[0] == []
        keys = {f["key"] for f in s["schema"]["fields"]}
        mapped = {v.lstrip("?") for v in D.DEFAULT_CONFIGS[code].get("field_map", {}).values()}
        mapped |= {v.lstrip("?") for v in D.DEFAULT_CONFIGS[code].get("file_params", {}).values()}
        assert mapped <= keys, (code, mapped - keys)
    for code, cfg in D.DEFAULT_CONFIGS.items():
        assert R.validate_config_patch({"endpoint": cfg["endpoint"], "field_map": cfg.get("field_map", {})}) == []
