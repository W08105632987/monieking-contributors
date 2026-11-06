"""Pure-logic tests for biller health levels, Monnify status-page mapping, machine/log thresholds and email headers."""
import asyncio

from app.services import bill_health_service as H
from app.services import monitor_checks as M


def test_levels_use_threshold_and_min_attempts():
    f = lambda rate, n: H.level_for(rate, n, min_attempts=5, threshold=30)
    assert f(100, 20) == "good" and f(80, 10) == "good"
    assert f(79, 10) == "fair" and f(30, 10) == "fair"
    assert f(29, 10) == "poor" and f(0, 10) == "poor"
    assert f(0, 4) == "unknown"            # one or two failures must not flag a biller
    assert f(None, 0) == "unknown"


def test_make_stat_rounds_and_counts():
    s = H.make_stat(2, 6, min_attempts=5, threshold=30)
    assert s["success_rate"] == 25 and s["attempts"] == 8 and s["level"] == "poor"
    assert H.make_stat(0, 0, min_attempts=5, threshold=30)["level"] == "unknown"


def test_statuspage_mapping():
    ok = H.map_statuspage({"status": {"indicator": "none", "description": "All Systems Operational"}, "components": [], "incidents": []})
    assert ok["level"] == "operational"
    major = H.map_statuspage({"status": {"indicator": "major"}, "incidents": [{"name": "Bills API down", "status": "investigating", "impact": "major"}],
                              "components": [{"name": "Bills", "status": "major_outage"}, {"name": "Cards", "status": "operational"}]})
    assert major["level"] == "outage" and major["incidents"][0]["name"] == "Bills API down" and len(major["components"]) == 1
    maint = H.map_statuspage({"status": {"indicator": "none"}, "scheduled_maintenances": [{"name": "Infra", "status": "in_progress", "scheduled_for": "x"}]})
    assert maint["level"] == "maintenance"
    assert H.map_statuspage({"status": {"indicator": "minor"}})["level"] == "degraded"


def test_resource_thresholds():
    assert M.eval_resources(50, 0.5, 40)[0] == "healthy"
    assert M.eval_resources(88, 0.5, 40)[0] == "degraded"
    assert M.eval_resources(50, 4.5, 40)[0] == "down"
    status, notes = M.eval_resources(96, 2.5, 90)
    assert status == "down" and len(notes) == 3          # worst wins, every problem is named


def test_error_rate_thresholds():
    assert M.eval_error_rate(3, 20, 100) == "healthy"
    assert M.eval_error_rate(20, 20, 100) == "degraded"
    assert M.eval_error_rate(100, 20, 100) == "down"


def test_wallet_thresholds():
    assert M.eval_wallet(50_000, 20_000)[0] == "healthy"
    assert M.eval_wallet(10_000, 20_000)[0] == "degraded"
    assert M.eval_wallet(2_000, 20_000)[0] == "down"


def test_email_headers_for_automated_mail():
    from app.integrations.email_sender import _build
    m = _build(["a@x.com", "b@x.com"], "Subj", "body", "<b>hi</b>", True, "ops@x.com")
    assert m["Auto-Submitted"] == "auto-generated" and m["Reply-To"] == "ops@x.com"
    assert m["Message-ID"] and m["Date"] and m["To"] == "a@x.com, b@x.com"
    assert len(m.get_payload()) == 2                      # plain text AND html parts


def test_alert_html_escapes_untrusted_text():
    from app.services.alert_service import render_html
    out = render_html("new", "critical", "<script>alert(1)</script>", {"x": "<img src=x>"})
    assert "<script>" not in out and "&lt;script&gt;" in out and "<img" not in out
