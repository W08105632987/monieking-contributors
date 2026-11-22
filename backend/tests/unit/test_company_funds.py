"""Pure-logic tests for the company-funds balancing, Monnify center and the price-book catalog (no database needed)."""
from datetime import date, datetime, timezone, timedelta

import pytest

from app.services import accounting_service as acct
from app.services import company_funds_service as F
from app.services import monnify_center_service as M
from app.services import monitor_checks as MC


# ── Monnify settlement days ───────────────────────────────────────────────
def test_settlement_skips_weekends():
    assert M.add_business_days(date(2026, 11, 19), 1) == date(2026, 11, 20)      # Thursday -> Friday
    assert M.add_business_days(date(2026, 11, 20), 1) == date(2026, 11, 23)      # Friday -> Monday
    assert M.add_business_days(date(2026, 11, 21), 1) == date(2026, 11, 23)      # Saturday -> Monday
    assert M.add_business_days(date(2026, 11, 21), 0) == date(2026, 11, 23)      # paid on a weekend settles Monday at the earliest


def test_expected_settlement_uses_nigeria_date_not_utc():
    late_night_utc = datetime(2026, 11, 19, 23, 30, tzinfo=timezone.utc)         # already Friday 00:30 in Lagos
    assert M.expected_settlement(late_night_utc, 1) == date(2026, 11, 23)


def test_wallet_status_levels():
    th = {"warning_naira": 20000, "critical_naira": 5000}
    assert M.wallet_status(30000, th) == "ok" and M.wallet_status(10000, th) == "warning" and M.wallet_status(4999, th) == "critical"


def test_monitor_levels_use_the_directors_numbers():
    assert MC.eval_wallet_levels(30000, 20000, 5000)[0] == "healthy"
    assert MC.eval_wallet_levels(10000, 20000, 5000)[0] == "degraded"
    assert MC.eval_wallet_levels(4000, 20000, 5000)[0] == "down"


# ── transfer log rules ────────────────────────────────────────────────────
def test_transfer_needs_two_different_accounts():
    assert F.validate_transfer("transfer", "central", "monnify_wallet", 100, 0) == ("central", "monnify_wallet")
    for frm, to in (("central", "central"), (None, "central"), ("central", None)):
        with pytest.raises(F.FundsError):
            F.validate_transfer("transfer", frm, to, 100, 0)


def test_pending_settlement_cannot_be_logged_by_hand():
    with pytest.raises(F.FundsError):
        F.validate_transfer("transfer", "central", "monnify_pending", 100, 0)
    with pytest.raises(F.FundsError):
        F.validate_transfer("injection", None, "monnify_pending", 100, 0)


def test_injection_drawing_goodwill_shapes():
    assert F.validate_transfer("injection", None, "central", 100, 0) == (None, "central")
    assert F.validate_transfer("drawing", "central", None, 100, 0) == ("central", None)
    assert F.validate_transfer("goodwill", None, None, 100, 0) == ("central", None)      # defaults to the central account


@pytest.mark.parametrize("amount,fee", [(0, 0), (-5, 0), (100, -1)])
def test_amounts_must_make_sense(amount, fee):
    with pytest.raises(F.FundsError):
        F.validate_transfer("transfer", "central", "gyk_wallet", amount, fee)


# ── auto-close time ───────────────────────────────────────────────────────
def test_close_time_parsing_falls_back_safely():
    assert F.parse_close_time("22:30").hour == 22 and F.parse_close_time("22:30").minute == 30
    assert F.parse_close_time("nonsense").hour == 23 and F.parse_close_time(None).minute == 55


# ── the equation ──────────────────────────────────────────────────────────
def _acct(kobo, ok=True, **kw):
    return {"kobo": kobo, "ok": ok, "label": kw.pop("label", "x"), **kw}


def test_actual_total_adds_every_account():
    accts = {"central": _acct(500), "monnify_wallet": _acct(300), "monnify_pending": _acct(100), "gyk_wallet": _acct(None, ok=False), "other": _acct(0)}
    assert F.actual_total(accts) == 900


def _overview(diff, **over):
    o = {"difference_kobo": diff, "complete": True, "accounts": {}, "flows": {}, "settlement": {"late_count": 0, "due_today_count": 0, "includes_due_today": False}}
    o.update(over)
    return o


def test_a_shortfall_is_a_critical_question_and_a_balanced_day_raises_none():
    q = F.build_questions(_overview(-250_000))
    assert q and q[0]["level"] == "critical" and "LESS" in q[0]["text"]
    assert F.build_questions(_overview(0)) == []
    assert F.build_questions(_overview(50)) == []                         # under a naira of rounding noise


def test_an_unreadable_wallet_is_called_out_and_the_difference_is_not_trusted():
    accts = {"gyk_wallet": _acct(None, ok=False, label="GYKDATASUB wallet", auto=True)}
    q = F.build_questions(_overview(-100_000, complete=False, accounts=accts))
    assert any("could not be read" in x["text"] for x in q) and not any(x["level"] == "critical" for x in q)


def test_late_settlement_is_questioned():
    q = F.build_questions(_overview(0, settlement={"late_count": 2, "late_kobo": 500_000, "due_today_count": 0, "includes_due_today": False}))
    assert any("past their settlement day" in x["text"] for x in q)


# ── price book catalog ────────────────────────────────────────────────────
def test_tier_aliases_point_old_codes_at_the_one_service():
    assert acct.RATE_KEY_ALIASES["identity.bvn_retrieval_phone"].endswith(".phone_number")
    assert acct.RATE_KEY_ALIASES["identity.bvn_retrieval_crm"].endswith(".crm_investigation")
    assert acct.RATE_KEY_ALIASES["identity.bvn_retrieval_phone"].split(".")[1] == acct.RATE_KEY_ALIASES["identity.bvn_retrieval_crm"].split(".")[1]


def test_a_service_with_two_options_gets_a_tier_each_with_its_customer_price():
    schema = {"selectors": [{"key": "service_type", "options": [{"value": "a", "label": "Tier A"}, {"value": "b", "label": "Tier B"}]}]}
    rules = [{"when": {"service_type": ["a"]}, "price_kobo": 1000, "per": "flat"}, {"when": {"service_type": ["b"]}, "price_kobo": 2500, "per": "flat"},
             {"when": {}, "price_kobo": 1000, "per": "flat"}]
    tiers, lo, hi = acct._tiers_from_template(schema, rules)
    assert [t["tier"] for t in tiers] == ["a", "b"] and (lo, hi) == (1000, 2500)
    assert [t["price_min_kobo"] for t in tiers] == [1000, 2500]
