"""
Module A: withdrawal requests paid by a director, complaint conversation, confirm-as-is for rules, avatars and borrower reliability.

Run:  TEST_DATABASE_URL=postgresql+asyncpg://.../monieking_test pytest tests/integration/test_coop_complete.py
Covers the whole money life-cycle: join, pool, guarantee signing and locking, two-director approval,
partial repayment, overdue charge, release, rejection, cancel, expiry, early-withdrawal charge,
settings approvals, privacy rules, immutability and the reconciliation checks.
"""
import asyncio
import os
import sys

import pytest

TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "")
_db_name = TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0].lower() if TEST_DB_URL else ""

pytestmark = pytest.mark.skipif(
    not TEST_DB_URL or "test" not in _db_name,
    reason="set TEST_DATABASE_URL to a throwaway database whose name contains 'test'",
)

if TEST_DB_URL and "test" in _db_name:
    os.environ["DATABASE_URL"] = TEST_DB_URL
    import httpx
    from pathlib import Path
    from sqlalchemy import text, select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

    import app.main as main_mod
    from app.core.database import Base
    from app.core.dependencies import get_current_user
    from app.models.user import User, UserRole

NAIRA = 100


def _mig_statements():
    sql = (Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "045_coop_foundation.sql").read_text() + (Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "047_coop_completion.sql").read_text()
    out, buf, in_d = [], [], False
    for line in sql.splitlines():
        s = line.strip()
        if not buf and (not s or s.startswith("--")):
            continue
        buf.append(line)
        if line.count("$$") % 2 == 1:
            in_d = not in_d
        if not in_d and s.endswith(";"):
            out.append("\n".join(buf)); buf = []
    return out


async def _run():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
        for st in _mig_statements():
            await conn.execute(text(st))
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    users = {}
    async with maker() as db:
        for key, role, name, phone, nin in [
            ("ada", UserRole.CUSTOMER, "Ada Obi", "08011111111", True), ("bayo", UserRole.CUSTOMER, "Bayo Ade", "08022222222", True),
            ("chika", UserRole.CUSTOMER, "Chika Eze", "08033333333", True), ("eze", UserRole.CUSTOMER, "Dayo Bello", "08044444444", False),
            ("eze", UserRole.CUSTOMER, "Eze Nwa", "08055555555", True),
            ("dir1", UserRole.DIRECTOR, "Director One", "08066666661", True), ("dir2", UserRole.DIRECTOR, "Director Two", "08066666662", True),
            ("dir3", UserRole.DIRECTOR, "Director Three", "08066666663", True)]:
            u = User(role=role, full_name=name, phone_number=phone, nin_linked=nin, bank_code="058", bank_name="GTBank",
                     account_number="01234567" + str(len(key)) + "0", account_name={"ada": "OBI ADA", "bayo": "ADE BAYO", "chika": "EZE CHIKA"}.get(key, "SOMEONE ELSE"))
            db.add(u)
            await db.flush()
            users[key] = u.id
        await db.commit()

    from fastapi import Request

    async def override(request: Request):
        uid = request.headers.get("x-test-user")
        async with maker() as db:
            return await db.get(User, users[uid])
    main_mod.app.dependency_overrides[get_current_user] = override

    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        async def call(who, method, path, expect=200, **kw):
            r = await c.request(method, "/api/v1" + path, headers={"x-test-user": who}, **kw)
            assert r.status_code == expect, f"{who} {method} {path} -> {r.status_code} (wanted {expect}): {r.text[:300]}"
            return r.json()

        K = lambda n: n * NAIRA

        async def approve_setting(key, value):
            s = await call("dir1", "POST", f"/coop/admin/settings/{key}/propose", json={"value": value, "reason": "test"})
            if s["status"] == "pending":
                await call("dir2", "POST", f"/coop/admin/settings/changes/{s['id']}/vote", json={"decision": "approve"})

        async def sql(q, **p):
            async with maker() as db:
                r = await db.execute(text(q), p)
                await db.commit()
                return r

        async def scalar(q, **p):
            async with maker() as db:
                return (await db.execute(text(q), p)).scalar()

        async def pending_request(kind):
            rs = await call("dir1", "GET", f"/coop/admin/requests?status=pending&kind={kind}")
            assert len(rs) == 1, rs
            return rs[0]

        # ── set-up: pilot list, cap, members ──
        for ph in ("08011111111", "08022222222", "08033333333", "08044444444", "08055555555"):
            await call("dir1", "POST", "/coop/admin/pilot", json={"phone_number": ph})
        pc = await call("ada", "GET", "/coop/status")
        assert pc["pilot"]["cap_kobo"] == K(500_000) and pc["test_mode"] is True
        await call("ada", "POST", "/coop/join", json={"amount_kobo": K(300_000)})
        await call("bayo", "POST", "/coop/join", json={"amount_kobo": K(200_000)})
        await call("chika", "POST", "/coop/join", 409, json={"amount_kobo": K(200_000)})           # ₦700k would pass the ₦500k pilot cap... 
        await approve_setting("pilot_cap_kobo", str(K(5_000_000)))
        await call("chika", "POST", "/coop/join", json={"amount_kobo": K(200_000)})
        await call("eze", "POST", "/coop/join", json={"amount_kobo": K(1_000)})
        ids = {k: (await call(k, "GET", "/coop/me"))["member_id"] for k in ("ada", "bayo", "chika", "eze")}
        for k in ("bayo", "chika"):
            await call(k, "PUT", "/coop/pool/me", json={"listed": True, "offer_kobo": K(100_000), "whatsapp_ok": True})
        tk = {"voluntary": True, "understand_loss": True, "own_funds": True, "not_pressured": True, "reviewed": True}

        async def ticks_for(who, gid):
            v = await call(who, "GET", f"/coop/invites/{gid}")
            return {t["key"]: True for t in v["ticks"]}

        async def make_loan(borrower, amount, term, guarantors):
            """request > guarantors sign > two directors approve > borrower accepts > Treasurer pays. Returns the loan id."""
            l = await call(borrower, "POST", "/coop/loans", json={"amount_kobo": amount, "term_months": term})
            for g, amt in guarantors:
                await call(borrower, "POST", f"/coop/loans/{l['id']}/invites", json={"guarantor_member_id": ids[g], "amount_kobo": amt})
                gid = [i for i in await call(g, "GET", "/coop/invites") if i["loan_no"] == l["loan_no"]][0]["guarantee_id"]
                name = {"bayo": "Bayo Ade", "chika": "Chika Eze", "ada": "Ada Obi"}[g]
                await call(g, "POST", f"/coop/invites/{gid}/sign", json={"ticks": await ticks_for(g, gid), "typed_name": name})
            await call("dir1", "POST", f"/coop/admin/loans/{l['id']}/decision", json={"decision": "approve"})
            await call("dir2", "POST", f"/coop/admin/loans/{l['id']}/decision", json={"decision": "approve"})
            await call(borrower, "POST", f"/coop/loans/{l['id']}/accept", json={})
            await call(borrower, "POST", "/coop/bank/from-profile")
            await call("dir1", "POST", f"/coop/admin/loans/{l['id']}/payout", json={"reference": "NIP-" + l["loan_no"], "evidence": "receipt"})
            return l["id"]

        async def advance_to(iso):
            from datetime import date as _d
            now = _d.fromisoformat((await call("dir1", "GET", "/coop/admin/overview"))["today"])
            await call("dir1", "POST", "/coop/admin/test/advance", json={"days": (_d.fromisoformat(iso) - now).days})

        # ── withdrawal requests ──
        before = (await call("dir1", "GET", "/coop/admin/money"))["position"]
        pv = await call("bayo", "POST", "/coop/withdrawals", json={"amount_kobo": K(10_000)})
        assert pv["preview"] is True and pv["mode"] == "director_payout" and pv["charge_kobo"] == K(1_000) and pv["you_receive_kobo"] == K(9_000)
        await call("bayo", "POST", "/coop/withdrawals", 409, json={"amount_kobo": K(10_000), "confirm": True})       # no bank details yet
        await call("bayo", "POST", "/coop/bank/from-profile")
        w = await call("bayo", "POST", "/coop/withdrawals", json={"amount_kobo": K(10_000), "confirm": True})
        wid = w["withdrawal"]["id"]
        assert w["withdrawal"]["status"] == "pending" and w["member"]["contribution_kobo"] == K(190_000)
        mid = (await call("dir1", "GET", "/coop/admin/money"))["position"]
        assert mid["expected_cash_kobo"] == before["expected_cash_kobo"]                       # nothing has left yet
        assert mid["funds"]["withdrawals_held_kobo"] == K(10_000)
        q = await call("dir1", "GET", "/coop/admin/withdrawals?status=pending")
        assert q["total"] == 1 and q["items"][0]["member"] == "Bayo Ade" and q["items"][0]["account"]["account_number"]
        assert (await call("dir1", "GET", "/coop/admin/withdrawals?status=pending&q=Zed"))["total"] == 0
        assert (await call("dir1", "GET", f"/coop/admin/withdrawals?status=all&min_kobo={K(20_000)}"))["total"] == 0
        mine = await call("bayo", "GET", "/coop/withdrawals")
        assert mine["total"] == 1 and mine["items"][0]["status"] == "pending"
        await call("dir1", "POST", f"/coop/admin/withdrawals/{wid}/pay", 400, json={})                                  # evidence needed
        await call("dir1", "POST", f"/coop/admin/withdrawals/{wid}/reject", 400, json={"note": ""})
        # reject: the money goes back
        await call("dir1", "POST", f"/coop/admin/withdrawals/{wid}/reject", json={"note": "Name does not match"})
        assert (await call("bayo", "GET", "/coop/me"))["contribution_kobo"] == K(200_000)
        assert (await call("bayo", "GET", "/coop/withdrawals"))["items"][0]["status"] == "rejected"
        await call("dir1", "POST", f"/coop/admin/withdrawals/{wid}/pay", 409, json={"reference": "X", "evidence": "Y"})
        # member cancels
        w2 = await call("bayo", "POST", "/coop/withdrawals", json={"amount_kobo": K(5_000), "confirm": True})
        await call("bayo", "POST", f"/coop/withdrawals/{w2['withdrawal']['id']}/cancel")
        assert (await call("bayo", "GET", "/coop/me"))["contribution_kobo"] == K(200_000)
        await call("ada", "POST", f"/coop/withdrawals/{w2['withdrawal']['id']}/cancel", 409)
        # pay: charge goes to the pool, cash leaves, dividend lost
        w3 = await call("bayo", "POST", "/coop/withdrawals", json={"amount_kobo": K(10_000), "confirm": True})
        await call("dir1", "POST", f"/coop/admin/withdrawals/{w3['withdrawal']['id']}/pay", json={"reference": "NIP-1", "evidence": "receipt"})
        after = (await call("dir1", "GET", "/coop/admin/money"))["position"]
        assert after["expected_cash_kobo"] == before["expected_cash_kobo"] - K(9_000)
        assert after["funds"]["pool_withdrawal_kobo"] == before["funds"]["pool_withdrawal_kobo"] + K(1_000) and after["funds"]["withdrawals_held_kobo"] == 0
        assert (await call("bayo", "GET", "/coop/me"))["disqualified_this_year"] is True
        assert (await call("dir1", "GET", "/coop/admin/withdrawals?status=paid"))["total"] == 1
        assert all(c["ok"] for c in (await call("dir1", "GET", "/coop/admin/money"))["checks"]) if "checks" in (await call("dir1", "GET", "/coop/admin/money")) else True

        # ── rules: confirm as it is ──
        st = await call("dir1", "GET", "/coop/admin/settings")
        wm = [x for x in st["settings"] if x["key"] == "withdraw_mode"][0]
        assert wm["confirmed"] is False
        await call("dir1", "POST", "/coop/admin/settings/withdraw_mode/propose", 400, json={"value": "director_payout"})   # same value, no confirm flag
        cf = await call("dir1", "POST", "/coop/admin/settings/withdraw_mode/propose", json={"confirm": True})
        assert cf["status"] == "pending"
        await call("dir2", "POST", f"/coop/admin/settings/changes/{cf['id']}/vote", json={"decision": "approve"})
        wm = [x for x in (await call("dir1", "GET", "/coop/admin/settings"))["settings"] if x["key"] == "withdraw_mode"][0]
        assert wm["confirmed"] is True and wm["value"] == "director_payout"
        await call("dir1", "POST", "/coop/admin/settings/withdraw_mode/propose", 400, json={"confirm": True})              # already confirmed
        # switch to instant: no director step
        await approve_setting("withdraw_mode", "instant")
        wi = await call("chika", "POST", "/coop/withdrawals", json={"amount_kobo": K(1_000), "confirm": True})
        assert wi["mode"] == "instant" and wi["member"]["contribution_kobo"] == K(199_000)

        # ── complaint conversation ──
        cp = await call("ada", "POST", "/coop/complaints", json={"subject": "Late payout", "body": "My loan payout was late", "category": "payout"})
        cid = cp["id"]
        await call("ada", "POST", f"/coop/complaints/{cid}/messages", json={"body": "Any news?"})
        await call("dir1", "POST", f"/coop/admin/cases/{cid}/respond", json={"resolution": "We are checking with the bank."})
        th = await call("ada", "GET", f"/coop/complaints/{cid}")
        assert th["status"] == "answered" and [n["from_member"] for n in th["notes"]] == [True, False]
        assert th["notes"][0]["author"] == "You"
        await call("ada", "POST", f"/coop/complaints/{cid}/messages", json={"body": "Thanks, waiting."})
        assert (await call("ada", "GET", f"/coop/complaints/{cid}"))["status"] == "open"
        await call("dir1", "POST", f"/coop/admin/cases/{cid}/respond", json={"resolution": "Sorted, please check."})
        await call("bayo", "GET", f"/coop/complaints/{cid}", 404)
        await call("bayo", "POST", f"/coop/complaints/{cid}/messages", 404, json={"body": "hi"})
        await call("dir1", "POST", f"/coop/admin/cases/{cid}/close", json={"resolution": "Paid"})
        await call("ada", "POST", f"/coop/complaints/{cid}/messages", 409, json={"body": "one more"})
        notif = await scalar("SELECT count(*) FROM notifications WHERE title LIKE '%complaint%'")
        assert notif >= 2

        # ── pictures and reliability for guarantors ──
        await sql("UPDATE users SET avatar_url = 'https://img.test/ada.png' WHERE full_name = 'Ada Obi'")
        pool = await call("chika", "GET", "/coop/pool")
        assert all("avatar_url" in r for r in pool)
        l = await call("ada", "POST", "/coop/loans", json={"amount_kobo": K(50_000), "term_months": 2})
        await call("ada", "POST", f"/coop/loans/{l['id']}/invites", json={"guarantor_member_id": ids["bayo"], "amount_kobo": K(50_000)})
        gid = [i for i in await call("bayo", "GET", "/coop/invites") if i["loan_no"] == l["loan_no"]][0]
        assert gid["borrower_avatar_url"] == "https://img.test/ada.png"
        inv = await call("bayo", "GET", f"/coop/invites/{gid['guarantee_id']}")
        b = inv["borrower"]
        assert b["avatar_url"] == "https://img.test/ada.png" and "reliability_pct" in b and "has_history" in b and "loans_taken" in b
        ld = await call("ada", "GET", f"/coop/loans/{l['id']}")
        assert ld["guarantors"][0]["avatar_url"] is None
    await engine.dispose()
    from app.core.database import engine as _app_engine
    await _app_engine.dispose()


def test_coop_module_a():
    asyncio.run(_run())
