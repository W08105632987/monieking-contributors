"""NIN-only KYC: the gate, the verified-name preview, PIN confirm, notifications, optional phone check, on-demand account."""
import asyncio
import os
import time

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
    from app.models.notification import Notification
    from app.core.security import hash_withdrawal_password
    from fastapi import Request


def test_name_matching_and_proof_rules():
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")
    from fastapi import HTTPException
    from app.services import kyc_flow as k
    from app.core.config import settings
    assert k.names_match("Ada Okafor", "OKAFOR Ada Chioma")
    assert not k.names_match("Ada Okafor", "John Okafor")
    settings.SUPABASE_JWT_SECRET = settings.SUPABASE_JWT_SECRET or "test-secret"
    p = k.make_proof(user_id="u1", kind="nin", number="12345678901", name="Ada Okafor", name_ok=True)
    assert k.read_proof(p, user_id="u1", kind="nin", number="12345678901")["n"] == "Ada Okafor"
    for bad in (dict(user_id="u2", kind="nin", number="12345678901"), dict(user_id="u1", kind="nin", number="12345678902")):
        with pytest.raises(HTTPException):
            k.read_proof(p, **bad)
    old = k.make_proof(user_id="u1", kind="nin", number="12345678901", name="x", name_ok=True, now=time.time() - 3600)
    with pytest.raises(HTTPException):
        k.read_proof(old, user_id="u1", kind="nin", number="12345678901")


async def _run(monkeypatch):
    limiter.enabled = False
    from app.core.config import settings
    settings.SUPABASE_JWT_SECRET = settings.SUPABASE_JWT_SECRET or "test-secret"
    from cryptography.fernet import Fernet
    settings.NIN_ENCRYPTION_KEY = Fernet.generate_key().decode()
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    pin = hash_withdrawal_password("7391")
    async with maker() as db:
        a = User(role=UserRole.CUSTOMER, full_name="Ada Okafor", phone_number="08011112222", status=UserStatus.ACTIVE, payment_pin_hash=pin)
        o = User(role=UserRole.OFFICER, full_name="Obi Eze", phone_number="08055556666", status=UserStatus.ACTIVE, payment_pin_hash=pin)
        d = User(role=UserRole.DIRECTOR, full_name="Dir", phone_number="08077778888", status=UserStatus.ACTIVE, payment_pin_hash=pin)
        db.add_all([a, o, d])
        await db.commit()
        ids = {"a": a.id, "o": o.id, "d": d.id}
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

    from app.integrations import techhub as T
    calls = {"lookup": 0, "create": [], "update": [], "sms": []}

    async def fake_call(endpoint, fields, want="person"):
        calls["lookup"] += 1
        if fields.get("nin") == "00000000000":
            raise T.TechhubNotFound()
        if fields.get("nin") == "22222222222":
            return T.TechhubResult(user_data={"first_name": "John", "last_name": "Doe"}, pdf=b"")
        return T.TechhubResult(user_data={"first_name": "Ada", "last_name": "Okafor", "middle_name": "Chioma"}, pdf=b"")
    monkeypatch.setattr(T, "call_techhub", fake_call)

    class FakeProvider:
        async def create_reserved_account(self, **kw):
            calls["create"].append(kw)
            from app.integrations.base_payment_provider import ReservedAccount
            return ReservedAccount(account_number="1234567890", bank_name="Wema Bank", account_reference=kw["account_reference"],
                                   account_name=kw["account_name"], provider="monnify")

        async def update_reserved_account_kyc(self, **kw):
            calls["update"].append(kw)
    import app.api.v1.routes.kyc as kycmod
    import app.api.v1.routes.wallets as walletmod
    monkeypatch.setattr(kycmod, "get_payment_provider", lambda: FakeProvider())
    monkeypatch.setattr(walletmod, "get_payment_provider", lambda: FakeProvider())

    async def fake_sms(phone, msg, *a, **k):
        calls["sms"].append(msg)
    import app.integrations.termii as termii
    monkeypatch.setattr(termii, "send_sms", fake_sms)

    async def notes(uid):
        async with maker() as s:
            rows = (await s.execute(select(Notification).where(Notification.user_id == uid))).scalars().all()
            return [r.title for r in rows]

    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        k = "/api/v1/wallets/me/kyc"

        # 1) no KYC -> services are refused with a clear code, BEFORE any PIN is asked
        r = await c.post("/api/v1/bill-payments/pay", json={"biller_id": "00000000-0000-0000-0000-000000000000", "customer_reference": "08011112222", "amount_kobo": 10000, "pin": "7391"})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "kyc_required"
        r = await c.post("/api/v1/wallets/me/withdraw", json={"amount_kobo": 100000, "auth_method": "password", "withdrawal_password": "x"})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "kyc_required"
        r = await c.post("/api/v1/contributions", json={"card_id": "00000000-0000-0000-0000-000000000000", "amount_kobo": 10000})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "kyc_required"

        # 2) Monnify needs a BVN/NIN to create an account, so before KYC there is no on-demand account
        r = await c.post("/api/v1/wallets/me/virtual-account", json={})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "kyc_required" and not calls["create"]

        # 3) optional phone check
        assert (await c.post(f"{k}/phone/send")).status_code == 200 and calls["sms"]
        code = calls["sms"][-1].split("code is ")[1][:6]
        bad = "000000" if code != "000000" else "111111"
        assert (await c.post(f"{k}/phone/verify", json={"code": bad})).status_code == 400
        assert (await c.post(f"{k}/phone/verify", json={"code": code})).json()["phone_verified"] is True
        assert (await c.get("/api/v1/users/me")).json()["phone_verified"] is True

        # 4) NIN: not found -> failure notification
        assert (await c.post(f"{k}/nin/preview", json={"number": "00000000000"})).status_code == 404
        assert (await c.post(f"{k}/nin/preview", json={"number": "123"})).status_code == 422
        assert any("not completed" in t for t in await notes(ids["a"]))

        # 5) verified name shown BEFORE confirming
        r = await c.post(f"{k}/nin/preview", json={"number": "12345678901"})
        pv = r.json()
        assert r.status_code == 200 and pv["verified_name"] == "Ada Chioma Okafor" and pv["name_matches"] is True
        assert "12345678901" not in str(pv)
        assert (await c.get("/api/v1/users/me")).json()["kyc_complete"] is False

        # 6) wrong PIN refused; right PIN completes KYC (works even though KYC isn't complete yet)
        r = await c.post(f"{k}/nin/confirm", json={"number": "12345678901", "proof": pv["proof"], "pin": "0000"})
        assert r.status_code == 403
        r = await c.post(f"{k}/nin/confirm", json={"number": "12345678901", "proof": pv["proof"], "pin": "7391"})
        assert r.status_code == 200, r.text
        assert calls["create"][0]["nin"] == "12345678901" and calls["create"][0]["account_name"] == "Ada Chioma Okafor"   # no account yet -> created now WITH the NIN
        me = (await c.get("/api/v1/users/me")).json()
        assert me["kyc_complete"] is True and me["nin_linked"] is True and me["nin_last4"] == "8901"
        assert any("KYC complete" in t for t in await notes(ids["a"]))

        # 7) after KYC the gate opens (past the gate, the contribution fails on the missing card, not on KYC)
        r = await c.post("/api/v1/contributions", json={"card_id": "00000000-0000-0000-0000-000000000000", "amount_kobo": 10000})
        assert not (r.status_code == 403 and isinstance(r.json().get("detail"), dict) and r.json()["detail"].get("code") == "kyc_required")
        assert (await c.post(f"{k}/nin/preview", json={"number": "12345678901"})).status_code == 400   # already verified

        # 8) name on the NIN doesn't match -> can't be confirmed, failure notification (officer)
        who["id"] = ids["o"]
        r = await c.post(f"{k}/nin/preview", json={"number": "22222222222"})
        pv2 = r.json()
        assert pv2["verified_name"] == "John Doe" and pv2["name_matches"] is False and pv2["message"]
        r = await c.post(f"{k}/nin/confirm", json={"number": "22222222222", "proof": pv2["proof"], "pin": "7391"})
        assert r.status_code == 422
        assert any("not completed" in t for t in await notes(ids["o"]))

        # 9) proofs can't be replayed by someone else
        who["id"] = ids["o"]
        r = await c.post(f"{k}/nin/confirm", json={"number": "12345678901", "proof": pv["proof"], "pin": "7391"})
        assert r.status_code == 400

        # 10) NIN vault: stored encrypted, only a director can read it, reveals are audited, one-click account number
        who["id"] = ids["a"]
        async with maker() as s:
            tok = (await s.get(User, ids["a"])).nin_encrypted
        assert tok and "12345678901" not in tok and tok.startswith("gAAAA")
        r = await c.get(f"/api/v1/director-customers/{ids['a']}/nin")
        assert r.status_code == 403
        who["id"] = ids["d"]
        r = await c.get(f"/api/v1/director-customers/{ids['a']}/nin")
        assert r.status_code == 200 and r.json()["nin"] == "12345678901" and r.json()["last4"] == "8901"
        from app.models.audit import AuditLog
        async with maker() as s:
            assert (await s.execute(select(AuditLog).where(AuditLog.action == "kyc.nin_viewed"))).scalars().first()
        from app.models.wallet import Wallet
        async with maker() as s:
            w = (await s.execute(select(Wallet).where(Wallet.owner_id == ids["a"]))).scalar_one()
            w.virtual_account_number = None; w.virtual_account_ref = None
            await s.commit()
        who["id"] = ids["a"]
        n = len(calls["create"])
        r = await c.post("/api/v1/wallets/me/virtual-account", json={})
        assert r.status_code == 200 and len(calls["create"]) == n + 1 and calls["create"][-1]["nin"] == "12345678901"

        # 11) directors are never gated
        who["id"] = ids["d"]
        from app.services.kyc_gate import needs_kyc
        async with maker() as s:
            assert needs_kyc(await s.get(User, ids["d"])) is False
    main_mod.app.dependency_overrides.clear()
    await engine.dispose()


def test_kyc_flow(monkeypatch):
    asyncio.run(_run(monkeypatch))
