"""Module B: notification links, withdrawals paging/filters, officer disputes, per-SMS fee + accrual,
next of kin, director customer detail, food ping-all/collected, maintenance switch."""
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta

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
    from app.core.database import Base
    from app.core.dependencies import get_current_user
    from app.models.user import User, UserRole, UserStatus
    from app.models.zone import Zone
    from app.models.card import ContributionCard, ContributionRecord, CardType, ContributionMethod
    from app.models.wallet import Wallet, WalletTransaction, TxType, TxCategory
    from app.models.withdrawal import Withdrawal, WithdrawalStatus
    from app.models.food_entitlement import FoodEntitlement, EntitlementStatus


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
        zone = Zone(name="Zone A")
        db.add(zone)
        await db.flush()
        for key, role, name, phone in [
            ("ada", UserRole.CUSTOMER, "Ada Obi", "08011111111"), ("kemi", UserRole.CUSTOMER, "Kemi Manual", "08022222222"),
            ("off", UserRole.OFFICER, "Officer Femi", "08033333333"), ("dir", UserRole.DIRECTOR, "Director One", "08044444444"),
            ("nobody", UserRole.CUSTOMER, "No Cards", "08055555555")]:
            u = User(role=role, full_name=name, phone_number=phone, bank_code="058", bank_name="GTBank", account_number="0123456789",
                     account_name=name.upper(), status=UserStatus.ACTIVE, zone_id=zone.id if key != "dir" else None,
                     next_of_kin_name="Mum" if key == "ada" else None, next_of_kin_phone="08099999999" if key == "ada" else None)
            if key == "kemi":
                u.is_manual_customer = True
            db.add(u)
            await db.flush()
            users[key] = u.id
        await db.commit()

    from fastapi import Request

    async def override(request: Request):
        async with maker() as db:
            return await db.get(User, users[request.headers.get("x-test-user")])
    main_mod.app.dependency_overrides[get_current_user] = override

    sent = []
    async def fake_send(phone, msg):
        sent.append((phone, msg)); return True
    monkeypatch.setattr("app.services.sms_service.send_sms", fake_send)
    monkeypatch.setattr("app.api.v1.routes.sms_admin.send_sms", fake_send)
    monkeypatch.setattr("app.api.v1.routes.director_customers.send_sms", fake_send)

    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        async def call(who, method, path, expect=200, **kw):
            r = await c.request(method, "/api/v1" + path, headers={"x-test-user": who}, **kw)
            assert r.status_code == expect, f"{who} {method} {path} -> {r.status_code} (wanted {expect}): {r.text[:300]}"
            return r.json()

        # ── data: a card with 5 days (2 withdrawn), a wallet tx, 4 withdrawals ──
        async with maker() as db:
            food = ContributionCard(owner_id=users["ada"], card_type=CardType.FOOD, rate_kobo=10_000, total_days_contributed=372, total_contributed_kobo=3_720_000)
            reg = ContributionCard(owner_id=users["kemi"], card_type=CardType.REGULAR, rate_kobo=10_000, total_days_contributed=3, total_contributed_kobo=30_000)
            db.add_all([food, reg])
            await db.flush()
            for i in range(5):
                db.add(ContributionRecord(card_id=reg.id, logical_month=1, logical_day=i + 1, amount_kobo=10_000, contributed_by=users["off"],
                                          method=ContributionMethod.CASH_VIA_OFFICER, reference=f"R1-D{i+1:03d}", is_withdrawn=i < 2))
            w = Wallet(owner_id=users["off"], balance_kobo=100_000)
            db.add(w)
            await db.flush()
            tx = WalletTransaction(wallet_id=w.id, type=TxType.DEBIT, category=TxCategory.CHARGE, amount_kobo=5_000, balance_after_kobo=95_000,
                                   reference="T-1", description="NIN verification", initiated_by=users["off"])
            db.add(tx)
            now = datetime.now(timezone.utc)
            for i, (st, amt, nm) in enumerate([("pending", 50_000, "ada"), ("claimed", 80_000, "ada"), ("paid", 120_000, "kemi"), ("rejected", 20_000, "kemi")]):
                db.add(Withdrawal(customer_id=users[nm], card_id=reg.id, requested_amount_kobo=amt, charge_kobo=1_000, net_payable_kobo=amt - 1_000,
                                  bank_name="GTBank", account_number="0123456789", account_name="X", status=WithdrawalStatus(st),
                                  requested_at=now - timedelta(days=i)))
            await db.commit()
            ids = {"food": food.id, "reg": reg.id, "tx": tx.id}

        # ── withdrawals: counts, paging, search, amount and date filters ──
        cnt = await call("dir", "GET", "/withdrawals/counts")
        assert cnt == {"pending": 1, "claimed": 1, "paid": 1, "rejected": 1}
        assert (await call("dir", "GET", "/withdrawals/counts?q=Kemi"))["paid"] == 1
        assert (await call("dir", "GET", "/withdrawals/counts?q=Kemi"))["pending"] == 0
        assert len(await call("dir", "GET", "/withdrawals?status_filter=paid")) == 1
        assert len(await call("dir", "GET", "/withdrawals?q=ada")) == 2
        assert len(await call("dir", "GET", "/withdrawals?min_naira=600&max_naira=900")) == 1
        assert len(await call("dir", "GET", "/withdrawals?page_size=3&page=2")) == 1
        today = datetime.now(timezone.utc).date().isoformat()
        assert len(await call("dir", "GET", f"/withdrawals?date_from={today}&date_to={today}")) == 1
        await call("dir", "GET", "/withdrawals?date_from=nope", 422)
        await call("ada", "GET", "/withdrawals", 403)

        # ── notification link round-trip ──
        from app.services.notification_service import send_notification
        async with maker() as db:
            await send_notification(db, user_id=users["ada"], title="Hi", body="b", deep_link_url=f"/customer/cards/{ids['food']}")
            await send_notification(db, user_id=users["ada"], title="Plain", body="b")
            await db.commit()
        ns = await call("ada", "GET", "/notifications")
        by_title = {n["title"]: n for n in ns}
        assert by_title["Hi"]["link"] == f"/customer/cards/{ids['food']}" and by_title["Plain"]["link"] is None

        # ── officer disputes a wallet transaction straight to the director ──
        d = await call("off", "POST", "/disputes", 201, json={"entity_type": "wallet_transaction", "entity_id": str(ids["tx"]), "reason": "amount_wrong", "message": "charged twice"})
        assert d["assigned_to"] is None
        await call("off", "GET", f"/disputes/{d['id']}")
        assert [x["id"] for x in (await call("off", "GET", "/disputes"))["data"]] == [d["id"]]
        assert [x["id"] for x in (await call("dir", "GET", "/disputes"))["data"]] == [d["id"]]
        await call("off", "POST", "/disputes", 409, json={"entity_type": "wallet_transaction", "entity_id": str(ids["tx"]), "reason": "other", "message": "again"})
        det = await call("dir", "GET", f"/disputes/{d['id']}")
        assert det["can_resolve"] is False                      # unclaimed: nobody can resolve yet
        ns = await call("dir", "GET", "/notifications")
        assert any(n["link"] == f"/disputes/{d['id']}" for n in ns)
        # a customer cannot dispute somebody else's transaction
        await call("ada", "POST", "/disputes", 404, json={"entity_type": "wallet_transaction", "entity_id": str(ids["tx"]), "reason": "other", "message": "x"})

        # ── per-SMS fee, accrual for an officer-managed customer, deducted at withdrawal ──
        fee = await call("dir", "PUT", "/sms/fee", json={"fee_per_sms_kobo": 500, "provider_cost_per_segment_kobo": 400})
        assert fee["fee_per_sms_kobo"] == 500
        await call("off", "PUT", "/sms/fee", 403, json={"fee_per_sms_kobo": 1})
        await call("off", "PATCH", f"/users/{users['kemi']}/sms-alerts", json={"enabled": True})
        from app.services import sms_service
        async with maker() as db:
            k = await db.get(User, users["kemi"])
            r = await sms_service.send_card_sms(db, k, "MonieKing: ₦5,000 contributed — thanks")
            await db.commit()
        assert r == {"sent": True, "charged_kobo": 500, "segments": 1}
        assert "₦" not in sent[-1][1]
        assert await _scalar(maker, "SELECT balance_kobo FROM wallets WHERE owner_id = :u", u=users["off"]) == 100_000   # officer wallet untouched
        assert await _scalar(maker, "SELECT sms_accrued_kobo FROM users WHERE id = :u", u=users["kemi"]) == 500
        # not opted in -> nothing sent, nothing charged
        async with maker() as db:
            a = await db.get(User, users["ada"])
            n_before = len(sent)
            r2 = await sms_service.send_card_sms(db, a, "hello")
        assert r2["sent"] is False and len(sent) == n_before
        # a normal (wallet) customer pays from the wallet
        await call("ada", "PATCH", f"/users/{users['ada']}/sms-alerts", json={"enabled": True})
        async with maker() as db:
            a = await db.get(User, users["ada"])
            r3 = await sms_service.send_card_sms(db, a, "x" * 200)     # 2 segments
            await db.commit()
        assert r3["charged_kobo"] == 1000
        assert await _scalar(maker, "SELECT balance_kobo FROM wallets WHERE owner_id = :u", u=users["ada"]) == -1000
        # the officer's stat card value is visible on the customer
        me = await call("off", "GET", f"/users/{users['kemi']}")
        assert me["sms_accrued_kobo"] == 500
        # the monthly charge is gone
        assert (await call("dir", "POST", "/admin/billing/charge-monthly-sms"))["status"] == "skipped"

        # ── bulk SMS: preview + send ──
        pv = await call("dir", "POST", "/sms/preview", json={"audience": "all_customers", "message": "Hello ₦ — " + "y" * 150})
        assert pv["recipients"] == 3 and pv["encoding"] == "GSM-7" and pv["segments"] == 1
        assert pv["provider_cost_kobo"] == 3 * 400 and pv["extra_segments_avoided"] >= 0
        assert (await call("dir", "POST", "/sms/preview", json={"audience": "personal", "message": "hi", "user_ids": [str(users["ada"])]}))["recipients"] == 1
        n_before = len(sent)
        res = await call("dir", "POST", "/sms/send", json={"audience": "all_customers", "message": "Hello everyone"})
        assert res["sent"] == 4 - 1 + 0 or res["sent"] == 3          # three customers
        assert len(sent) - n_before == 3
        await call("dir", "POST", "/sms/send", 400, json={"audience": "qualified_food", "message": "x"})   # nobody qualified yet

        # ── next of kin: persists; bad phone rejected ──
        r = await call("ada", "PATCH", "/users/me", json={"next_of_kin_name": "Chidi Obi", "next_of_kin_phone": "+2348012345678"})
        assert r["next_of_kin_phone"] == "08012345678"
        assert await _scalar(maker, "SELECT next_of_kin_name FROM users WHERE id = :u", u=users["ada"]) == "Chidi Obi"
        await call("ada", "PATCH", "/users/me", 422, json={"next_of_kin_phone": "123"})

        # ── director customer detail ──
        ex = await call("dir", "GET", f"/director-customers/{users['ada']}/extra")
        assert ex["next_of_kin"] == {"name": "Chidi Obi", "phone": "08012345678"} and ex["zone_name"] == "Zone A"
        assert ex["officer"]["full_name"] == "Officer Femi"
        cd = await call("dir", "GET", f"/director-customers/{users['kemi']}/cards/{ids['reg']}")
        assert cd["card"]["total_days_contributed"] == 5            # counted from records, not the cached counter
        assert len(cd["payments"]) == 1 and cd["payments"][0]["days"] == 5 and cd["payments"][0]["withdrawn_days"] == 2
        assert {w["status"] for w in cd["withdrawals"]} >= {"paid", "rejected"}
        await call("dir", "GET", f"/director-customers/{users['ada']}/cards/{ids['reg']}", 404)   # not their card
        await call("ada", "GET", f"/director-customers/{users['ada']}/extra", 403)
        m = await call("dir", "POST", f"/director-customers/{users['ada']}/message", json={"body": "Please call me", "also_sms": True})
        assert m["sms_sent"] is True
        assert any(n["body"] == "Please call me" for n in await call("ada", "GET", "/notifications"))
        await call("dir", "POST", f"/director-customers/{users['ada']}/message-kin", json={"body": "hello"})
        assert sent[-1][0] == "08012345678"
        await call("dir", "POST", f"/director-customers/{users['kemi']}/message-kin", 400, json={"body": "hello"})

        # ── food: ping-all reaches only those not yet collected; collected shows on the card ──
        async with maker() as db:
            db.add(FoodEntitlement(card_id=ids["food"], customer_id=users["ada"], qr_token="qr1", collection_pin="1234", year=2026, status=EntitlementStatus.ACTIVE))
            await db.commit()
        assert (await call("dir", "POST", "/food-collections/oversight/ping-all"))["pinged"] == 1
        await sql(maker, "UPDATE food_entitlements SET status='used'")
        assert (await call("dir", "POST", "/food-collections/oversight/ping-all"))["pinged"] == 0

        # ── maintenance switch (public read; director write) ──
        assert (await call("ada", "GET", "/maintenance"))["on"] is False
        await call("ada", "PUT", "/maintenance", 403, json={"on": True})
        on = await call("dir", "PUT", "/maintenance", json={"on": True, "message": "Back soon"})
        assert on["on"] is True and (await call("ada", "GET", "/maintenance"))["message"] == "Back soon"
        assert (await call("dir", "PUT", "/maintenance", json={"on": False}))["on"] is False

        # ── customers: inactive count matches the list (cardless customers included) ──
        st = await call("dir", "GET", "/customer-stats/overview")
        lst = await call("dir", "GET", "/customer-stats/inactive-customers")
        assert st["inactive_contributors"] == lst["total"]
    await engine.dispose()
    from app.core.database import engine as _app_engine
    await _app_engine.dispose()


async def _scalar(maker, q, **p):
    async with maker() as db:
        return (await db.execute(text(q), p)).scalar()


async def sql(maker, q, **p):
    async with maker() as db:
        await db.execute(text(q), p)
        await db.commit()


def test_module_b(monkeypatch):
    asyncio.run(_run(monkeypatch))
