"""Module C: director bills config, phone validator, enforcement on pay."""
import asyncio
import os

import pytest

TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "")
_db_name = TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0].lower() if TEST_DB_URL else ""
pytestmark = pytest.mark.skipif(not TEST_DB_URL or "test" not in _db_name, reason="needs TEST_DATABASE_URL (a *test* database)")

if TEST_DB_URL and "test" in _db_name:
    os.environ["DATABASE_URL"] = TEST_DB_URL
    import httpx
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    import app.main as main_mod
    from app.core.database import Base
    from app.core.dependencies import get_current_user
    from app.models.user import User, UserRole, UserStatus
    from app.models.wallet import Wallet
    from app.models.bill_payment import Biller, BillerCategory
    from app.services import settings_service


def test_pure_helpers():
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")
    from app.services.bill_config import normalize_phone, detect_network, is_vtu_plan
    assert normalize_phone("+2348031234567") == "08031234567"
    assert normalize_phone("8031234567") == "08031234567"
    assert normalize_phone("0803123") is None
    assert normalize_phone("01234567890") is None
    assert detect_network("08031234567") == "MTN"
    assert detect_network("08051234567") == "Glo"
    assert is_vtu_plan("1GB VTU") and not is_vtu_plan("1GB SME")


async def _run(monkeypatch):
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    users = {}
    async with maker() as db:
        for key, role, phone in [("ada", UserRole.CUSTOMER, "08011111111"), ("dir", UserRole.DIRECTOR, "08044444444")]:
            u = User(role=role, full_name=key, phone_number=phone, bank_code="058", bank_name="GTBank", account_number="0123456789",
                     account_name=key.upper(), status=UserStatus.ACTIVE)
            db.add(u)
            await db.flush()
            users[key] = u.id
        db.add(Wallet(owner_id=users["ada"], balance_kobo=10_000_000))
        db.add(Biller(monnify_biller_id="MTN", category=BillerCategory.AIRTIME, name="MTN Airtime", product_id="11", product_name="MTN VTU", price_kobo=None))
        await db.commit()
        airtime_id = (await db.execute(text("select id from billers"))).scalar()

    from fastapi import Request

    async def override(request: Request):
        async with maker() as db:
            return await db.get(User, users[request.headers.get("x-test-user")])
    main_mod.app.dependency_overrides[get_current_user] = override
    settings_service._config_cache.clear()

    class FakeProvider:
        async def validate_customer(self, **kw): return {}
        async def vend_bill(self, **kw): return {"transactionReference": "TX1"}
    monkeypatch.setattr("app.integrations.monnify_bills.get_bills_provider", lambda: FakeProvider())
    monkeypatch.setattr("app.services.bill_payment_service.get_bills_provider", lambda: FakeProvider())
    monkeypatch.setattr("app.api.v1.routes.bill_payments.get_bills_provider", lambda: FakeProvider())

    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        async def call(who, method, path, expect=200, **kw):
            r = await c.request(method, "/api/v1/bill-payments" + path, headers={"x-test-user": who}, **kw)
            assert r.status_code == expect, f"{who} {method} {path} -> {r.status_code}: {r.text[:300]}"
            return r.json()

        cfg = await call("ada", "GET", "/config")
        assert cfg["airtime_enabled"] and cfg["networks"]["MTN"]
        await call("ada", "PUT", "/admin/config", expect=403, json={"airtime_enabled": False})

        v = await call("ada", "POST", "/validate-phone", json={"phone": "08031234567", "network": "MTN"})
        assert v["valid"] and v["network"] == "MTN" and v["verified"]
        v = await call("ada", "POST", "/validate-phone", json={"phone": "08031234567", "network": "Glo"})
        assert not v["valid"] and v["network"] == "MTN"
        v = await call("ada", "POST", "/validate-phone", json={"phone": "123"})
        assert not v["valid"]

        pay = {"biller_id": str(airtime_id), "customer_reference": "08031234567", "amount_kobo": 20_000}
        r = await call("ada", "POST", "/pay", 201, json=pay)
        assert r["status"] == "completed"

        await call("dir", "PUT", "/admin/config", json={"min_airtime_naira": 500})
        await call("ada", "POST", "/pay", 400, json=pay)            # ₦200 < new ₦500 minimum
        await call("dir", "PUT", "/admin/config", json={"min_airtime_naira": 50, "networks": {"MTN": False}})
        await call("ada", "POST", "/pay", 400, json=pay)            # MTN switched off
        await call("dir", "PUT", "/admin/config", json={"networks": {"MTN": True}, "airtime_enabled": False})
        await call("ada", "POST", "/pay", 400, json=pay)            # airtime switched off
        await call("dir", "PUT", "/admin/config", json={"airtime_enabled": True})
        await call("ada", "POST", "/pay", 400, json={**pay, "customer_reference": "08051234567"})   # Glo number on MTN
        await call("dir", "PUT", "/admin/config", 400, json={"min_airtime_naira": 900, "max_airtime_naira": 100})

        async def seasonal(who, method, body=None, expect=200):
            r = await c.request(method, "/api/v1/seasonal", headers={"x-test-user": who}, json=body)
            assert r.status_code == expect, r.text
            return r.json()
        assert await seasonal("ada", "GET") == {"christmas": False, "new_year": False, "easter": False}
        await seasonal("ada", "PUT", {"christmas": True}, 403)
        out = await seasonal("dir", "PUT", {"christmas": True, "new_year": True})
        assert out["christmas"] and out["new_year"] and not out["easter"]
        assert (await seasonal("ada", "GET"))["christmas"] is True
    await engine.dispose()


def test_bills_config_flow(monkeypatch):
    asyncio.run(_run(monkeypatch))
