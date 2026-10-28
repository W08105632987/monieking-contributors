"""Module D1: director powers over a customer, identity service delete, analytics today/visitors."""
import asyncio
import os

import pytest

TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "")
_db_name = TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0].lower() if TEST_DB_URL else ""
pytestmark = pytest.mark.skipif(not TEST_DB_URL or "test" not in _db_name, reason="needs TEST_DATABASE_URL (a *test* database)")

if TEST_DB_URL and "test" in _db_name:
    os.environ["DATABASE_URL"] = TEST_DB_URL
    import httpx
    from sqlalchemy import text, select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    import app.main as main_mod
    from app.core.database import Base, get_db
    from app.core.dependencies import get_current_user
    from app.core.security import hash_withdrawal_password
    from app.models.user import User, UserRole, UserStatus
    from app.models.wallet import Wallet
    from app.models.analytics_event import AnalyticsEvent
    from fastapi import Request


async def _run(monkeypatch):
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        d = User(role=UserRole.DIRECTOR, full_name="Dir", phone_number="08040000000", status=UserStatus.ACTIVE,
                 payment_pin_hash=hash_withdrawal_password("4821"))
        real = User(role=UserRole.CUSTOMER, full_name="Real Ada", phone_number="08022222222", status=UserStatus.ACTIVE)
        empty = User(role=UserRole.CUSTOMER, full_name="Empty Eze", phone_number="08033333333", status=UserStatus.ACTIVE)
        db.add_all([d, real, empty])
        await db.flush()
        db.add(Wallet(owner_id=real.id, balance_kobo=500000))
        db.add(AnalyticsEvent(event_type="pageview", path="/", session_id="abcdefgh1234", user_id=real.id, role="customer"))
        db.add(AnalyticsEvent(event_type="pageview", path="/", session_id="zzzzzzzz9999", user_id=None, role=None))
        await db.commit()
        dir_id, real_id, empty_id = d.id, real.id, empty.id

    async def override(request: Request):
        async with maker() as s:
            return await s.get(User, dir_id)
    main_mod.app.dependency_overrides[get_current_user] = override

    async def db_override():
        async with maker() as s:
            yield s
            await s.commit()
    main_mod.app.dependency_overrides[get_db] = db_override

    calls = []

    async def fake_admin(method, path, **kw):
        calls.append((method, path))
        class R:  # noqa: N801
            status_code = 200
        return R()
    monkeypatch.setattr("app.utils.supabase_admin_client.supabase_admin_request", fake_admin)
    async def fake_sms(*a, **k):
        return True
    monkeypatch.setattr("app.services.sms_service.send_sms", fake_sms)

    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        base = "/api/v1/customer-admin"
        # wrong PIN refused
        r = await c.post(f"{base}/{real_id}/reset-password", json={"pin": "0000"})
        assert r.status_code in (400, 401, 403)
        r = await c.post(f"{base}/{real_id}/reset-password", json={"pin": "4821"})
        assert r.status_code == 200 and r.json()["sms_sent"] is False and r.json()["temporary_password"].endswith("MK")
        assert ("PUT", f"/auth/v1/admin/users/{real_id}") in calls

        # manual funding
        r = await c.post(f"{base}/{real_id}/fund-wallet", json={"amount_naira": 1500, "reason": "Bank transfer proof seen", "pin": "4821"})
        assert r.status_code == 200 and r.json()["balance_kobo"] == 650000
        r = await c.post(f"{base}/{real_id}/fund-wallet", json={"amount_naira": 10, "reason": "x", "pin": "4821"})
        assert r.status_code == 422

        # manual debit: needs PIN + reason, cannot overdraw, balance drops, then restore for the checks below
        r = await c.post(f"{base}/{real_id}/debit-wallet", json={"amount_naira": 100, "reason": "Funded by mistake", "pin": "0000"})
        assert r.status_code in (400, 401, 403)
        r = await c.post(f"{base}/{real_id}/debit-wallet", json={"amount_naira": 100, "reason": "x", "pin": "4821"})
        assert r.status_code == 422
        r = await c.post(f"{base}/{real_id}/debit-wallet", json={"amount_naira": 4_000_000, "reason": "Too much on purpose", "pin": "4821"})
        assert r.status_code == 400
        r = await c.post(f"{base}/{real_id}/debit-wallet", json={"amount_naira": 100, "reason": "Funded by mistake", "pin": "4821"})
        assert r.status_code == 200 and r.json()["balance_kobo"] == 640000
        r = await c.post(f"{base}/{real_id}/fund-wallet", json={"amount_naira": 100, "reason": "Debit reversed again", "pin": "4821"})
        assert r.status_code == 200 and r.json()["balance_kobo"] == 650000

        # delete preview: real customer with money is archived, not erased
        r = await c.get(f"{base}/{real_id}/delete-preview")
        assert r.status_code == 200 and r.json()["mode"] == "archive" and r.json()["wallet_balance_kobo"] == 650000
        r = await c.post(f"{base}/{real_id}/delete", json={"confirm_name": "wrong", "pin": "4821", "acknowledge_money": True})
        assert r.status_code == 400
        r = await c.post(f"{base}/{real_id}/delete", json={"confirm_name": "Real Ada", "pin": "4821"})
        assert r.status_code == 409
        r = await c.post(f"{base}/{real_id}/delete", json={"confirm_name": "Real Ada", "pin": "4821", "acknowledge_money": True})
        assert r.status_code == 200 and r.json()["result"] == "archived"

        # empty customer is erased and the phone is free
        r = await c.get(f"{base}/{empty_id}/delete-preview")
        assert r.json()["mode"] == "delete"
        r = await c.post(f"{base}/{empty_id}/delete", json={"confirm_name": "empty eze", "pin": "4821"})
        assert r.status_code == 200 and r.json()["result"] == "deleted"

        # analytics
        r = await c.get("/api/v1/analytics/overview?today=true")
        assert r.status_code == 200 and r.json()["pageviews"] == 2
        r = await c.get("/api/v1/analytics/visitors?today=true")
        assert r.status_code == 200 and r.json()["anonymous"] == 1

    async with maker() as db:
        archived = await db.get(User, real_id)
        assert archived.deleted_at is not None and archived.full_name == "Deleted customer" and archived.phone_number != "08022222222"
        assert (await db.get(User, empty_id)) is None
        w = (await db.execute(select(Wallet).where(Wallet.owner_id == real_id))).scalar_one()
        assert w.balance_kobo == 650000          # money records survive
    main_mod.app.dependency_overrides.clear()
    await engine.dispose()


def test_customer_admin(monkeypatch):
    asyncio.run(_run(monkeypatch))
