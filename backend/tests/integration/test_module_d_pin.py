"""Payment PIN: set, change, verify, lockout; missing PIN gives 428 'Set up payment pin'; withdrawal password kept separate."""
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
    from app.core.database import Base, get_db
    from app.core.dependencies import get_current_user
    from app.models.user import User, UserRole, UserStatus
    from fastapi import Request


async def _run():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        u = User(role=UserRole.CUSTOMER, full_name="Ada", phone_number="08011112222", status=UserStatus.ACTIVE)
        db.add(u)
        await db.commit()
        uid = u.id

    async def override(request: Request):
        async with maker() as s:
            return await s.get(User, uid)
    main_mod.app.dependency_overrides[get_current_user] = override

    async def db_override():
        async with maker() as s:
            yield s
            await s.commit()
    main_mod.app.dependency_overrides[get_db] = db_override

    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        a = "/api/v1/auth"
        # nothing set yet -> 428
        r = await c.post(f"{a}/verify-pin", json={"pin": "4821"})
        assert r.status_code == 428 and r.json()["detail"] == "Set up payment pin"
        r = await c.post("/api/v1/wallets/me/submit-kyc", json={"bvn": "12345678901", "date_of_birth": "1990-01-01", "auth_method": "password"})
        assert r.status_code == 428
        # bad PINs refused
        for bad in ("123", "12345", "abcd", "1234", "1111"):
            r = await c.post(f"{a}/set-pin", json={"pin": bad})
            assert r.status_code in (400, 422), bad
        # first time needs no current PIN
        r = await c.post(f"{a}/set-pin", json={"pin": "4821"})
        assert r.status_code == 200
        assert (await c.post(f"{a}/verify-pin", json={"pin": "4821"})).status_code == 200
        assert (await c.post(f"{a}/verify-pin", json={"pin": "0000"})).status_code == 403
        # changing needs the current PIN
        assert (await c.post(f"{a}/set-pin", json={"pin": "7391"})).status_code in (400, 403)
        assert (await c.post(f"{a}/set-pin", json={"pin": "7391", "current_pin": "4821"})).status_code == 200
        assert (await c.post(f"{a}/verify-pin", json={"pin": "7391"})).status_code == 200
        # the withdrawal password is a different secret and still unset
        r = await c.post(f"{a}/verify-withdrawal-password", json={"withdrawal_password": "7391"})
        assert r.status_code == 428 and r.json()["detail"] == "Set up withdrawal password"
        # flags in the profile
        me = (await c.get("/api/v1/users/me")).json()
        assert me["has_payment_pin"] is True and me["has_withdrawal_password"] is False
        # lockout after repeated wrong PINs
        from app.core.config import get_settings
        for _ in range(get_settings().MAX_LOGIN_ATTEMPTS):
            r = await c.post(f"{a}/verify-pin", json={"pin": "0001"})
        assert r.status_code == 429
        assert (await c.post(f"{a}/verify-pin", json={"pin": "7391"})).status_code == 429
    main_mod.app.dependency_overrides.clear()
    await engine.dispose()


def test_payment_pin():
    asyncio.run(_run())
