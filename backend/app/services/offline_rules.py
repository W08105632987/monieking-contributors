"""Pure rules for offline-customer imports (no database, easy to test).

Withdrawal charge: the app charges one day's rate for every distinct card MONTH a withdrawal reaches into
(see card_service.evaluate_withdrawal). An imported card numbers its days 1..N with 31 days per month, and the
withdrawn days are always the first ones, so withdrawing W days touches ceil(W / 31) months."""
import secrets
import string

DAYS_PER_MONTH = 31


def months_touched(days_withdrawn: int) -> int:
    return -(-max(days_withdrawn, 0) // DAYS_PER_MONTH)


def withdrawal_amounts(rate_kobo: int, days_withdrawn: int) -> tuple[int, int, int]:
    """(requested, charge, net) in kobo for an already-paid offline withdrawal.
    The database requires net > 0, so if the normal charge would leave nothing the charge is dropped to 0."""
    requested = rate_kobo * days_withdrawn
    charge = rate_kobo * months_touched(days_withdrawn)
    if requested - charge <= 0:
        charge = 0
    return requested, charge, requested - charge


def card_key(v: dict) -> tuple:
    """Two rows with the same key are the SAME card entered twice. A person can hold several cards of the same
    type (even with the same rate): to add a genuinely identical second card, put something like 'Card 2' in Notes."""
    return (v.get("phone_number"), v.get("card_type"), v.get("rate_kobo"), v.get("days_contributed"),
            v.get("days_withdrawn"), str(v.get("start_date") or ""), (v.get("notes") or "").strip().lower())


def group_by_phone(rows: list) -> dict[str, list]:
    out: dict[str, list] = {}
    for r in rows:
        out.setdefault(r.phone_number if hasattr(r, "phone_number") else r["phone_number"], []).append(r)
    return out


def temp_password(n: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(n))
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw):
            return pw
