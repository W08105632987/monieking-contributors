"""Unit tests for card grid position calculation."""
import pytest


def day_to_grid(day_number: int) -> tuple[int, int]:
    """Convert sequential day (1-372) to (logical_month, logical_day)."""
    month = ((day_number - 1) // 31) + 1
    day   = ((day_number - 1) % 31) + 1
    return month, day


def test_day_1_is_january_day_1():
    assert day_to_grid(1) == (1, 1)


def test_day_31_is_january_day_31():
    assert day_to_grid(31) == (1, 31)


def test_day_32_is_february_day_1():
    assert day_to_grid(32) == (2, 1)


def test_day_62_is_february_day_31():
    assert day_to_grid(62) == (2, 31)


def test_day_372_is_december_day_31():
    assert day_to_grid(372) == (12, 31)


def test_all_372_days_are_unique():
    positions = {day_to_grid(d) for d in range(1, 373)}
    assert len(positions) == 372


def test_all_months_covered():
    months = {day_to_grid(d)[0] for d in range(1, 373)}
    assert months == set(range(1, 13))
