"""
Bill pricing: what a customer is charged, what Monnify is asked to vend, and
what we earn on the sale. Pure functions — no database — so the money maths is
easy to test.

  vend    = what Monnify is asked to deliver (airtime value, plan price, bill amount)
  charge  = what the customer's wallet pays
  markup  = charge - vend         (negative = a discount the director chose to give)
  commission = Monnify's rebate on the vend amount, credited to our Monnify wallet
  profit  = markup + commission
"""
import re
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from app.models.bill_payment import BillerCategory


def _d(value) -> Decimal:
    return Decimal(str(value if value is not None else 0))


def kobo_round(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class Quote:
    vend_kobo: int
    charge_kobo: int
    commission_kobo: int

    @property
    def markup_kobo(self) -> int:
        return self.charge_kobo - self.vend_kobo

    @property
    def profit_kobo(self) -> int:
        return self.markup_kobo + self.commission_kobo


def is_fixed(biller) -> bool:
    return getattr(biller, "price_kobo", None) is not None


def quote(biller, *, amount_kobo: int | None, quantity: int = 1) -> Quote:
    """Price one purchase. Fixed-price products use Monnify's price (never the client's number)."""
    markup = _d(getattr(biller, "markup_percent", 0))
    commission_pct = _d(getattr(biller, "commission_percent", 0))
    if is_fixed(biller):
        vend = biller.price_kobo * quantity
        override = getattr(biller, "customer_price_kobo", None)
        charge = override * quantity if override is not None else kobo_round(_d(vend) * (1 + markup / 100))
    else:
        if not amount_kobo or amount_kobo <= 0:
            raise ValueError("An amount is required for this bill.")
        vend = amount_kobo
        charge = kobo_round(_d(vend) * (1 + markup / 100))
    if charge < 1:
        raise ValueError("This product is priced incorrectly — please contact support.")
    return Quote(vend_kobo=vend, charge_kobo=charge, commission_kobo=kobo_round(_d(vend) * commission_pct / 100))


def customer_unit_price_kobo(biller) -> int | None:
    """The single-unit price customers SEE: our price for fixed products, nothing for open-amount ones."""
    if not is_fixed(biller):
        return None
    return quote(biller, amount_kobo=None, quantity=1).charge_kobo


# ── Monnify's commission sheet ────────────────────────────────────────────
# (our category set, keyword regex on the biller name, percent). First match wins.
_NET = {BillerCategory.AIRTIME, BillerCategory.DATA}
_COMMISSION_RULES: list[tuple[set, "re.Pattern", Decimal]] = [
    (_NET, re.compile(r"\bmtn", re.I), Decimal("3.0")),
    (_NET, re.compile(r"airtel", re.I), Decimal("3.0")),
    (_NET, re.compile(r"\bglo\b", re.I), Decimal("5.0")),
    (_NET, re.compile(r"9mobile|etisalat", re.I), Decimal("4.5")),
    ({BillerCategory.CABLE_TV}, re.compile(r"dstv|gotv|startimes", re.I), Decimal("1.5")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"\beko|ekedc", re.I), Decimal("1.0")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"ikeja|ikedc", re.I), Decimal("0.8")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"abuja|\baedc\b", re.I), Decimal("1.5")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"benin|\bbedc\b", re.I), Decimal("1.8")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"enugu|\beedc\b", re.I), Decimal("1.8")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"ibadan|ibedc", re.I), Decimal("0.9")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"\bjos\b", re.I), Decimal("1.5")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"kaduna", re.I), Decimal("1.5")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"\bkano\b", re.I), Decimal("1.3")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"port harcourt|phed", re.I), Decimal("1.4")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"^aba\b", re.I), Decimal("1.5")),
    ({BillerCategory.ELECTRICITY}, re.compile(r"yola|yedc", re.I), Decimal("1.1")),
]


def default_commission_percent(category: BillerCategory, biller_name: str) -> Decimal:
    for cats, pattern, pct in _COMMISSION_RULES:
        if category in cats and pattern.search(biller_name or ""):
            return pct
    return Decimal("0")
