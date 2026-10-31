"""Bills are EARNINGS (markup + commission, no provider cost) and outside income counts in net profit."""
import os
import uuid
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="needs TEST_DATABASE_URL (a throwaway Postgres)")


@pytest_asyncio.fixture
async def db():
    from app.core.database import Base
    import app.main  # noqa: F401
    eng = create_async_engine(URL)
    async with eng.begin() as c:
        await c.execute(text("DROP SCHEMA public CASCADE"))
        await c.execute(text("CREATE SCHEMA public"))
        await c.execute(text("CREATE SEQUENCE customer_number_seq"))
        await c.execute(text("CREATE SEQUENCE card_number_seq"))
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await eng.dispose()


@pytest.mark.asyncio
async def test_bills_are_earnings_and_outside_income_counts(db):
    from app.models.accounting import ExternalIncome, Expense
    from app.models.bill_payment import Biller, BillPaymentRequest
    from app.models.user import User
    from app.services import accounting_service as svc

    now = datetime.now(timezone.utc)
    cust = User(id=uuid.uuid4(), full_name="C", phone_number="08011112222", role="customer", status="active")
    db.add(cust)
    await db.flush()
    airtime = Biller(id=uuid.uuid4(), monnify_biller_id="MTN", name="MTN", product_id="1", product_name="MTN", category="airtime")
    elec = Biller(id=uuid.uuid4(), monnify_biller_id="EKEDC", name="EKEDC", product_id="2", product_name="Eko", category="electricity")
    db.add_all([airtime, elec])
    await db.flush()

    def pay(b, face, markup, commission, status="completed"):
        return BillPaymentRequest(id=uuid.uuid4(), customer_id=cust.id, initiated_by="customer", biller_id=b.id, customer_reference="0801",
                                  amount_kobo=face + markup, markup_kobo=markup, commission_kobo=commission, status=status, completed_at=now)
    db.add_all([pay(airtime, 100000, 2000, 1500), pay(airtime, 50000, 0, 750), pay(elec, 500000, 5000, 4000),
                pay(airtime, 99999, 9999, 9999, status="failed")])          # a failed one must not count
    db.add(Expense(spent_on=date.today(), category="Rent", description="office", amount_kobo=3000))
    db.add(ExternalIncome(earned_on=date.today(), source="Other business", description="Side shop", amount_kobo=10000))
    await db.commit()

    rep = await svc.report(db, date.today(), date.today(), series=True)
    by = {r["key"]: r for r in rep["services"]}
    a = by["bill_airtime"]
    assert (a["revenue_kobo"], a["cost_kobo"], a["margin_kobo"]) == (2000 + 1500 + 750, 0, 4250)
    assert (a["markup_kobo"], a["commission_kobo"], a["count"]) == (2000, 2250, 2)
    e = by["bill_electricity"]
    assert (e["revenue_kobo"], e["cost_kobo"]) == (9000, 0)
    # no unpriced warnings and no provider-cost entries for bills any more
    assert all(not w["key"].startswith("bill_") for w in rep["warnings"])
    assert all(not k.startswith("monnify.bill.") for r in await svc.catalog(db) for k in [r["key"]])
    t = rep["totals"]
    assert t["other_income_kobo"] == 10000 and t["expenses_kobo"] == 3000
    # gross = everything earned by services; net = gross - expenses + outside income
    assert t["net_profit_kobo"] == t["gross_profit_kobo"] - 3000 + 10000
    assert rep["other_income"]["by_source"] == [{"source": "Other business", "total_kobo": 10000, "count": 1}]
    assert rep["series"][-1]["other_income_kobo"] == 10000
