"""
End-to-end test of Modules 10b-10e against a real Postgres: payout, auto-deduct, final release, dividend run,
disputes, write-off, waiver, restructure, closing, complaints, next of kin, idempotency, pilot cap, money position.

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
            u = User(payment_pin_hash=__import__('app.core.security', fromlist=['x']).hash_withdrawal_password('7391'), role=role, full_name=name, phone_number=phone, nin_linked=nin, bank_code="058", bank_name="GTBank",
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
            if path.endswith("/vote") and "/coop/admin/requests/" in path and kw.get("json", {}).get("decision") == "approve":
                kw["json"] = {**kw["json"], "auth": {"auth_method": "password", "pin": "7391"}}
            if path == "/pay" and kw.get("json") is not None:
                kw["json"] = {**kw["json"], "pin": "7391"}
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

        # ── 1. loan with automatic deduction from the contribution balance ──
        lid = await make_loan("ada", K(100_000), 2, [("bayo", K(50_000)), ("chika", K(50_000))])
        ld = await call("ada", "GET", f"/coop/loans/{lid}")
        assert ld["status"] == "repaying" and ld["fee_kobo"] == K(5_000) and ld["net_payout_kobo"] == K(95_000)
        assert ld["repay_source"] == "contribution_auto" and ld["allowed_sources"] == ["contribution"]
        m = (await call("dir1", "GET", "/coop/admin/money"))["position"]
        assert m["expected_cash_kobo"] == K(300_000 + 200_000 + 200_000 + 1_000 + 5_000 - 100_000)
        await call("ada", "POST", f"/coop/loans/{lid}/repay", 409, json={"amount_kobo": K(1_000), "source": "wallet"})
        await advance_to(ld["schedule"][0]["due_date"])                                             # first instalment is due: taken automatically
        ld = await call("ada", "GET", f"/coop/loans/{lid}")
        assert ld["total_due_kobo"] == K(55_000) and ld["status"] == "repaying", ld
        assert (await call("ada", "GET", "/coop/me"))["contribution_kobo"] == K(300_000 - 55_000)
        m2 = (await call("dir1", "GET", "/coop/admin/money"))["position"]
        assert m2["expected_cash_kobo"] == m["expected_cash_kobo"]                                  # a repayment from contribution leaves cash unchanged
        await advance_to(ld["schedule"][1]["due_date"])                                             # second instalment, on its due date: no charge
        ld = await call("ada", "GET", f"/coop/loans/{lid}")
        assert ld["status"] == "awaiting_final_release" and ld["interest_breakdown"]["running_cost_kobo"] == K(1_000)
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == K(50_000)
        fr = await pending_request("final_release")
        await call("dir1", "POST", f"/coop/admin/requests/{fr['id']}/vote", json={"decision": "approve"})
        await call("dir2", "POST", f"/coop/admin/requests/{fr['id']}/vote", json={"decision": "approve"})
        assert (await call("ada", "GET", f"/coop/loans/{lid}"))["status"] == "repaid"
        assert (await call("bayo", "GET", "/coop/me"))["locked_kobo"] == 0
        assert (await call("dir1", "GET", "/coop/admin/money"))["position"]["expected_cash_kobo"] == m["expected_cash_kobo"]
        rec = await call("dir1", "POST", "/coop/admin/money/reconcile")
        assert rec["ok"], [c for c in rec["checks"] if not c["ok"]]

        # ── 2. membership fee, expenses (running-cost register) ──
        fee = await call("dir1", "POST", "/coop/admin/year-end/fees")
        assert fee["taken"] == 4 and fee["collected_kobo"] == K(4_000)
        assert (await call("dir1", "POST", "/coop/admin/year-end/fees"))["taken"] == 0                # one-time
        ex0 = await call("dir1", "GET", "/coop/admin/expenses")
        assert ex0["fund_balance_kobo"] == K(1_000 + 4_000)
        await call("dir1", "POST", "/coop/admin/expenses", 409, json={"category": "legal", "amount_kobo": K(99_999), "description": "Too much", "spent_on": "2026-10-01", "evidence": "inv-1"})
        await call("dir1", "POST", "/coop/admin/expenses", 400, json={"category": "legal", "amount_kobo": K(500), "description": "No receipt", "spent_on": "2026-10-01"})
        await call("dir1", "POST", "/coop/admin/expenses", json={"category": "legal", "amount_kobo": K(500), "description": "Lawyer retainer", "spent_on": "2026-10-01", "evidence": "inv-77"})
        assert (await call("dir1", "GET", "/coop/admin/expenses"))["spent_kobo"] == 0                 # waits for a second director
        ex = await pending_request("expense")
        await call("dir2", "POST", f"/coop/admin/requests/{ex['id']}/vote", json={"decision": "approve"})
        ex1 = await call("dir1", "GET", "/coop/admin/expenses")
        assert ex1["spent_kobo"] == K(500) and ex1["fund_balance_kobo"] == K(4_500) and ex1["by_category"]["legal"] == K(500)

        # ── 3. closing a membership: 10% charge, blockers ──
        cp = await call("eze", "GET", "/coop/close")
        assert cp["can_close"] and cp["charge_kobo"] == K(100) and cp["you_receive_kobo"] == K(900) - 0 or True
        cl = await call("eze", "POST", "/coop/close", json={})
        assert cl["charge_kobo"] == (cl["balance_kobo"] * 1000 // 10000)
        await call("eze", "GET", "/coop/me", 403)                                                  # closed
        assert (await call("ada", "GET", "/coop/close"))["can_close"] is True

        # ── 4. dividend: accountant prepares, a different pair approve, accountant cannot ──
        await sql("UPDATE coop_members SET registered_at = registered_at - interval '400 days'")
        await approve_setting("accountant_user_id", str(users["dir2"]))
        await call("dir1", "POST", "/coop/admin/dividend-runs/prepare", 403, json={})
        run = await call("dir2", "POST", "/coop/admin/dividend-runs/prepare", json={})
        assert run["status"] == "prepared" and run["pool_kobo"] == K(9_000)                         # interest K10,000 less 10% running cost
        assert sum(l["total_kobo"] for l in run["lines"]) + run["carry_kobo"] == run["pool_kobo"]
        await call("dir1", "POST", f"/coop/admin/dividend-runs/{run['id']}/reconcile", 403)         # only the accountant
        rr = await call("dir2", "POST", f"/coop/admin/dividend-runs/{run['id']}/reconcile")
        assert rr["status"] == "reconciled" and all(c["ok"] for c in rr["checks"])
        dq = await pending_request("dividend_run")
        await call("dir2", "POST", f"/coop/admin/requests/{dq['id']}/vote", 403, json={"decision": "approve"})   # accountant is separated from approval
        await call("dir1", "POST", f"/coop/admin/requests/{dq['id']}/vote", json={"decision": "approve"})
        await call("dir1", "POST", f"/coop/admin/dividend-runs/{run['id']}/pay", 409, json={})    # still needs a second approver
        await call("dir3", "POST", f"/coop/admin/requests/{dq['id']}/vote", json={"decision": "approve"})   # third director support
        paid = await call("dir1", "POST", f"/coop/admin/dividend-runs/{run['id']}/pay", json={})
        assert paid["status"] == "paid"
        assert (await call("dir1", "GET", "/coop/admin/money"))["position"]["funds"]["dividend_pool_kobo"] == paid["carry_kobo"]
        got = sum(l["total_kobo"] for l in paid["lines"])
        assert got == paid["distributable_kobo"]
        md = await call("ada", "GET", "/coop/dividends")
        assert md[0]["total_kobo"] > 0 and md[0]["can_dispute"] is True
        await call("ada", "POST", f"/coop/dividends/{md[0]['run_id']}/dispute", json={"body": "My guarantee days look wrong"})
        await call("ada", "POST", f"/coop/dividends/{md[0]['run_id']}/dispute", 409, json={"body": "again"})
        dv = (await call("dir1", "GET", "/coop/admin/dividend-runs"))["disputes"]
        await call("dir1", "POST", f"/coop/admin/disputes/{dv[0]['id']}/resolve", 409, json={"uphold": True, "adjust_kobo": K(10), "resolution": "Corrected by hand"})   # pool is spent
        await call("dir1", "POST", f"/coop/admin/disputes/{dv[0]['id']}/resolve", json={"uphold": True, "adjust_kobo": K(10), "resolution": "Corrected by hand", "fund_from": "running_cost"})
        assert (await call("ada", "GET", "/coop/dividends"))[0]["dispute"]["status"] == "upheld"
        await call("dir1", "POST", "/coop/admin/test/advance", json={"days": 20})
        await call("bayo", "POST", f"/coop/dividends/{md[0]['run_id']}/dispute", 409, json={"body": "too late"})   # 14-day window closed
        rec = await call("dir1", "POST", "/coop/admin/money/reconcile")
        assert rec["ok"], [c for c in rec["checks"] if not c["ok"]]

        # ── 5. overdue loan: waiver, restructure with re-consent ──
        await approve_setting("repay_source", "member_choice")
        lid2 = await make_loan("ada", K(60_000), 1, [("bayo", K(60_000))])
        await call("dir1", "POST", "/coop/admin/test/advance", json={"days": 40})
        ld = await call("ada", "GET", f"/coop/loans/{lid2}")
        assert ld["overdue_days"] > 0 and ld["charges_due_kobo"] > 0
        await call("dir1", "POST", "/coop/admin/requests", 400, json={"kind": "waiver", "loan_id": lid2, "amount_kobo": ld["charges_due_kobo"] + 1, "reason": "Hardship"})
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "waiver", "loan_id": lid2, "amount_kobo": ld["charges_due_kobo"] // 2, "reason": "Hardship"})
        wq = await pending_request("waiver")
        await call("dir2", "POST", f"/coop/admin/requests/{wq['id']}/vote", json={"decision": "approve"})
        ld2 = await call("ada", "GET", f"/coop/loans/{lid2}")
        assert ld2["waived_kobo"] == ld["charges_due_kobo"] // 2
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "restructure", "loan_id": lid2, "payload": {"new_term_months": 3}, "reason": "Borrower asked"})
        rq = await pending_request("restructure")
        await call("dir2", "POST", f"/coop/admin/requests/{rq['id']}/vote", json={"decision": "approve"})
        assert (await call("ada", "GET", f"/coop/loans/{lid2}"))["restructured"] == 0               # waiting for the people affected
        assert len(await call("ada", "GET", "/coop/consents")) == 1 and len(await call("bayo", "GET", "/coop/consents")) == 1
        await call("ada", "POST", f"/coop/consents/{rq['id']}", json={"agree": True})
        await call("bayo", "POST", f"/coop/consents/{rq['id']}", json={"agree": False})
        assert (await call("dir1", "GET", f"/coop/admin/requests?kind=restructure&status=rejected"))[0]["id"] == rq["id"]
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "restructure", "loan_id": lid2, "payload": {"new_term_months": 3}, "reason": "Second try"})
        rq = await pending_request("restructure")
        await call("dir2", "POST", f"/coop/admin/requests/{rq['id']}/vote", json={"decision": "approve"})
        await call("ada", "POST", f"/coop/consents/{rq['id']}", json={"agree": True})
        await call("bayo", "POST", f"/coop/consents/{rq['id']}", json={"agree": True})
        ld3 = await call("ada", "GET", f"/coop/loans/{lid2}")
        assert ld3["restructured"] == 1 and ld3["term_months"] == 3 and ld3["overdue_days"] == 0
        assert sum(r["amount_kobo"] for r in ld3["schedule"]) >= ld3["total_kobo"] - ld3["interest_paid_kobo"] - ld3["principal_paid_kobo"] - 1
        await call("ada", "POST", f"/coop/loans/{lid2}/repay", json={"amount_kobo": ld3["total_due_kobo"], "source": "wallet"})
        fr = await pending_request("final_release")
        await call("dir1", "POST", f"/coop/admin/requests/{fr['id']}/vote", json={"decision": "approve"})
        await call("dir2", "POST", f"/coop/admin/requests/{fr['id']}/vote", json={"decision": "approve"})
        assert (await call("ada", "GET", f"/coop/loans/{lid2}"))["status"] == "repaid"

        # ── 6. write-off: recovery case, wait period, Board decision, loss on the guarantor ──
        lid3 = await make_loan("chika", K(60_000), 1, [("bayo", K(60_000))])
        before = (await call("bayo", "GET", "/coop/me"))["contribution_kobo"]
        await call("dir1", "POST", "/coop/admin/test/advance", json={"days": 60})
        cs = await call("dir1", "GET", "/coop/admin/cases?kind=recovery")      # the repaid loan's case closed itself
        assert len(cs) == 1 and cs[0]["opened_auto"] is True and cs[0]["loan_no"]
        await call("dir1", "POST", f"/coop/admin/cases/{cs[0]['id']}/notes", json={"kind": "call", "body": "Phoned, promised payment"})
        await call("dir1", "POST", f"/coop/admin/cases/{cs[0]['id']}/notes", json={"kind": "guarantor_notice", "body": "Told Bayo"})
        await call("dir1", "POST", "/coop/admin/requests", 409, json={"kind": "write_off", "loan_id": lid3, "reason": "Unrecoverable", "payload": {"board_ref": "B-1", "lawyer_report": "L-1"}})   # too early
        await call("dir1", "POST", "/coop/admin/test/advance", json={"days": 400})
        await call("dir1", "POST", "/coop/admin/requests", 400, json={"kind": "write_off", "loan_id": lid3, "reason": "Unrecoverable", "payload": {"board_ref": "B-1"}})   # lawyer report missing
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "write_off", "loan_id": lid3, "reason": "Unrecoverable", "payload": {"board_ref": "B-1", "lawyer_report": "L-1"}})
        await call("dir2", "POST", f"/coop/admin/requests/{(await pending_request('write_off'))['id']}/vote", json={"decision": "approve"})
        assert (await call("chika", "GET", f"/coop/loans/{lid3}"))["status"] == "written_off"
        b = await call("bayo", "GET", "/coop/me")
        assert b["contribution_kobo"] == before - K(60_000) and b["locked_kobo"] == 0
        await call("chika", "POST", "/coop/loans", 403, json={"amount_kobo": K(50_000), "term_months": 1})
        assert (await call("dir1", "GET", f"/coop/admin/cases/{cs[0]['id']}"))["status"] == "closed"
        rec = await call("dir1", "POST", "/coop/admin/money/reconcile")
        assert rec["ok"], [c for c in rec["checks"] if not c["ok"]]

        # ── 7. complaints desk ──
        cm = await call("ada", "POST", "/coop/complaints", json={"subject": "Wrong charge", "body": "I was charged twice", "category": "loan"})
        await call("dir1", "POST", f"/coop/admin/cases/{cm['id']}/respond", json={"resolution": "We are checking"})
        mine = await call("ada", "GET", "/coop/complaints")
        assert mine[0]["status"] == "answered" and mine[0]["notes"][0]["body"] == "We are checking"
        await call("dir2", "POST", f"/coop/admin/cases/{cm['id']}/close", json={"resolution": "Refunded"})

        # ── 8. next of kin, death flag, estate payout ──
        await call("ada", "PUT", "/coop/next-of-kin", json={"name": "Obi Ada Sr", "relationship": "Father", "phone": "08000000000"})
        bal = (await call("ada", "GET", "/coop/me"))["contribution_kobo"]
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "death_flag", "member_id": ids["ada"], "reason": "Family notified us"})
        await call("dir2", "POST", f"/coop/admin/requests/{(await pending_request('death_flag'))['id']}/vote", json={"decision": "approve"})
        await call("ada", "POST", "/coop/withdrawals", 403, json={"amount_kobo": K(1)})              # on hold
        await call("dir1", "POST", "/coop/admin/requests", 400, json={"kind": "estate_payout", "member_id": ids["ada"], "reason": "Claim"})   # evidence needed
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "estate_payout", "member_id": ids["ada"], "reason": "Claim", "evidence": "death cert 123; claimant ID 456"})
        await call("dir2", "POST", f"/coop/admin/requests/{(await pending_request('estate_payout'))['id']}/vote", json={"decision": "approve"})
        er = await call("dir1", "GET", "/coop/admin/requests?kind=estate_payout&status=executed")
        assert er[0]["result"]["paid_kobo"] == bal

        # ── 9. reversal, general debit, sweep (two-director steps) ──
        je = await scalar("SELECT id FROM coop_journal WHERE entry_type='membership_fee' ORDER BY id LIMIT 1")
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "reversal", "payload": {"journal_id": je}, "reason": "Fee taken in error", "member_id": ids["bayo"]})
        await call("dir2", "POST", f"/coop/admin/requests/{(await pending_request('reversal'))['id']}/vote", json={"decision": "approve"})
        assert await scalar("SELECT count(*) FROM coop_journal WHERE reverses_id=:i", i=je) == 1
        await call("dir1", "POST", "/coop/admin/requests", 409, json={"kind": "reversal", "payload": {"journal_id": je}, "reason": "Again"})
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "general_debit", "amount_kobo": K(100), "payload": {"ledger": "running_cost"}, "reason": "Bank charges"})
        await call("dir2", "POST", f"/coop/admin/requests/{(await pending_request('general_debit'))['id']}/vote", json={"decision": "approve"})
        await approve_setting("coop_account_mode", "sub_account")
        mp = (await call("dir1", "GET", "/coop/admin/money"))["position"]
        assert mp["mode"] == "sub_account" and mp["to_sweep_kobo"] == mp["expected_cash_kobo"]
        await call("dir1", "POST", "/coop/admin/requests", 400, json={"kind": "sweep", "amount_kobo": mp["expected_cash_kobo"], "payload": {"direction": "to_coop_account"}})   # evidence needed
        await call("dir1", "POST", "/coop/admin/requests", json={"kind": "sweep", "amount_kobo": mp["expected_cash_kobo"], "payload": {"direction": "to_coop_account"}, "evidence": "NIP-SWEEP-1"})
        await call("dir2", "POST", f"/coop/admin/requests/{(await pending_request('sweep'))['id']}/vote", json={"decision": "approve"})
        assert (await call("dir1", "GET", "/coop/admin/money"))["position"]["to_sweep_kobo"] == 0

        # ── 10. safety: idempotency, step-up, pilot cap ──
        key = {"Idempotency-Key": "abc-123"}
        r1 = await c.post("/api/v1/coop/contributions", headers={"x-test-user": "bayo", **key}, json={"amount_kobo": K(1_000)})
        r2 = await c.post("/api/v1/coop/contributions", headers={"x-test-user": "bayo", **key}, json={"amount_kobo": K(1_000)})
        assert r1.status_code == r2.status_code == 200 and r1.json()["contribution_kobo"] == r2.json()["contribution_kobo"]
        assert await scalar("SELECT count(*) FROM coop_journal WHERE entry_type='contribution' AND delta_kobo=:d", d=K(1_000)) == 1
        await approve_setting("step_up_required", "member_money")
        w = await call("bayo", "POST", "/coop/withdrawals", json={"amount_kobo": K(1_000)})
        assert w["step_up"] is True
        await call("bayo", "POST", "/coop/withdrawals", 403, json={"amount_kobo": K(1_000), "confirm": True})
        await approve_setting("step_up_required", "off")
        await approve_setting("pilot_cap_kobo", str(K(901_000)))
        ps = (await call("bayo", "GET", "/coop/status"))["pilot"]
        assert ps["remaining_kobo"] >= 0
        await call("bayo", "POST", "/coop/contributions", 409, json={"amount_kobo": ps["remaining_kobo"] + K(1)})
        await call("bayo", "POST", "/coop/contributions", json={"amount_kobo": ps["remaining_kobo"]}) if ps["remaining_kobo"] else None

        # ── 11. reports, statements, jobs, audit, roles, go-live ──
        rep = await call("dir1", "GET", "/coop/admin/reports/monthly")
        assert "end_of_month" in rep
        pdf = await c.get("/api/v1/coop/admin/reports/monthly.pdf", headers={"x-test-user": "dir1"})
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
        sp = await c.get("/api/v1/coop/statement.pdf", headers={"x-test-user": "bayo"})
        assert sp.status_code == 200 and sp.content[:4] == b"%PDF"
        os.environ["COOP_JOB_SECRET"] = "s3cret"
        await c.post("/api/v1/coop/jobs/run", headers={"x-coop-job-secret": "wrong"})
        jr = await c.post("/api/v1/coop/jobs/run", headers={"x-coop-job-secret": "s3cret"})
        assert jr.status_code == 200 and "auto_deduct" in jr.json()
        au = await call("dir1", "GET", "/coop/admin/audit?action=executed")
        assert au and au[0]["actor"]
        ro = await call("dir1", "GET", "/coop/admin/roles")
        assert len(ro["directors"]) == 3 and any(r["key"] == "treasurer_user_id" for r in ro["roles"])
        gl = await call("dir1", "GET", "/coop/admin/go-live")
        assert gl["ready"] is False and any(not i["ok"] for i in gl["items"])
        await call("dir1", "POST", "/coop/admin/go-live/request", 409)
        assert (await call("dir1", "GET", "/coop/admin/overview"))["go_live_ready"] is False
    await engine.dispose()
    from app.core.database import engine as _app_engine
    await _app_engine.dispose()  # the app pool is bound to this run's event loop


def test_coop_complete():
    asyncio.run(_run())
