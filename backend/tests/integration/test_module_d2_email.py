"""Optional verified email: add/verify/remove, reset by email with SMS fallback, health-check blip handling."""
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
    from app.core.limiter import limiter
    from app.models.user import User, UserRole, UserStatus
    from fastapi import Request


async def _run(monkeypatch):
    limiter.enabled = False
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        a = User(role=UserRole.CUSTOMER, full_name="Ada", phone_number="08011112222", status=UserStatus.ACTIVE)
        b = User(role=UserRole.DIRECTOR, full_name="Dir", phone_number="08033334444", status=UserStatus.ACTIVE)
        db.add_all([a, b])
        await db.commit()
        ids = {"a": a.id, "b": b.id}
    who = {"id": ids["a"]}

    async def override(request: Request):
        async with maker() as s:
            return await s.get(User, who["id"])
    main_mod.app.dependency_overrides[get_current_user] = override

    async def db_override():
        async with maker() as s:
            yield s
            await s.commit()
    main_mod.app.dependency_overrides[get_db] = db_override

    sent = {"email": [], "sms": [], "email_ok": True}

    async def fake_email(to, subject, body, html=None):
        sent["email"].append((to, body))
        return sent["email_ok"]

    async def fake_sms(phone, msg, *a, **k):
        sent["sms"].append((phone, msg))
    pw = {}

    async def fake_supabase(method, path, **k):
        pw["last"] = (method, path, k.get("json"))
        return None
    import app.services.email_service as es
    monkeypatch.setattr(es, "send_email", fake_email)
    import app.integrations.termii as termii
    monkeypatch.setattr(termii, "send_sms", fake_sms)
    import app.utils.supabase_admin_client as sac
    monkeypatch.setattr(sac, "supabase_admin_request", fake_supabase)

    def code_from(body):
        return body.split("code is ")[1][:6]

    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        e = "/api/v1/auth/email"
        assert (await c.post(f"{e}/send-code", json={"email": "not-an-email"})).status_code == 400
        r = await c.post(f"{e}/send-code", json={"email": "Ada@Example.com"})
        assert r.status_code == 200 and r.json()["sent"] is True
        me = (await c.get("/api/v1/users/me")).json()
        assert me["email_verified"] is False and me["pending_email"] == "ada@example.com"
        code = code_from(sent["email"][-1][1])
        wrong = "000000" if code != "000000" else "111111"
        assert (await c.post(f"{e}/verify", json={"code": wrong})).status_code == 400
        assert (await c.post(f"{e}/verify", json={"code": code})).status_code == 200
        me = (await c.get("/api/v1/users/me")).json()
        assert me["email"] == "ada@example.com" and me["email_verified"] is True and me["pending_email"] is None

        # the same email cannot be verified on another account
        who["id"] = ids["b"]
        assert (await c.post(f"{e}/send-code", json={"email": "ada@example.com"})).status_code == 409
        r = await c.post(f"{e}/send-code", json={"email": "boss@example.com"})
        assert r.status_code == 200
        assert (await c.post(f"{e}/verify", json={"code": code_from(sent["email"][-1][1])})).status_code == 200
        who["id"] = ids["a"]

        # five wrong codes locks that code
        await c.post(f"{e}/send-code", json={"email": "ada2@example.com"})
        c2 = code_from(sent["email"][-1][1])
        bad = "000000" if c2 != "000000" else "111111"
        for _ in range(5):
            assert (await c.post(f"{e}/verify", json={"code": bad})).status_code == 400
        assert (await c.post(f"{e}/verify", json={"code": c2})).status_code == 429
        assert (await c.post(f"{e}/resend")).status_code == 200

        # forgot password: by verified email -> code goes by email, not SMS
        f = "/api/v1/auth/forgot-password"
        sent["email"].clear(); sent["sms"].clear()
        r = await c.post(f"{f}/request-otp", json={"identifier": "ada@example.com"})
        assert r.status_code == 200 and sent["email"] and not sent["sms"]
        otp = code_from(sent["email"][-1][1])
        r = await c.post(f"{f}/reset", json={"identifier": "ada@example.com", "otp": "999999" if otp != "999999" else "888888", "new_password": "NewPassw0rd"})
        assert r.status_code == 400
        r = await c.post(f"{f}/reset", json={"identifier": "ada@example.com", "otp": otp, "new_password": "NewPassw0rd"})
        assert r.status_code == 200 and pw["last"][0] == "PUT" and pw["last"][2] == {"password": "NewPassw0rd"}
        # single use
        assert (await c.post(f"{f}/reset", json={"identifier": "ada@example.com", "otp": otp, "new_password": "NewPassw0rd"})).status_code == 400

        # by phone: default is SMS
        sent["email"].clear(); sent["sms"].clear()
        await c.post(f"{f}/request-otp", json={"phone_number": "08011112222"})
        assert sent["sms"] and not sent["email"]
        # by phone but choosing email -> email
        sent["sms"].clear()
        await c.post(f"{f}/request-otp", json={"phone_number": "08011112222", "channel": "email"})
        assert sent["email"] and not sent["sms"]
        # email cannot be sent -> falls back to SMS
        sent["email"].clear(); sent["email_ok"] = False
        await c.post(f"{f}/request-otp", json={"identifier": "ada@example.com"})
        assert sent["sms"]
        # unknown account: same generic answer, nothing sent
        sent["email"].clear(); sent["sms"].clear()
        r = await c.post(f"{f}/request-otp", json={"identifier": "nobody@example.com"})
        assert r.status_code == 200 and not sent["email"] and not sent["sms"]
        # wrong codes burn the reset code after five tries
        sent["email_ok"] = True
        await c.post(f"{f}/request-otp", json={"phone_number": "08011112222"})
        real = code_from(sent["sms"][-1][1])
        bad = "000000" if real != "000000" else "111111"
        for _ in range(5):
            assert (await c.post(f"{f}/reset", json={"phone_number": "08011112222", "otp": bad, "new_password": "NewPassw0rd"})).status_code == 400
        assert (await c.post(f"{f}/reset", json={"phone_number": "08011112222", "otp": real, "new_password": "NewPassw0rd"})).status_code == 429

        # removing the email
        assert (await c.delete(e)).status_code == 200
        assert (await c.get("/api/v1/users/me")).json()["email"] is None

    # health: slow-but-answering database is degraded not down, and one blip does not alert
    from app.services import health_service as hs
    async with maker() as db:
        r = await hs.check_database(db)
        assert r["status"] == "healthy" and "connect_ms" in r["metrics"]
        monkeypatch.setattr(hs.settings, "HEALTH_CHECK_DB_LATENCY_CRITICAL_MS", 0)
        monkeypatch.setattr(hs.settings, "HEALTH_CHECK_DB_LATENCY_WARN_MS", 0)
        r = await hs.check_database(db)
        assert r["status"] == "degraded"
        alerts = []

        async def fake_alert(db_, **k):
            alerts.append(k["status"])
        monkeypatch.setattr(hs, "_send_alert", fake_alert)
        await hs._maybe_alert(db, {"check_name": "database", "status": "degraded", "message": "x"}, "healthy")
        assert alerts == []
        await hs._maybe_alert(db, {"check_name": "database", "status": "degraded", "message": "x"}, "degraded")
        assert alerts == ["degraded"]
        await hs._maybe_alert(db, {"check_name": "redis", "status": "down", "hard": True, "message": "x"}, "healthy")
        assert alerts == ["degraded", "down"]
    main_mod.app.dependency_overrides.clear()
    await engine.dispose()


def test_email_and_health(monkeypatch):
    asyncio.run(_run(monkeypatch))
