"""Wallet funding fee: range validation, fee lookup, webhook credit with/without a fee, director settings, loss + stats."""
import asyncio
import os

import pytest

os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL") or "postgresql+asyncpg://x@localhost/x_test")
from app.services.funding_fees import DEFAULT_TIERS, fee_for, validate_tiers


def test_defaults_are_valid_and_gaps_are_caught():
    assert validate_tiers(DEFAULT_TIERS) == []
    gap = [{"from": 0, "to": 5000, "fee": 10}, {"from": 6000, "to": 10000, "fee": 20}, {"from": 10001, "to": None, "fee": 30}]
    msgs = validate_tiers(gap)
    assert any("Gap" in m and "₦5,001" in m and "₦5,999" in m for m in msgs)
    overlap = [{"from": 0, "to": 5000, "fee": 10}, {"from": 4000, "to": None, "fee": 20}]
    assert any("Overlap" in m for m in validate_tiers(overlap))
    assert any("start at ₦0" in m for m in validate_tiers([{"from": 100, "to": None, "fee": 5}]))
    assert any("open-ended" in m for m in validate_tiers([{"from": 0, "to": 5000, "fee": 5}]))
    assert validate_tiers([]) 


def test_fee_lookup():
    assert fee_for(10_000, DEFAULT_TIERS) == 1000          # ₦100 -> ₦10
    assert fee_for(500_000, DEFAULT_TIERS) == 1000         # ₦5,000 -> first range
    assert fee_for(500_100, DEFAULT_TIERS) == 2000         # ₦5,001 -> second range
    assert fee_for(2_500_000, DEFAULT_TIERS) == 5000       # ₦25,000 -> open-ended range
    assert fee_for(500, DEFAULT_TIERS) == 0                # ₦5: fee would eat the payment -> waived


TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "")
_db = TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0].lower() if TEST_DB_URL else ""
needs_db = pytest.mark.skipif(not TEST_DB_URL or "test" not in _db, reason="needs TEST_DATABASE_URL (a *test* database)")


@needs_db
def test_webhook_and_director_flow(monkeypatch):
    asyncio.run(_run(monkeypatch))


async def _run(monkeypatch):
    os.environ["DATABASE_URL"] = TEST_DB_URL
    import httpx
    from sqlalchemy import text, select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    import app.main as main_mod
    from app.core.database import Base, get_db
    from app.core.dependencies import get_current_user
    from app.core.limiter import limiter
    from app.models.user import User, UserRole, UserStatus
    from app.models.wallet import Wallet
    from fastapi import Request
    import app.api.v1.routes.webhooks as wh
    from app.integrations.monnify import MonnifyProvider

    limiter.enabled = False
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        c = User(role=UserRole.CUSTOMER, full_name="Ada Okafor", phone_number="08011112222", status=UserStatus.ACTIVE)
        d = User(role=UserRole.DIRECTOR, full_name="Dir", phone_number="08077778888", status=UserStatus.ACTIVE)
        db.add_all([c, d]); await db.flush()
        w = Wallet(owner_id=c.id, balance_kobo=0, virtual_account_number="1040544636", virtual_account_bank="Moniepoint")
        db.add(w); await db.commit()
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

    prov = MonnifyProvider()
    prov.verify_webhook_signature = lambda raw, sig: True
    monkeypatch.setattr(wh, "get_payment_provider", lambda: prov)

    def payload(ref, amount, settle):
        return {"eventType": "SUCCESSFUL_TRANSACTION", "eventData": {
            "transactionReference": ref, "paymentStatus": "PAID", "amountPaid": amount, "settlementAmount": settle,
            "destinationAccountInformation": {"accountNumber": "1040544636"}}}

    async def balance():
        async with maker() as s:
            return (await s.execute(select(Wallet.balance_kobo).where(Wallet.owner_id == ids["c"]))).scalar_one()

    transport = httpx.ASGITransport(app=main_mod.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        hdr = {"monnify-signature": "x"}
        # charging OFF (default): the customer sees the full amount, Monnify's fee is ours
        r = await c.post("/api/v1/webhooks/monnify/payment", json=payload("R1", 100, 98.39), headers=hdr)
        assert r.status_code == 200 and await balance() == 10_000

        # director turns charging ON; a gap in the ranges is refused with a clear message
        r = await c.get("/api/v1/director/funding-fees")
        assert r.status_code == 200 and r.json()["charge_customers"] is False and len(r.json()["tiers"]) == 4
        bad = [{"from": 0, "to": 5000, "fee": 10}, {"from": 6000, "to": None, "fee": 20}]
        r = await c.put("/api/v1/director/funding-fees", json={"charge_customers": True, "tiers": bad})
        assert r.status_code == 422 and "Gap" in r.json()["detail"]
        r = await c.put("/api/v1/director/funding-fees", json={"charge_customers": True, "tiers": DEFAULT_TIERS})
        assert r.status_code == 200 and r.json()["charge_customers"] is True

        # customers can see the ranges
        who["id"] = ids["c"]
        r = await c.get("/api/v1/wallets/funding-fee")
        assert r.json()["charging"] is True and len(r.json()["tiers"]) == 4
        assert (await c.get("/api/v1/director/funding-fees")).status_code == 403

        # charging ON: ₦100 funding -> ₦10 fee -> credited ₦90
        r = await c.post("/api/v1/webhooks/monnify/payment", json=payload("R2", 100, 98.39), headers=hdr)
        assert r.status_code == 200 and await balance() == 10_000 + 9_000
        # the history shows TWO honest lines: the full amount in, then the fee out under the default name
        async with maker() as s:
            lines = (await s.execute(text("SELECT type, category, amount_kobo, description FROM wallet_transactions WHERE reference IN ('R2', 'R2-FEE') ORDER BY created_at, reference"))).all()
        assert [(l.type, l.category, l.amount_kobo) for l in lines] == [("credit", "wallet_funding", 10_000), ("debit", "charge", 1_000)]
        assert lines[1].description == "NIPPS charge"
        # the director renames the charge; the next funding shows the new name
        who["id"] = ids["d"]
        cur = (await c.get("/api/v1/director/funding-fees")).json()
        assert cur["fee_label"] == "NIPPS charge"
        r = await c.put("/api/v1/director/funding-fees", json={"charge_customers": True, "pass_monnify_fee": False, "fee_label": "Transfer fee", "tiers": cur["tiers"]})
        assert r.status_code == 200 and r.json()["fee_label"] == "Transfer fee"
        r = await c.post("/api/v1/webhooks/monnify/payment", json=payload("R2B", 100, 98.39), headers=hdr)
        async with maker() as s:
            fee = (await s.execute(text("SELECT description, amount_kobo FROM wallet_transactions WHERE reference = 'R2B-FEE'"))).one()
        assert (fee.description, fee.amount_kobo) == ("Transfer fee", 1_000)
        await c.put("/api/v1/director/funding-fees", json={"charge_customers": True, "pass_monnify_fee": False, "fee_label": "NIPPS charge", "tiers": cur["tiers"]})
        who["id"] = ids["c"]
        before_bal = await balance()

        # director sees what was absorbed (R1) and what was collected (R2)
        who["id"] = ids["d"]
        s = (await c.get("/api/v1/director/funding-fees/summary")).json()
        assert s["absorbed"] == {"count": 1, "lost_kobo": 161}
        assert s["charged"]["collected_kobo"] == 2000 and s["charged"]["profit_kobo"] == 2000 - 2 * 161
        assert s["by_monnify_fee"] == [{"monnify_fee_kobo": 161, "count": 1, "lost_kobo": 161}]
        # Monnify-charge mode: the customer pays Monnify's actual charge and sees what is left
        r = await c.put("/api/v1/director/funding-fees", json={"charge_customers": False, "pass_monnify_fee": True, "tiers": DEFAULT_TIERS})
        assert r.status_code == 200 and r.json()["pass_monnify_fee"] is True
        before = await balance()
        r = await c.post("/api/v1/webhooks/monnify/payment", json=payload("R3", 100, 98.39), headers=hdr)
        assert r.status_code == 200 and await balance() == before + 9_839
        who["id"] = ids["c"]
        assert (await c.get("/api/v1/wallets/funding-fee")).json()["mode"] == "monnify"
        who["id"] = ids["d"]
        st = (await c.get("/api/v1/director/funding-fees/stats")).json()
        assert st["overall"]["fundings"] == 4 and st["overall"]["customers"] == 1 and len(st["monthly"]) == 1
    main_mod.app.dependency_overrides.clear()
    await engine.dispose()


@needs_db
def test_money_in_out_ignores_refunded_purchases():
    asyncio.run(_in_out())


async def _in_out():
    os.environ["DATABASE_URL"] = TEST_DB_URL
    import uuid
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.core.database import Base
    from app.models.user import User, UserRole, UserStatus
    from app.models.wallet import Wallet, TxCategory
    from app.services.wallet_service import credit_wallet, debit_wallet
    from app.api.v1.routes.wallets import net_in_out
    from app.models.wallet import WalletTransaction

    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        u = User(role=UserRole.CUSTOMER, full_name="Ada", phone_number="08011112222", status=UserStatus.ACTIVE)
        db.add(u); await db.flush()
        w = Wallet(owner_id=u.id, balance_kobo=0); db.add(w); await db.flush()
        await credit_wallet(db, wallet=w, amount_kobo=100_000, category=TxCategory.WALLET_FUNDING, reference="f1", description="fund", initiated_by=u.id)
        job = uuid.uuid4()
        await debit_wallet(db, wallet=w, amount_kobo=30_000, category=TxCategory.CHARGE, reference="d1", description="bill", initiated_by=u.id,
                           related_entity_type="bill_payment", related_entity_id=job)
        await credit_wallet(db, wallet=w, amount_kobo=30_000, category=TxCategory.REVERSAL, reference="r1", description="refund", initiated_by=u.id,
                            related_entity_type="bill_payment", related_entity_id=job)
        await debit_wallet(db, wallet=w, amount_kobo=10_000, category=TxCategory.CHARGE, reference="d2", description="airtime", initiated_by=u.id,
                           related_entity_type="bill_payment", related_entity_id=uuid.uuid4())
        await db.commit()
        money_in, money_out = await net_in_out(db, w.id, [WalletTransaction.wallet_id == w.id])
    # funded 1,000 and really spent 100; the failed 300 (spent then refunded) is in neither number
    assert (money_in, money_out) == (100_000, 10_000)
    await engine.dispose()
