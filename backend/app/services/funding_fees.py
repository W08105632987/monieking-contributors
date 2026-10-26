"""Wallet funding fee: price-range validation, fee lookup, settings access.
Ranges are whole naira. A range is {"from": 0, "to": 5000, "fee": 10}; the last one has "to": null (and up).
Ranges must start at 0, follow each other with NO gaps and NO overlaps, and the last must be open-ended."""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.funding_fee import FundingFeeSettings

DEFAULT_TIERS = [
    {"from": 0, "to": 5000, "fee": 10},
    {"from": 5001, "to": 10000, "fee": 20},
    {"from": 10001, "to": 20000, "fee": 30},
    {"from": 20001, "to": None, "fee": 50},
]


def _n(x) -> str:
    return f"₦{x:,.0f}"


def validate_tiers(tiers) -> list[str]:
    """Plain-language problems; an empty list means the ranges are fine."""
    problems: list[str] = []
    if not isinstance(tiers, list) or not tiers:
        return ["Add at least one price range."]
    prev_to = None
    for i, t in enumerate(tiers):
        label = f"Range {i + 1}"
        try:
            frm = int(t.get("from"))
            fee = float(t.get("fee"))
        except (TypeError, ValueError, AttributeError):
            problems.append(f"{label}: enter whole-naira amounts and a fee.")
            return problems
        to = t.get("to")
        last = i == len(tiers) - 1
        if fee < 0:
            problems.append(f"{label}: the fee cannot be negative.")
        if i == 0 and frm != 0:
            problems.append(f"{label} must start at ₦0, otherwise payments below {_n(frm)} have no fee rule.")
        if prev_to is not None:
            if frm > prev_to + 1:
                problems.append(f"Gap: payments from {_n(prev_to + 1)} to {_n(frm - 1)} are not covered. {label} should start at {_n(prev_to + 1)}.")
            elif frm <= prev_to:
                problems.append(f"Overlap: {label} starts at {_n(frm)} but the range before it already covers up to {_n(prev_to)}. It should start at {_n(prev_to + 1)}.")
        if to is None:
            if not last:
                problems.append(f"{label} has no upper limit, so nothing can come after it.")
            prev_to = None if last else prev_to
        else:
            try:
                to = int(to)
            except (TypeError, ValueError):
                problems.append(f"{label}: the upper limit must be a whole number (or empty for 'and above').")
                return problems
            if to < frm:
                problems.append(f"{label}: the upper limit {_n(to)} is lower than its start {_n(frm)}.")
            prev_to = to
            if last:
                problems.append(f"The last range must be open-ended ('and above'), otherwise payments above {_n(to)} have no fee rule.")
    return problems


def fee_for(amount_kobo: int, tiers: list[dict]) -> int:
    """Fee in kobo for a funding of this size. 0 when no range matches or the fee would eat the whole payment."""
    whole = amount_kobo // 100
    for t in tiers:
        to = t.get("to")
        if whole >= int(t["from"]) and (to is None or whole <= int(to)):
            fee = int(round(float(t["fee"]) * 100))
            return fee if 0 < fee < amount_kobo else 0
    return 0


async def get_settings(db: AsyncSession) -> FundingFeeSettings:
    row = await db.get(FundingFeeSettings, 1)
    if row is None:
        row = FundingFeeSettings(id=1, charge_customers=False, tiers=DEFAULT_TIERS)
        db.add(row)
        await db.flush()
    return row
