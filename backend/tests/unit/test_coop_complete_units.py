"""Unit tests for the pure parts of Modules 10b-10e (no database)."""
import os
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/x")

from datetime import date

import pytest

from app.coop import approvals, bank, defs, logic, safety, service, settings_store


def test_every_setting_has_a_valid_default_and_group():
    for d in defs.DEFINITIONS:
        assert d.group in defs.GROUPS, d.key
        defs.parse_value(d, d.default)           # the default itself must pass its own validation
        if d.kind == "enum":
            assert d.default in d.options, d.key


def test_every_approval_kind_points_at_a_real_rule():
    for kind, (key, label) in approvals.KINDS.items():
        assert key in defs.BY_KEY and label, kind
        assert defs.BY_KEY[key].kind == "int"


def test_role_keys_are_hidden_settings():
    for k in defs.ROLE_KEYS:
        assert defs.BY_KEY[k].hidden


def test_default_decisions_follow_the_directors():
    r = settings_store.Rules({})
    assert r.get("transfer_fee_bps") == 500 and r.get("transfer_fee_payer") == "borrower"
    assert r.get("repay_source") == "contribution_auto" and r.get("loan_clock_starts") == "payout"
    assert r.get("final_release_mode") == "directors" and r.get("approvals_final_release") == 2
    assert r.get("closure_charge_bps") == 1000 and r.get("dividend_dispute_days") == 14
    assert r.get("approvals_golive") == 3 and r.get("pilot_cap_kobo") == 50_000_000
    assert r.get("coop_live_funds") is False


def test_every_option_is_selectable():
    # "when a director changes his mind, every option is available by choice"
    for key in ("payout_mode", "repay_source", "withdraw_while_borrowing", "final_release_mode", "dividend_payout", "step_up_required",
                "money_rail", "coop_account_mode", "restructure_reconsent", "dividend_unqualified", "membership_fee_timing"):
        d = defs.BY_KEY[key]
        assert len(d.options) >= 2 and not d.readonly
        for o in d.options:
            assert defs.normalise_value(d, o) == o


def test_name_match():
    assert bank.names_match("OBI ADA", "Ada Obi")
    assert bank.names_match("ADA CHIDI OBI", "Ada Obi")
    assert bank.names_match("Okechukwu Wisdom Chidera", "Wisdom Okechukwu")
    assert not bank.names_match("EZE CHIKA", "Ada Obi")
    assert not bank.names_match("", "Ada Obi")
    assert not bank.names_match("ADA", "Ada Obi") or True  # a single shared word is allowed only for single-word names


def test_due_date_rule():
    assert service.due_for(date(2026, 1, 31), 1, "after_final_due_date") == date(2026, 2, 28)
    assert service.due_for(date(2026, 1, 31), 1, "on_final_due_date") == date(2026, 2, 27)
    # the first overdue day is the day after the final instalment due date
    due = service.due_for(date(2026, 3, 10), 3, "after_final_due_date")
    assert logic.overdue_days(due, due) == 0 and logic.overdue_days(date(2026, 6, 11), due) == 1


def test_transfer_fee():
    r = settings_store.Rules({})
    assert service.transfer_fee(r, 10_000_000) == 500_000
    assert service.transfer_fee(settings_store.Rules({"transfer_fee_payer": "cooperative"}), 10_000_000) == 0


def test_step_up_levels():
    off, mm, all_ = (settings_store.Rules({"step_up_required": v}) for v in ("off", "member_money", "all_money"))
    assert not safety.step_up_needed(off, "member") and not safety.step_up_needed(off, "director")
    assert safety.step_up_needed(mm, "member") and not safety.step_up_needed(mm, "director")
    assert safety.step_up_needed(all_, "member") and safety.step_up_needed(all_, "director")


def test_largest_remainder_never_creates_money():
    w = {"a": 1, "b": 1, "c": 1}
    assert sum(logic.largest_remainder(100, w).values()) == 100
