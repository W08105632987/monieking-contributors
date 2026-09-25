"""Kobo / Naira conversion utilities. All monetary storage uses kobo (integers)."""


def naira_to_kobo(naira: float | int | str) -> int:
    return int(round(float(naira) * 100))


def kobo_to_naira(kobo: int) -> float:
    return round(kobo / 100.0, 2)


def format_naira(kobo: int) -> str:
    naira = kobo // 100
    return f"₦{naira:,}"


def is_valid_contribution(amount_kobo: int, rate_kobo: int) -> bool:
    if amount_kobo <= 0:
        return False
    return amount_kobo % rate_kobo == 0


def days_from_contribution(amount_kobo: int, rate_kobo: int) -> int:
    return amount_kobo // rate_kobo


def calc_net_payable(amount_kobo: int, rate_kobo: int) -> tuple[int, int]:
    charge = rate_kobo
    net = amount_kobo - charge
    return charge, net
