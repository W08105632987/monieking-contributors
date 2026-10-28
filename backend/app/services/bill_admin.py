"""Director tools for the billing section: the price list (with Monnify's commission and
our profit per sale) and the profit report by period."""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bill_payment import Biller, BillPaymentRequest, BillPaymentStatus, BillerCategory
from app.services import bill_pricing

LAGOS = ZoneInfo("Africa/Lagos")
REFERENCE_AIRTIME_KOBO = 100_000   # profit on open-amount products is shown "per ₦1,000"


def _pct(value) -> float:
    return float(Decimal(str(value or 0)))


def price_row(b: Biller) -> dict:
    fixed = bill_pricing.is_fixed(b)
    if fixed:
        q = bill_pricing.quote(b, amount_kobo=None, quantity=1)
    else:
        q = bill_pricing.quote(b, amount_kobo=REFERENCE_AIRTIME_KOBO, quantity=1)
    return {
        "id": str(b.id),
        "category": b.category.value,
        "provider": b.name,
        "product_name": b.product_name,
        "product_id": b.product_id,
        "is_active": b.is_active,
        "fixed_price": fixed,
        "monnify_price_kobo": b.price_kobo,
        "override_price_kobo": b.customer_price_kobo,
        "customer_price_kobo": q.charge_kobo if fixed else None,
        "markup_percent": _pct(b.markup_percent),
        "commission_percent": _pct(b.commission_percent),
        "min_amount_kobo": b.min_amount_kobo,
        "max_amount_kobo": b.max_amount_kobo,
        # fixed: profit on one sale. open-amount: profit on a ₦1,000 sale.
        "profit_kobo": q.profit_kobo,
        "profit_basis_kobo": q.vend_kobo,
        "commission_kobo": q.commission_kobo,
    }


async def list_prices(db: AsyncSession, category: str | None = None) -> list[dict]:
    stmt = select(Biller).order_by(Biller.name, Biller.price_kobo.nulls_first(), Biller.product_name)
    if category:
        stmt = stmt.where(Biller.category == BillerCategory(category))
    return [price_row(b) for b in (await db.execute(stmt)).scalars().all()]


def validate_pricing_patch(fields: dict, biller_fixed: bool | None = None) -> None:
    if "markup_percent" in fields and not (-50 <= float(fields["markup_percent"]) <= 200):
        raise ValueError("Markup must be between -50% and 200%.")
    if "commission_percent" in fields and not (0 <= float(fields["commission_percent"]) <= 30):
        raise ValueError("Commission must be between 0% and 30%.")
    price = fields.get("customer_price_kobo")
    if price is not None and price < 1:
        raise ValueError("The customer price must be above zero.")
    if price is not None and biller_fixed is False:
        raise ValueError("This product takes an amount typed by the customer — use a markup % instead of a fixed price.")


async def update_price(db: AsyncSession, biller_id: uuid.UUID, fields: dict) -> dict:
    b = await db.get(Biller, biller_id)
    if not b:
        raise ValueError("Product not found.")
    validate_pricing_patch(fields, bill_pricing.is_fixed(b))
    for key in ("markup_percent", "commission_percent"):
        if key in fields and fields[key] is not None:
            setattr(b, key, Decimal(str(fields[key])))
    if "customer_price_kobo" in fields:          # None clears the override
        b.customer_price_kobo = fields["customer_price_kobo"]
    if "is_active" in fields and fields["is_active"] is not None:
        b.is_active = fields["is_active"]
    await db.flush()
    return price_row(b)


async def bulk_update(db: AsyncSession, *, category: str | None, name_contains: str | None, fields: dict, clear_overrides: bool = False) -> int:
    validate_pricing_patch(fields)
    stmt = select(Biller)
    if category:
        stmt = stmt.where(Biller.category == BillerCategory(category))
    if name_contains:
        stmt = stmt.where(Biller.name.ilike(f"%{name_contains}%"))
    rows = (await db.execute(stmt)).scalars().all()
    for b in rows:
        if fields.get("markup_percent") is not None:
            b.markup_percent = Decimal(str(fields["markup_percent"]))
        if fields.get("commission_percent") is not None:
            b.commission_percent = Decimal(str(fields["commission_percent"]))
        if clear_overrides or fields.get("markup_percent") is not None:
            b.customer_price_kobo = None      # a new % supersedes any hand-typed price
    await db.flush()
    return len(rows)


# ── Profit report ─────────────────────────────────────────────────────────

def range_bounds(kind: str, today: date, start: date | None = None, end: date | None = None) -> tuple[datetime, datetime, str]:
    """(from, to, label) in Lagos time. `to` is exclusive."""
    def at(d: date) -> datetime:
        return datetime.combine(d, time.min, tzinfo=LAGOS)
    if kind == "today":
        return at(today), at(today + timedelta(days=1)), "Today"
    if kind == "week":
        monday = today - timedelta(days=today.weekday())
        return at(monday), at(today + timedelta(days=1)), "This week"
    if kind == "month":
        return at(today.replace(day=1)), at(today + timedelta(days=1)), "This month"
    if kind == "custom":
        if not start or not end:
            raise ValueError("Choose a start and an end date.")
        if end < start:
            raise ValueError("The end date is before the start date.")
        if (end - start).days > 366:
            raise ValueError("Choose a period of a year or less.")
        return at(start), at(end + timedelta(days=1)), f"{start:%d %b %Y} – {end:%d %b %Y}"
    raise ValueError("Unknown period.")


async def profit_report(db: AsyncSession, start: datetime, end: datetime) -> dict:
    vend = func.coalesce(BillPaymentRequest.vend_amount_kobo, BillPaymentRequest.amount_kobo)
    stmt = (
        select(
            Biller.category,
            func.count(BillPaymentRequest.id),
            func.coalesce(func.sum(BillPaymentRequest.amount_kobo), 0),
            func.coalesce(func.sum(vend), 0),
            func.coalesce(func.sum(BillPaymentRequest.markup_kobo), 0),
            func.coalesce(func.sum(BillPaymentRequest.commission_kobo), 0),
        )
        .join(Biller, Biller.id == BillPaymentRequest.biller_id)
        .where(
            BillPaymentRequest.status == BillPaymentStatus.COMPLETED,
            BillPaymentRequest.completed_at >= start,
            BillPaymentRequest.completed_at < end,
        )
        .group_by(Biller.category)
    )
    by_category: dict[str, dict] = {}
    for category, count, sales, cost, markup, commission in (await db.execute(stmt)).all():
        by_category[category.value] = {
            "count": int(count), "sales_kobo": int(sales), "vend_kobo": int(cost),
            "markup_kobo": int(markup), "commission_kobo": int(commission), "profit_kobo": int(markup) + int(commission),
        }
    empty = {"count": 0, "sales_kobo": 0, "vend_kobo": 0, "markup_kobo": 0, "commission_kobo": 0, "profit_kobo": 0}
    rows = [{"category": c.value, **by_category.get(c.value, empty)} for c in BillerCategory]
    total = {k: sum(r[k] for r in rows) for k in empty}
    return {"from": start.isoformat(), "to": end.isoformat(), "rows": rows, "total": total}
