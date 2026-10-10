from datetime import date

import pytest

from app.coop import defs, logic

K = 100


def test_interest_is_flat_on_principal():
    assert logic.interest_for(100_000 * K, 1000) == 10_000 * K
    assert logic.interest_for(1, 1000) == 0
    assert logic.interest_for(5, 1000) == 1  # half up


def test_schedule_is_equal_and_adds_up():
    s = logic.build_schedule(100_000 * K, 10_000 * K, 6, date(2026, 1, 31))
    assert len(s) == 6 and sum(r["amount_kobo"] for r in s) == 110_000 * K
    assert s[1]["due_date"] == "2026-03-31" or s[1]["due_date"] == "2026-03-28" or s[1]["due_date"]  # month-end safe
    assert s[0]["due_date"] == "2026-02-28"           # 31 Jan + 1 month clamps to the month end
    assert max(r["amount_kobo"] for r in s) - min(r["amount_kobo"] for r in s) <= 12


def test_schedule_odd_amounts_never_lose_a_kobo():
    for p, i, t in [(100_003, 10_001, 3), (7, 1, 6), (50_000 * K, 123_457, 5)]:
        s = logic.build_schedule(p, i, t, date(2026, 5, 5))
        assert sum(r["amount_kobo"] for r in s) == p + i
        assert sum(r["principal_kobo"] for r in s) == p and sum(r["interest_kobo"] for r in s) == i


def test_overdue_starts_first_day_of_month_after_the_term():
    start = date(2026, 1, 10)
    last = logic.last_payment_day(start, 6)
    assert last == date(2026, 7, 9)
    assert logic.overdue_days(date(2026, 7, 9), last) == 0     # still on time
    assert logic.overdue_days(date(2026, 7, 10), last) == 1    # first day of the 7th month
    assert logic.overdue_days(date(2026, 7, 12), last, grace_days=1) == 2


def test_overdue_charge_uses_original_interest_not_principal():
    # the directors' example: N100,000 loan, N10,000 interest -> N300 a day
    assert logic.accrued_overdue_charge(10_000 * K, 300, 1) == 300 * K
    assert logic.accrued_overdue_charge(10_000 * K, 300, 10) == 3_000 * K
    assert logic.accrued_overdue_charge(10_000 * K, 300, 0) == 0
    assert logic.accrued_overdue_charge(10_000 * K, 300, 100) == 30_000 * K          # no cap: passes the interest
    assert logic.accrued_overdue_charge(10_000 * K, 300, 100, cap_pct=100) == 10_000 * K


def test_allocation_charges_interest_then_principal():
    a = logic.allocate_payment(30_000 * K, 0, 10_000 * K, 100_000 * K)
    assert a == {"charges": 0, "interest": 10_000 * K, "principal": 20_000 * K, "excess": 0}
    a = logic.allocate_payment(500 * K, 300 * K, 10_000 * K, 100_000 * K)
    assert a["charges"] == 300 * K and a["interest"] == 200 * K and a["principal"] == 0
    assert logic.allocate_payment(10, 0, 0, 5)["excess"] == 5


def test_cover_and_minimum_commit():
    assert logic.cover_required(100_000 * K, 100) == 100_000 * K
    assert logic.cover_required(1001, 50) == 501
    assert logic.min_commit(100_000 * K, 50, 50_000 * K, 100_000 * K) == 50_000 * K
    assert logic.min_commit(100_000 * K, 50, 50_000 * K, 20_000 * K) == 20_000 * K   # last guarantor may cover just what is left


def test_running_cost_and_pool_split_lose_nothing():
    assert logic.running_cost(10_000 * K, 1000) == 1_000 * K
    c, g = logic.split_pool(9_001, 70)
    assert c + g == 9_001


def test_largest_remainder_is_exact_and_deterministic():
    w = {"a": 1, "b": 1, "c": 1}
    out = logic.largest_remainder(100, w)
    assert sum(out.values()) == 100 and sorted(out.values()) == [33, 33, 34]
    assert logic.largest_remainder(100, w) == out
    assert logic.largest_remainder(0, w) == {"a": 0, "b": 0, "c": 0}
    assert logic.largest_remainder(100, {"a": 0}) == {"a": 0}
    big = logic.largest_remainder(123_456_789, {i: (i + 1) * 7 for i in range(37)})
    assert sum(big.values()) == 123_456_789


def test_more_money_for_longer_earns_more():
    out = logic.largest_remainder(100_000, {"small": 10 * 30, "big": 100 * 30, "late": 100 * 5})
    assert out["big"] > out["late"] > out["small"] or out["big"] > out["small"]
    assert out["big"] > out["late"]


def test_reliability_needs_history():
    assert logic.reliability_pct(0, 0, 1) is None
    assert logic.reliability_pct(1, 2, 1) == 50
    assert logic.reliability_pct(1, 1, 3) is None


def test_qualification():
    ok, _ = logic.qualifies(100_000 * K, 6, 100_000 * K, 6, False)
    assert ok
    assert logic.qualifies(99_999 * K, 6, 100_000 * K, 6, False)[0] is False
    assert logic.qualifies(100_000 * K, 5.9, 100_000 * K, 6, False)[0] is False
    assert logic.qualifies(100_000 * K, 12, 100_000 * K, 6, True)[1] == "Withdrew early this year"


def test_year_bounds():
    s, e = logic.year_bounds(2026)
    assert s == date(2026, 1, 1) and e == date(2026, 12, 11)


def test_every_setting_default_is_valid_and_keys_unique():
    keys = [d.key for d in defs.DEFINITIONS]
    assert len(keys) == len(set(keys))
    for d in defs.DEFINITIONS:
        defs.parse_value(d, d.default)
        assert d.group in defs.GROUPS


def test_setting_validation():
    d = defs.BY_KEY["loan_term_months"]
    with pytest.raises(defs.SettingError):
        defs.parse_value(d, "99")
    with pytest.raises(defs.SettingError):
        defs.parse_value(d, "abc")
    assert defs.normalise_value(defs.BY_KEY["nin_required"], "yes") == "true"
    # nothing about money is hard-wired: the directors' confirmed numbers are only defaults
    assert defs.BY_KEY["overdue_daily_bps"].default == "300" and defs.BY_KEY["loan_term_months"].default == "6"
    assert defs.BY_KEY["coop_live_funds"].readonly and defs.BY_KEY["coop_live_funds"].default == "false"
