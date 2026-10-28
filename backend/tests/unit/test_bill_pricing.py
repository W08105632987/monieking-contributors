"""Pricing, commission and profit — pure maths plus pay_bill wiring. No database or network."""
import asyncio
import os
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")

from app.models.bill_payment import BillerCategory, BillPaymentStatus   # noqa: E402
from app.services import bill_admin, bill_pricing as bp                  # noqa: E402
from app.services import bill_payment_service as svc                     # noqa: E402


def biller(**over):
    base = dict(id=uuid.uuid4(), is_active=True, category=BillerCategory.AIRTIME, name="MTN", product_name="MTN Mobile Top up",
                product_id="13", price_kobo=None, requires_validation=False, markup_percent=Decimal("0"),
                commission_percent=Decimal("3"), customer_price_kobo=None, min_amount_kobo=10000, max_amount_kobo=None)
    base.update(over)
    return SimpleNamespace(**base)


def test_open_amount_with_no_markup_charges_face_value_and_earns_commission():
    q = bp.quote(biller(), amount_kobo=10000)
    assert (q.vend_kobo, q.charge_kobo, q.commission_kobo, q.markup_kobo, q.profit_kobo) == (10000, 10000, 300, 0, 300)


def test_markup_and_discount_on_open_amounts():
    up = bp.quote(biller(markup_percent=Decimal("2")), amount_kobo=100000)
    assert up.charge_kobo == 102000 and up.profit_kobo == 2000 + 3000
    down = bp.quote(biller(markup_percent=Decimal("-1")), amount_kobo=100000)
    assert down.charge_kobo == 99000 and down.profit_kobo == -1000 + 3000


def test_fixed_price_uses_monnify_price_never_the_clients_amount():
    b = biller(category=BillerCategory.DATA, price_kobo=150000, commission_percent=Decimal("3"))
    q = bp.quote(b, amount_kobo=1)
    assert (q.vend_kobo, q.charge_kobo, q.commission_kobo) == (150000, 150000, 4500)


def test_a_directors_hand_typed_price_beats_the_markup_and_scales_with_quantity():
    b = biller(category=BillerCategory.DATA, price_kobo=150000, markup_percent=Decimal("10"), customer_price_kobo=160000)
    q = bp.quote(b, amount_kobo=None, quantity=2)
    assert q.vend_kobo == 300000 and q.charge_kobo == 320000 and q.markup_kobo == 20000
    assert bp.customer_unit_price_kobo(b) == 160000


def test_customers_see_our_price_for_fixed_products_and_nothing_for_open_ones():
    assert bp.customer_unit_price_kobo(biller(category=BillerCategory.DATA, price_kobo=50000, markup_percent=Decimal("5"))) == 52500
    assert bp.customer_unit_price_kobo(biller()) is None


def test_rounding_is_to_the_nearest_kobo():
    q = bp.quote(biller(markup_percent=Decimal("1.5"), commission_percent=Decimal("0.8")), amount_kobo=12345)
    assert q.charge_kobo == 12530 and q.commission_kobo == 99          # 12530.175 / 98.76


def test_an_open_product_needs_an_amount():
    with pytest.raises(ValueError):
        bp.quote(biller(), amount_kobo=None)


@pytest.mark.parametrize("category,name,expected", [
    (BillerCategory.AIRTIME, "MTN", "3.0"), (BillerCategory.DATA, "AIRTEL", "3.0"), (BillerCategory.AIRTIME, "GLO", "5.0"),
    (BillerCategory.DATA, "9MOBILE", "4.5"), (BillerCategory.CABLE_TV, "DSTV", "1.5"), (BillerCategory.CABLE_TV, "ShowMax TV", "0"),
    (BillerCategory.ELECTRICITY, "Eko Electricity Distribution Prepaid", "1.0"),
    (BillerCategory.ELECTRICITY, "Ikeja Electricity Distribution Postpaid", "0.8"),
    (BillerCategory.ELECTRICITY, "Abuja Electricity Distribution Prepaid", "1.5"),
    (BillerCategory.ELECTRICITY, "BEDC", "1.8"), (BillerCategory.ELECTRICITY, "Enugu Electricity Distribution Prepaid", "1.8"),
    (BillerCategory.ELECTRICITY, "Ibadan Electricity Distribution Prepaid", "0.9"), (BillerCategory.ELECTRICITY, "Jos Electricity Distribution Prepaid", "1.5"),
    (BillerCategory.ELECTRICITY, "Kaduna Electricity Distribution Prepaid", "1.5"), (BillerCategory.ELECTRICITY, "Kano Electricity Distribution Prepaid", "1.3"),
    (BillerCategory.ELECTRICITY, "Port Harcourt Electricity Distribution Prepaid", "1.4"),
    (BillerCategory.ELECTRICITY, "Aba Electricity Distribution Prepaid", "1.5"), (BillerCategory.ELECTRICITY, "Yola Electricity Distribution Prepaid", "1.1"),
    (BillerCategory.EDUCATION, "Nigeria JAMB", "0"),
])
def test_default_commission_follows_monnifys_sheet(category, name, expected):
    assert bp.default_commission_percent(category, name) == Decimal(expected)


# ── pay_bill uses the quote ───────────────────────────────────────────────

class DB:
    def __init__(self, b):
        self.b, self.added, self.commits = b, [], 0

    async def get(self, model, pk):
        return self.b

    def add(self, o):
        self.added.append(o)

    async def flush(self):
        for o in self.added:
            if getattr(o, "id", None) is None:
                o.id = uuid.uuid4()

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass

    async def refresh(self, o):
        pass

    async def execute(self, stmt):
        return SimpleNamespace(first=lambda: None)


def run_pay(monkeypatch, b, *, amount_kobo, quantity=1, balance=10_000_000, vend_result=None):
    db, log = DB(b), SimpleNamespace(debits=[], vends=[], credits=[])

    class Provider:
        async def validate_customer(self, **kw):
            return {}

        async def vend_bill(self, **kw):
            log.vends.append(kw)
            return vend_result or {"vendStatus": "SUCCESS", "transactionReference": "T"}

    async def noop(*a, **k):
        return None

    async def wallet(db_, owner):
        return SimpleNamespace(id=uuid.uuid4(), balance_kobo=balance)

    async def debit(db_, **kw):
        log.debits.append(kw)

    async def credit(db_, **kw):
        log.credits.append(kw)
    monkeypatch.setattr(svc, "get_bills_provider", lambda: Provider())
    monkeypatch.setattr(svc, "_enforce_director_rules", noop)
    monkeypatch.setattr(svc, "get_or_create_wallet", wallet)
    monkeypatch.setattr(svc, "debit_wallet", debit)
    monkeypatch.setattr(svc, "credit_wallet", credit)
    monkeypatch.setattr(svc, "log_action", noop)
    req = asyncio.run(svc.pay_bill(db, customer_id=uuid.uuid4(), biller_id=b.id, customer_reference="08031234567",
                                   amount_kobo=amount_kobo, quantity=quantity, initiated_by="customer"))
    return req, log


def test_customer_is_charged_our_price_but_monnify_is_asked_for_the_face_value(monkeypatch):
    b = biller(markup_percent=Decimal("2"), commission_percent=Decimal("3"))
    req, log = run_pay(monkeypatch, b, amount_kobo=100000)
    assert log.debits[0]["amount_kobo"] == 102000
    assert log.vends[0]["amount_kobo"] == 100000
    assert (req.amount_kobo, req.vend_amount_kobo, req.markup_kobo, req.commission_kobo) == (102000, 100000, 2000, 3000)
    assert req.status == BillPaymentStatus.COMPLETED


def test_a_failed_vend_refunds_what_the_customer_actually_paid(monkeypatch):
    b = biller(markup_percent=Decimal("2"))
    req, log = run_pay(monkeypatch, b, amount_kobo=100000, vend_result={"vendStatus": "FAILED", "message": "no float"})
    assert req.status == BillPaymentStatus.FAILED and log.credits[0]["amount_kobo"] == 102000


def test_monnifys_minimum_is_enforced_before_any_money_moves(monkeypatch):
    b = biller(min_amount_kobo=10000)
    with pytest.raises(ValueError, match="minimum"):
        run_pay(monkeypatch, b, amount_kobo=5000)
    b2 = biller(category=BillerCategory.ELECTRICITY, min_amount_kobo=100000, max_amount_kobo=10000000)
    with pytest.raises(ValueError, match="maximum"):
        run_pay(monkeypatch, b2, amount_kobo=20000000)


def test_the_customer_balance_must_cover_our_price_not_just_the_face_value(monkeypatch):
    b = biller(markup_percent=Decimal("10"))
    with pytest.raises(ValueError, match="Insufficient"):
        run_pay(monkeypatch, b, amount_kobo=100000, balance=105000)


# ── director tools ────────────────────────────────────────────────────────

def test_price_row_shows_profit_per_sale_for_fixed_and_per_1000_for_open():
    fixed = bill_admin.price_row(biller(category=BillerCategory.DATA, price_kobo=150000, markup_percent=Decimal("5")))
    assert fixed["customer_price_kobo"] == 157500 and fixed["profit_kobo"] == 7500 + 4500 and fixed["profit_basis_kobo"] == 150000
    open_ = bill_admin.price_row(biller())
    assert open_["customer_price_kobo"] is None and open_["profit_kobo"] == 3000 and open_["profit_basis_kobo"] == 100000


def test_pricing_validation():
    with pytest.raises(ValueError):
        bill_admin.validate_pricing_patch({"markup_percent": 500})
    with pytest.raises(ValueError):
        bill_admin.validate_pricing_patch({"commission_percent": -1})
    with pytest.raises(ValueError, match="markup"):
        bill_admin.validate_pricing_patch({"customer_price_kobo": 5000}, biller_fixed=False)
    bill_admin.validate_pricing_patch({"customer_price_kobo": 5000, "markup_percent": 3}, biller_fixed=True)


def test_report_periods_are_lagos_days():
    today = date(2026, 10, 28)   # a Wednesday
    f, t, label = bill_admin.range_bounds("today", today)
    assert (f.isoformat(), t.isoformat(), label) == ("2026-10-28T00:00:00+01:00", "2026-10-29T00:00:00+01:00", "Today")
    f, t, _ = bill_admin.range_bounds("week", today)
    assert f.date() == date(2026, 10, 26)
    f, t, _ = bill_admin.range_bounds("month", today)
    assert f.date() == date(2026, 10, 1)
    f, t, _ = bill_admin.range_bounds("custom", today, date(2026, 10, 1), date(2026, 10, 7))
    assert t.date() == date(2026, 10, 8)
    with pytest.raises(ValueError):
        bill_admin.range_bounds("custom", today, date(2026, 10, 9), date(2026, 10, 1))
    with pytest.raises(ValueError):
        bill_admin.range_bounds("custom", today, None, None)
