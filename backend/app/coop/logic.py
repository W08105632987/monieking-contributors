"""
Pure cooperative money logic: no database, no clock, no settings lookups.
Everything takes its numbers as arguments so it can be tested exhaustively.
All money is integer kobo.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Optional


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def interest_for(principal_kobo: int, rate_bps: int) -> int:
    """Flat interest on the principal, rounded to the nearest kobo (half up)."""
    return (principal_kobo * rate_bps + 5000) // 10000


def build_schedule(principal_kobo: int, interest_kobo: int, term_months: int, start: date) -> list[dict]:
    """
    Equal monthly instalments over the term. Any rounding remainder sits in the
    final instalment (Pending Board confirmation: 'treatment of the final instalment').
    Full interest is always payable, even if the borrower repays early.
    """
    total = principal_kobo + interest_kobo
    base = total // term_months
    p_base = principal_kobo // term_months
    i_base = interest_kobo // term_months
    rows = []
    for n in range(1, term_months + 1):
        last = n == term_months
        p = principal_kobo - p_base * (term_months - 1) if last else p_base
        i = interest_kobo - i_base * (term_months - 1) if last else i_base
        rows.append({
            "n": n,
            "due_date": add_months(start, n).isoformat(),
            "amount_kobo": p + i,
            "principal_kobo": p,
            "interest_kobo": i,
        })
    assert sum(r["amount_kobo"] for r in rows) == total
    return rows


def last_payment_day(start: date, term_months: int) -> date:
    """The last day a loan can be fully paid without being overdue (day before month term+1 begins)."""
    return add_months(start, term_months) - timedelta(days=1)


def overdue_days(today: date, due_date: Optional[date], grace_days: int = 0) -> int:
    if due_date is None:
        return 0
    d = (today - due_date).days - grace_days
    return d if d > 0 else 0


def accrued_overdue_charge(interest_kobo: int, daily_bps: int, days: int, cap_pct: int = 0) -> int:
    """
    Daily charge = daily_bps of the ORIGINAL INTEREST (not principal) per overdue day.
    cap_pct 0 means no cap (no cap adopted; pending written legal confirmation).
    """
    if days <= 0:
        return 0
    raw = interest_kobo * daily_bps * days // 10000
    if cap_pct and cap_pct > 0:
        return min(raw, interest_kobo * cap_pct // 100)
    return raw


def allocate_payment(amount: int, charges_due: int, interest_due: int, principal_due: int) -> dict:
    """
    Repayment order: overdue charges and interest first, then principal.
    Anything above the total owed is returned as `excess` and NOT applied.
    """
    left = amount
    c = min(left, max(charges_due, 0)); left -= c
    i = min(left, max(interest_due, 0)); left -= i
    p = min(left, max(principal_due, 0)); left -= p
    return {"charges": c, "interest": i, "principal": p, "excess": left}


def cover_required(principal_kobo: int, cover_pct: int) -> int:
    return -(-principal_kobo * cover_pct // 100)  # ceil


def min_commit(principal_kobo: int, commit_pct: int, floor_kobo: int, uncovered_kobo: int) -> int:
    """
    A guarantor must commit at least commit_pct of the loan (and the absolute floor),
    unless what is still uncovered is smaller, in which case covering exactly that is allowed.
    """
    need = max(-(-principal_kobo * commit_pct // 100), floor_kobo)
    return min(need, uncovered_kobo) if uncovered_kobo > 0 else need


def running_cost(interest_kobo: int, bps: int) -> int:
    return interest_kobo * bps // 10000


def split_pool(total_kobo: int, contribution_pct: int) -> tuple[int, int]:
    c = total_kobo * contribution_pct // 100
    return c, total_kobo - c


def largest_remainder(total_kobo: int, weights: dict) -> dict:
    """
    Share `total_kobo` in proportion to weights without losing or inventing a kobo:
    floors first, then the leftover kobo go to the biggest fractional remainders
    (ties broken by key so the result is deterministic).
    """
    keys = sorted(weights, key=str)
    s = sum(weights[k] for k in keys)
    if total_kobo <= 0 or s <= 0:
        return {k: 0 for k in keys}
    out, rem = {}, []
    for k in keys:
        num = total_kobo * weights[k]
        out[k] = num // s
        rem.append((num % s, k))
    left = total_kobo - sum(out.values())
    rem.sort(key=lambda t: (-t[0], str(t[1])))
    for _, k in rem[:left]:
        out[k] += 1
    return out


def reliability_pct(on_time: int, total_due: int, min_history: int) -> Optional[int]:
    """None when the member has not got enough finished loans to judge."""
    if total_due < max(min_history, 1):
        return None
    return round(100 * on_time / total_due)


def overlap_days(a_start: date, a_end: date, b_start: date, b_end: date) -> int:
    s, e = max(a_start, b_start), min(a_end, b_end)
    return max((e - s).days, 0)


def accounting_year(d: date, year_end_month: int = 12, year_end_day: int = 10) -> int:
    """The accounting year starts 1 January. (The days after the year-end date until 31 Dec are a
    closing window still counted in the same year: pending Board confirmation.)"""
    return d.year


def year_bounds(year: int, year_end_month: int = 12, year_end_day: int = 10) -> tuple[date, date]:
    """Start (inclusive) and end (exclusive) of accounting year `year`: 1 Jan to the year-end date."""
    end_day = min(year_end_day, calendar.monthrange(year, year_end_month)[1])
    return date(year, 1, 1), date(year, year_end_month, end_day) + timedelta(days=1)


def qualifies(balance_kobo: int, months_held: float, min_balance_kobo: int, min_months: int,
              disqualified: bool, active: bool = True) -> tuple[bool, str]:
    if not active:
        return False, "Membership closed"
    if disqualified:
        return False, "Withdrew early this year"
    if balance_kobo < min_balance_kobo:
        return False, "Balance below the qualifying amount"
    if months_held < min_months:
        return False, "Not held long enough yet"
    return True, ""
