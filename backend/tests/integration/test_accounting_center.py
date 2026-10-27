"""Accounting Center: director-only, price book drives costs, measured vs rate vs missing, expenses with no lock, cash to hold."""
import asyncio
import os
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL") or "postgresql+asyncpg://x@localhost/x_test")
from app.services.accounting_service import _segments, cost_sql, _buckets
from app.models.accounting import CostRate
from datetime import date
from decimal import Decimal


def test_rate_segments_split_at_price_changes():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    r1 = CostRate(rate_key="k", mode="flat", value=10, effective_from=t0 + timedelta(days=10))
    r2 = CostRate(rate_key="k", mode="flat", value=20, effective_from=t0 + timedelta(days=20))
    segs = _segments([r1, r2], t0, t0 + timedelta(days=30))
    assert [(s[0] - t0).days for s in segs] == [0, 20] and segs[0][2] is r1 and segs[1][2] is r2   # first price covers earlier history
    assert _segments([], t0, t0 + timedelta(days=1)) == [(t0, t0 + timedelta(days=1), None)]


def test_cost_sql_flat_percent_cap():
    assert cost_sql(CostRate(mode="flat", value=Decimal("30.00")), "x", None) == "(3000.00)"
    assert "LEAST(ROUND(a * 1.50 / 100.0), 500)" == cost_sql(CostRate(mode="percent", value=Decimal("1.50"), cap_kobo=500), "a", None)
    assert cost_sql(CostRate(mode="flat", value=Decimal("5.00")), "x", "q") == "(500.00 * q)"


def test_buckets_are_bounded():
    assert len(_buckets(date(2026, 1, 1), date(2026, 1, 7))) == 7
    assert len(_buckets(date(2026, 1, 1), date(2026, 3, 1))) <= 10
    assert len(_buckets(date(2024, 1, 1), date(2026, 3, 1))) == 12


TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "")
_db = TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0].lower() if TEST_DB_URL else ""
needs_db = pytest.mark.skipif(not TEST_DB_URL or "test" not in _db, reason="needs TEST_DATABASE_URL (a *test* database)")


@needs_db
def test_accounting_end_to_end():
    asyncio.run(_run())


async def _run():
    os.environ["DATABASE_URL"] = TEST_DB_URL
    import httpx
    from fastapi import Request
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    import app.main as main_mod
    from app.core.database import Base, get_db
    from app.core.dependencies import get_current_user
    from app.core.limiter import limiter
    from app.models.funding_fee import FundingRecord
    from app.models.accounting import ProviderUsage
    from app.models.user import User, UserRole, UserStatus
    from app.verification.models import VerificationLookup

    limiter.enabled = False
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        c = User(role=UserRole.CUSTOMER, full_name="Ada", phone_number="08011112222", status=UserStatus.ACTIVE)
        d = User(role=UserRole.DIRECTOR, full_name="Dir", phone_number="08077778888", status=UserStatus.ACTIVE)
        db.add_all([c, d]); await db.flush()
        db.add_all([
            FundingRecord(reference="R1", gross_kobo=10_000, customer_fee_kobo=1000, credited_kobo=9000, monnify_fee_kobo=161),
            FundingRecord(reference="R2", gross_kobo=20_000, customer_fee_kobo=0, credited_kobo=20_000, monnify_fee_kobo=None),
            ProviderUsage(rate_key="termii.sms", quantity=3),
        ])
        now = datetime.now(timezone.utc)
        for i, (m, t, fee) in enumerate([("nin", "regular", 5000), ("bvn", "standard", 8000)]):
            db.add(VerificationLookup(kind=m, method=m, customer_id=c.id, initiated_by_id=c.id, client_request_id=f"cr{i}", status="found",
                                      tier_used=t, fee_kobo=fee, consent_at=now))
        await db.commit()
        ids = {"c": c.id, "d": d.id}
    who = {"id": ids["d"]}

    async def override(request: Request):
        async with maker() as s:
            return await s.get(User, who["id"])
    main_mod.app.dependency_overrides[get_current_user] = override

    async def db_override():
        async with maker() as s:
            yield s
            await s.commit()
    main_mod.app.dependency_overrides[get_db] = db_override

    A = "/api/v1/director/accounting"
    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as cl:
        # nobody but a director
        who["id"] = ids["c"]
        assert (await cl.get(f"{A}/report")).status_code == 403
        assert (await cl.post(f"{A}/expenses", json={"spent_on": "2026-01-01", "category": "x", "description": "y", "amount_naira": 5})).status_code == 403
        who["id"] = ids["d"]

        # no prices typed yet: unpriced events are flagged, never guessed
        rep = (await cl.get(f"{A}/report?series=false")).json()
        by = {s["key"]: s for s in rep["services"]}
        assert by["funding"]["revenue_kobo"] == 1000 and by["funding"]["cost_kobo"] == 161 and by["funding"]["unpriced_events"] == 1
        assert by["techhub_nin_regular"]["cost_kobo"] == 0 and by["techhub_nin_regular"]["cost_source"] == "missing"
        assert {w["key"] for w in rep["warnings"]} >= {"funding", "techhub_nin_regular", "techhub_bvn_standard", "sms"}

        # the director types the prices in
        for body in ({"rate_key": "techhub.nin.regular", "value": 30},
                     {"rate_key": "techhub.bvn.standard", "value": 60},
                     {"rate_key": "monnify.funding", "mode": "percent", "value": 1.5, "cap_kobo": 500},
                     {"rate_key": "termii.sms", "value": 5}):
            r = await cl.post(f"{A}/rates", json=body)
            assert r.status_code == 200, r.text
        assert (await cl.post(f"{A}/rates", json={"rate_key": "made.up", "value": 1})).status_code == 404
        assert (await cl.post(f"{A}/rates", json={"rate_key": "termii.sms", "mode": "percent", "value": 150})).status_code == 422

        # a price that only starts tomorrow does not touch today's numbers
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
        assert (await cl.post(f"{A}/rates", json={"rate_key": "termii.sms", "value": 99, "effective_from": tomorrow})).status_code == 200

        rep = (await cl.get(f"{A}/report?series=false")).json()
        by = {s["key"]: s for s in rep["services"]}
        assert by["funding"]["cost_kobo"] == 161 + 300 and by["funding"]["cost_source"] == "measured + rate"
        assert by["techhub_nin_regular"]["revenue_kobo"] == 5000 and by["techhub_nin_regular"]["cost_kobo"] == 3000 and by["techhub_nin_regular"]["margin_kobo"] == 2000
        assert by["techhub_bvn_standard"]["cost_kobo"] == 6000 and by["techhub_bvn_standard"]["margin_kobo"] == 2000
        assert by["sms"]["cost_kobo"] == 1500 and by["sms"]["count"] == 3
        assert rep["warnings"] == []
        t = rep["totals"]
        assert t["revenue_kobo"] == 1000 + 5000 + 8000
        assert t["provider_cost_kobo"] == 461 + 3000 + 6000 + 1500
        assert t["gross_profit_kobo"] == t["revenue_kobo"] - t["provider_cost_kobo"]

        # expenses: add, edit, delete any time (no lock), and net profit follows
        today = datetime.now(timezone(timedelta(hours=1))).date().isoformat()
        r = await cl.post(f"{A}/expenses", json={"spent_on": today, "category": "Rent", "description": "Office", "amount_naira": 20})
        assert r.status_code == 200 and r.json()["amount_kobo"] == 2000
        eid = r.json()["id"]
        old = (datetime.now(timezone.utc) - timedelta(days=200)).date().isoformat()
        r2 = await cl.post(f"{A}/expenses", json={"spent_on": old, "category": "Rent", "description": "Remembered late", "amount_naira": 7})
        assert r2.status_code == 200
        assert (await cl.put(f"{A}/expenses/{eid}", json={"spent_on": today, "category": "Rent", "description": "Office", "amount_naira": 25})).json()["amount_kobo"] == 2500
        rep = (await cl.get(f"{A}/report")).json()
        assert rep["totals"]["expenses_kobo"] == 2500 and rep["totals"]["net_profit_kobo"] == rep["totals"]["gross_profit_kobo"] - 2500
        assert len(rep["series"]) >= 1 and sum(p["revenue_kobo"] for p in rep["series"]) == rep["totals"]["revenue_kobo"]
        assert (await cl.delete(f"{A}/expenses/{r2.json()['id']}")).json()["deleted"] is True
        assert (await cl.delete(f"{A}/expenses/{r2.json()['id']}")).status_code == 404

        # price book + cash to hold + export
        rates = (await cl.get(f"{A}/rates")).json()["rates"]
        sms = next(x for x in rates if x["key"] == "termii.sms")
        assert sms["current"]["value"] == 5 and len(sms["history"]) == 2
        h = (await cl.put(f"{A}/settings", json={"buffer_days": 10})).json()
        assert h["buffer_days"] == 10 and h["should_hold_kobo"] == h["wallet_balances_kobo"] + h["pending_payouts_kobo"] + h["buffer_kobo"]
        csv_ = await cl.get(f"{A}/export.csv")
        assert csv_.status_code == 200 and "Net profit" in csv_.text and "Office" in csv_.text
    main_mod.app.dependency_overrides.clear()
