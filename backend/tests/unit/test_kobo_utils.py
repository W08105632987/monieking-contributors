"""Unit tests for kobo/naira financial utilities."""
import pytest
from app.utils.kobo import (
    naira_to_kobo, kobo_to_naira, format_naira,
    is_valid_contribution, days_from_contribution, calc_net_payable,
)


def test_naira_to_kobo():
    assert naira_to_kobo(1000)   == 100_000
    assert naira_to_kobo(500)    ==  50_000
    assert naira_to_kobo(0.5)    ==      50
    assert naira_to_kobo("1500") == 150_000


def test_kobo_to_naira():
    assert kobo_to_naira(100_000) == 1000.0
    assert kobo_to_naira(50_000)  ==  500.0


def test_format_naira():
    assert format_naira(100_000) == "₦1,000"
    assert format_naira(500_000) == "₦5,000"


def test_valid_contribution():
    assert is_valid_contribution(100_000, 100_000) is True   # 1 day
    assert is_valid_contribution(500_000, 100_000) is True   # 5 days
    assert is_valid_contribution(50_000,  100_000) is False  # half day — invalid
    assert is_valid_contribution(0,       100_000) is False  # zero — invalid
    assert is_valid_contribution(-1,      100_000) is False  # negative — invalid


def test_days_from_contribution():
    assert days_from_contribution(500_000, 100_000) == 5
    assert days_from_contribution(100_000, 100_000) == 1
    assert days_from_contribution(372 * 100_000, 100_000) == 372


def test_withdrawal_calc():
    # ₦20,000 withdrawal at ₦1,000/day rate
    # Charge = ₦1,000 (one day)
    # Net = ₦19,000
    charge, net = calc_net_payable(2_000_000, 100_000)
    assert charge == 100_000
    assert net    == 1_900_000

    # ₦10,000 withdrawal at ₦500/day
    charge, net = calc_net_payable(1_000_000, 50_000)
    assert charge == 50_000
    assert net    == 950_000
