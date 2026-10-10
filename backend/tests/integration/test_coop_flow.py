"""
End-to-end test of the cooperative preview against a real Postgres.

Run:  TEST_DATABASE_URL=postgresql+asyncpg://.../monieking_test pytest tests/integration/test_coop_flow.py
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
    sql = (Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "045_coop_foundation.sql").read_text()
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
            ("chika", UserRole.CUSTOMER, "Chika Eze", "08033333333", True), ("dayo", UserRole.CUSTOMER, "Dayo Bello", "08044444444", False),
            ("eze", UserRole.CUSTOMER, "Eze Nwa", "08055555555", True),
            ("dir1", UserRole.DIRECTOR, "Director One", "08066666661", True), ("dir2", UserRole.DIRECTOR, "Director Two", "08066666662", True)]:
            u = User(role=role, full_name=name, phone_number=phone, nin_linked=nin)
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

        # ── access gate ──
        st = await call("eze", "GET", "/coop/status")
        assert st["access"] is False
        await call("eze", "POST", "/coop/join", 403, json={"amount_kobo": K(100)})

        for k, ph in [("ada", "08011111111"), ("bayo", "08022222222"), ("chika", "08033333333"), ("dayo", "08044444444")]:
            await call("dir1", "POST", "/coop/admin/pilot", json={"phone_number": ph})
        await call("dir1", "POST", "/coop/admin/pilot", 404, json={"phone_number": "0800"})
        await call("ada", "POST", "/coop/join", 200, json={"amount_kobo": K(500)})
        await call("ada", "POST", "/coop/join", 409, json={"amount_kobo": K(500)})
        await call("dayo", "POST", "/coop/join", 400, json={"amount_kobo": K(10)})      # below minimum
        await call("dayo", "POST", "/coop/join", 409, json={"amount_kobo": K(500)})     # NIN missing
        d = await call("dayo", "POST", "/coop/join", json={"amount_kobo": K(500), "nin_bypass": True})
        assert d["nin_bypassed"] is True
        await call("bayo", "POST", "/coop/join", json={"amount_kobo": K(200_000)})
        await call("chika", "POST", "/coop/join", json={"amount_kobo": K(200_000)})
        bayo = (await call("bayo", "GET", "/coop/me"))["member_id"]
        chika = (await call("chika", "GET", "/coop/me"))["member_id"]
        ada = (await call("ada", "GET", "/coop/me"))["member_id"]

        # ── pool ──
        await call("bayo", "PUT", "/coop/pool/me", 400, json={"listed": True, "offer_kobo": K(50_000), "whatsapp_ok": False})
        await call("bayo", "PUT", "/coop/pool/me", json={"listed": True, "offer_kobo": K(50_000), "whatsapp_ok": True, "note": "Trusted"})
        await call("chika", "PUT", "/coop/pool/me", json={"listed": True, "offer_kobo": K(60_000), "whatsapp_ok": True})
        pool = await call("ada", "GET", "/coop/pool")
        assert {p["name"] for p in pool} == {"Bayo Ade", "Chika Eze"}
        assert all(p["whatsapp_link"].startswith("https://wa.me/234") for p in pool)

        # ── loan request ──
        pv = await call("ada", "GET", "/coop/loans/preview?amount_kobo=%d&term_months=3" % K(100_000))
        assert pv["interest_kobo"] == K(10_000) and pv["total_kobo"] == K(110_000) and len(pv["schedule"]) == 3
        await call("ada", "POST", "/coop/loans", 400, json={"amount_kobo": K(100), "term_months": 3})          # below minimum
        await call("ada", "POST", "/coop/loans", 400, json={"amount_kobo": K(100_000), "term_months": 7})      # over max term
        loan = await call("ada", "POST", "/coop/loans", json={"amount_kobo": K(100_000), "term_months": 3, "purpose": "Stock"})
        lid = loan["id"]
        await call("ada", "POST", "/coop/loans", 409, json={"amount_kobo": K(100_000), "term_months": 3})      # one active loan
        # guarantor rules
        await call("ada", "POST", f"/coop/loans/{lid}/invites", 400, json={"guarantor_member_id": bayo, "amount_kobo": K(10_000)})   # under minimum commit
        await call("ada", "POST", f"/coop/loans/{lid}/invites", 400, json={"guarantor_member_id": bayo, "amount_kobo": K(55_000)})   # above his offer
        await call("ada", "POST", f"/coop/loans/{lid}/invites", 400, json={"guarantor_member_id": ada, "amount_kobo": K(50_000)})   # self
        await call("ada", "POST", f"/coop/loans/{lid}/invites", 409, json={"guarantor_member_id": d["member_id"], "amount_kobo": K(50_000)})  # not in pool
        l1 = await call("ada", "POST", f"/coop/loans/{lid}/invites", json={"guarantor_member_id": bayo, "amount_kobo": K(50_000)})
        await call("ada", "POST", f"/coop/loans/{lid}/invites", 409, json={"guarantor_member_id": bayo, "amount_kobo": K(50_000)})   # duplicate
        await call("ada", "POST", f"/coop/loans/{lid}/invites", json={"guarantor_member_id": chika, "amount_kobo": K(50_000)})
        gb = [g for g in l1["guarantors"] if g["name"] == "Bayo Ade"][0]["guarantee_id"]
        invs = await call("chika", "GET", "/coop/invites")
        gc = invs[0]["guarantee_id"]

        # signing
        view = await call("bayo", "GET", f"/coop/invites/{gb}")
        assert "GUARANTOR AGREEMENT" in view["contract_text"] and view["eligible"] and len(view["ticks"]) == 5
        ticks = {t["key"]: True for t in view["ticks"]}
        await call("bayo", "POST", f"/coop/invites/{gb}/sign", 400, json={"ticks": {**ticks, "voluntary": False}, "typed_name": "Bayo Ade"})
        await call("bayo", "POST", f"/coop/invites/{gb}/sign", 400, json={"ticks": ticks, "typed_name": "Someone Else"})
        await call("chika", "POST", f"/coop/invites/{gb}/sign", 404, json={"ticks": ticks, "typed_name": "Chika Eze"})   # not hers
        await call("bayo", "POST", f"/coop/invites/{gb}/sign", json={"ticks": ticks, "typed_name": "bayo ade"})
        me_b = await call("bayo", "GET", "/coop/me")
        assert me_b["locked_kobo"] == K(50_000) and me_b["free_kobo"] == K(150_000)
        await call("bayo", "POST", f"/coop/invites/{gb}/sign", 409, json={"ticks": ticks, "typed_name": "Bayo Ade"})   # already signed
        assert (await call("ada", "GET", f"/coop/loans/{lid}"))["status"] == "seeking_guarantors"
        await call("chika", "POST", f"/coop/invites/{gc}/sign", json={"ticks": ticks, "typed_name": "Chika Eze"})
        ld = await call("ada", "GET", f"/coop/loans/{lid}")
        assert ld["status"] == "awaiting_approval" and ld["guaranteed_kobo"] == K(100_000)

        # ── two director approval ──
        await call("ada", "POST", f"/coop/admin/loans/{lid}/decision", 403, json={"decision": "approve"})
        r1 = await call("dir1", "POST", f"/coop/admin/loans/{lid}/decision", json={"decision": "approve"})
        assert r1["status"] == "awaiting_approval" and r1["approvals"] == 1
        await call("dir1", "POST", f"/coop/admin/loans/{lid}/decision", 409, json={"decision": "approve"})
        r2 = await call("dir2", "POST", f"/coop/admin/loans/{lid}/decision", json={"decision": "approve"})
        assert r2["status"] == "repaying"
        ld = await call("ada", "GET", f"/coop/loans/{lid}")
        assert ld["status"] == "repaying" and len(ld["schedule"]) == 3 and ld["total_due_kobo"] == K(110_000)
        assert sum(r["amount_kobo"] for r in ld["schedule"]) == K(110_000)

        # ── partial repayment: interest first, guarantees stay locked ──
        await call("ada", "POST", f"/coop/loans/{lid}/repay", 409, json={"amount_kobo": K(999_999)})
        rp = await call("ada", "POST", f"/coop/loans/{lid}/repay", json={"amount_kobo": K(30_000)})
        assert rp["applied"] == {"charges": 0, "interest": K(10_000), "principal": K(20_000), "excess": 0}
        assert rp["repaid"] is False
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == K(50_000)
        tr = await call("ada", "GET", "/coop/transparency?range=30d")
        assert tr["profit"]["running_cost_kobo"] == K(1_000) and tr["profit"]["interest_realised_kobo"] == K(10_000)

        # ── overdue: the charge is 3% of ORIGINAL INTEREST per day, only after the term ends ──
        await call("dir1", "POST", "/coop/admin/test/advance", json={"days": 100})
        ld = await call("ada", "GET", f"/coop/loans/{lid}")
        assert ld["overdue_days"] > 0
        assert ld["accrued_charge_kobo"] == K(10_000) * 300 * ld["overdue_days"] // 10000
        before = ld["total_due_kobo"]
        assert before == K(80_000) + ld["accrued_charge_kobo"]
        rp = await call("ada", "POST", f"/coop/loans/{lid}/repay", json={"amount_kobo": before})
        assert rp["repaid"] is True and rp["applied"]["charges"] == ld["accrued_charge_kobo"]
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == 0
        assert (await call("chika", "GET", "/coop/me"))["locked_kobo"] == 0
        await call("ada", "POST", f"/coop/loans/{lid}/repay", 409, json={"amount_kobo": K(1)})   # nothing owed any more

        # reliability: a late loan lowers it
        pr = await call("dir1", "GET", f"/coop/admin/members")
        assert [m for m in pr if m["name"] == "Ada Obi"][0]["reliability_pct"] == 0

        ov = await call("dir1", "GET", "/coop/admin/overview")
        assert all(ch["ok"] for ch in ov["reconciliation"]), ov["reconciliation"]

        # ── rejection releases guarantees ──
        await call("dir1", "POST", "/coop/admin/test/advance", json={"days": 1})
        l2 = await call("ada", "POST", "/coop/loans", json={"amount_kobo": K(50_000), "term_months": 2})
        await call("ada", "POST", f"/coop/loans/{l2['id']}/invites", json={"guarantor_member_id": bayo, "amount_kobo": K(50_000)})
        gb2 = (await call("bayo", "GET", "/coop/invites"))[0]["guarantee_id"]
        await call("bayo", "POST", f"/coop/invites/{gb2}/sign", json={"ticks": ticks, "typed_name": "Bayo Ade"})
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == K(50_000)
        await call("dir1", "POST", f"/coop/admin/loans/{l2['id']}/decision", 400, json={"decision": "reject"})   # reason needed
        await call("dir1", "POST", f"/coop/admin/loans/{l2['id']}/decision", json={"decision": "reject", "note": "Purpose unclear"})
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == 0
        assert (await call("ada", "GET", f"/coop/loans/{l2['id']}"))["status"] == "rejected"

        # ── cancel releases guarantees ──
        l3 = await call("ada", "POST", "/coop/loans", json={"amount_kobo": K(50_000), "term_months": 2})
        await call("ada", "POST", f"/coop/loans/{l3['id']}/invites", json={"guarantor_member_id": bayo, "amount_kobo": K(50_000)})
        gb3 = (await call("bayo", "GET", "/coop/invites"))[0]["guarantee_id"]
        await call("bayo", "POST", f"/coop/invites/{gb3}/sign", json={"ticks": ticks, "typed_name": "Bayo Ade"})
        await call("ada", "POST", f"/coop/loans/{l3['id']}/cancel")
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == 0

        # ── expiry releases guarantees ──
        l4 = await call("ada", "POST", "/coop/loans", json={"amount_kobo": K(60_000), "term_months": 2})
        await call("ada", "POST", f"/coop/loans/{l4['id']}/invites", json={"guarantor_member_id": bayo, "amount_kobo": K(55_000) if False else K(50_000)})
        gb4 = (await call("bayo", "GET", "/coop/invites"))[0]["guarantee_id"]
        await call("bayo", "POST", f"/coop/invites/{gb4}/sign", json={"ticks": ticks, "typed_name": "Bayo Ade"})
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == K(50_000)
        await call("dir1", "POST", "/coop/admin/test/advance", json={"days": 8})
        assert (await call("ada", "GET", f"/coop/loans/{l4['id']}"))["status"] == "expired"
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == 0

        # ── profiles and privacy ──
        pb = await call("chika", "GET", f"/coop/members/{bayo}/profile")             # pool-listed: basic only
        assert "private" not in pb and pb["name"] == "Bayo Ade" and pb["whatsapp_link"]
        await call("dayo", "GET", f"/coop/members/{ada}/profile", 403)               # unrelated
        l5 = await call("ada", "POST", "/coop/loans", json={"amount_kobo": K(50_000), "term_months": 2})
        await call("ada", "POST", f"/coop/loans/{l5['id']}/invites", json={"guarantor_member_id": bayo, "amount_kobo": K(50_000)})
        pa = await call("bayo", "GET", f"/coop/members/{ada}/profile")               # guarantor sees the borrower in full
        assert pa["private"]["phone"] == "08011111111" and pa["private"]["history"] and pa["you_are"] == "guarantor"
        await call("chika", "GET", f"/coop/members/{ada}/profile", 403)
        await call("ada", "POST", f"/coop/loans/{l5['id']}/cancel")

        # ── early withdrawal: charge to the pool, dividend lost ──
        w = await call("chika", "POST", "/coop/withdrawals", json={"amount_kobo": K(10_000)})
        assert w["preview"] is True and w["charge_kobo"] == K(1_000) and w["you_receive_kobo"] == K(9_000)
        await call("chika", "POST", "/coop/withdrawals", 409, json={"amount_kobo": K(900_000), "confirm": True})
        w = await call("chika", "POST", "/coop/withdrawals", json={"amount_kobo": K(10_000), "confirm": True})
        assert w["preview"] is False and w["member"]["disqualified_this_year"] is True

        # ── dividend estimate: never pays out more than the pool ──
        dv = await call("bayo", "GET", f"/coop/dividend?extra_kobo={K(50_000)}")
        assert "me" in dv and dv["me"]["with_extra"]["extra_kobo"] == K(50_000)
        adm = await call("dir1", "GET", "/coop/admin/dividend")
        assert adm["paid_out_check_kobo"] <= adm["pool_kobo"]
        assert [m for m in adm["members"] if m["name"] == "Chika Eze"][0]["qualifies"] is False

        # ── settings: two directors, scheduling, protected rules ──
        s = await call("dir1", "POST", "/coop/admin/settings/loan_rate_bps/propose", json={"value": "1200", "reason": "Board decision"})
        assert s["status"] == "pending"
        await call("dir1", "POST", f"/coop/admin/settings/changes/{s['id']}/vote", 400, json={"decision": "approve"})
        await call("dir2", "POST", f"/coop/admin/settings/changes/{s['id']}/vote", json={"decision": "approve"})
        assert (await call("ada", "GET", "/coop/settings/public"))["loan_rate_bps"] == 1200
        s2 = await call("dir1", "POST", "/coop/admin/settings/dividend_contribution_pct/propose", json={"value": "60"})
        await call("dir2", "POST", f"/coop/admin/settings/changes/{s2['id']}/vote", json={"decision": "approve"})
        pub = await call("ada", "GET", "/coop/settings/public")
        assert pub["dividend_contribution_pct"] == 70 and pub["dividend_guarantee_pct"] == 30     # scheduled, not live yet
        assert any(c["key"] == "dividend_contribution_pct" and c["status"] == "scheduled" for c in await call("dir1", "GET", "/coop/admin/settings/history"))
        await call("dir1", "POST", "/coop/admin/settings/coop_live_funds/propose", 400, json={"value": "true"})
        await call("dir1", "POST", "/coop/admin/settings/dividend_guarantee_pct/propose", 400, json={"value": "40"})
        await call("dir1", "POST", "/coop/admin/settings/loan_term_months/propose", 400, json={"value": "99"})
        await call("dir1", "POST", "/coop/admin/settings/not_a_rule/propose", 400, json={"value": "1"})
        l6 = await call("ada", "POST", "/coop/loans", json={"amount_kobo": K(100_000), "term_months": 3})
        assert l6["rate_bps"] == 1200 and l6["interest_kobo"] == K(12_000)          # new rate applies to NEW loans
        await call("ada", "POST", f"/coop/loans/{l6['id']}/cancel")

        # ── the money book can never be edited ──
        async with maker() as db:
            with pytest.raises(Exception):
                await db.execute(text("UPDATE coop_journal SET delta_kobo = delta_kobo + 1"))
                await db.commit()
        async with maker() as db:
            with pytest.raises(Exception):
                await db.execute(text("DELETE FROM coop_events"))
                await db.commit()

        # ── transparency ──
        await call("ada", "GET", "/coop/transparency?range=custom&start=2026-12-01&end=2026-11-01", 400)
        t = await call("ada", "GET", "/coop/transparency?range=year")
        assert t["cooperative"]["members"] == 4 and len(t["series"]) >= 1

        ov = await call("dir1", "GET", "/coop/admin/overview")
        assert all(ch["ok"] for ch in ov["reconciliation"]), ov["reconciliation"]
        assert ov["live_ready"] is False

        # ── reset ──
        await call("dir1", "POST", "/coop/admin/test/reset", 400, json={"confirm": "no"})
        await call("dir1", "POST", "/coop/admin/test/reset", json={"confirm": "RESET"})
        assert (await call("ada", "GET", "/coop/status"))["is_member"] is False
        j = await call("ada", "POST", "/coop/join", json={"amount_kobo": K(100)})
        assert j["card_no"].startswith("MK-C 0001")
    await engine.dispose()


def test_coop_full_flow():
    asyncio.run(_run())
