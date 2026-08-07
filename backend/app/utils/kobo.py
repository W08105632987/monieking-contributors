"""Kobo / Naira conversion utilities. All monetary storage uses kobo (integers)."""


def is_valid_contribution(amount_kobo: int, rate_kobo: int) -> bool:
    if amount_kobo <= 0:
        return False
    return amount_kobo % rate_kobo == 0


def days_from_contribution(amount_kobo: int, rate_kobo: int) -> int:
    return amount_kobo // rate_kobo
