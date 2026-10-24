"""Module D1: purge engine — test users, their data and nothing else."""
import asyncio
import os
import uuid

import pytest

TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "")
_db_name = TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0].lower() if TEST_DB_URL else ""
pytestmark = pytest.mark.skipif(not TEST_DB_URL or "test" not in _db_name, reason="needs TEST_DATABASE_URL (a *test* database)")

if TEST_DB_URL and "test" in _db_name:
    os.environ["DATABASE_URL"] = TEST_DB_URL
    from sqlalchemy import text, select, func
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    import app.main  # noqa: F401  (registers every model)
    from app.core.database import Base
    from app.models.user import User, UserRole, UserStatus
    from app.models.zone import Zone
    from app.models.card import ContributionCard, ContributionRecord, CardType, ContributionMethod
    from app.models.wallet import Wallet, WalletTransaction, TxType, TxCategory
    from app.models.withdrawal import Withdrawal, WithdrawalStatus
    from app.services import purge_service


def _user(role, name, phone, zone, **kw):
    return User(role=role, full_name=name, phone_number=phone, bank_code="058", bank_name="GTBank", account_number="0123456789",
                account_name=name.upper(), status=UserStatus.ACTIVE, zone_id=zone, **kw)


async def _run():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in ("DROP SCHEMA public CASCADE", "CREATE SCHEMA public",
                     "CREATE SEQUENCE card_number_seq START 1015", "CREATE SEQUENCE customer_number_seq START 1000"):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with maker() as db:
        zone = Zone(name="Z")
        db.add(zone)
        await db.flush()
        real = _user(UserRole.CUSTOMER, "Real Customer", "08010000001", zone.id)
        tcust = _user(UserRole.CUSTOMER, "Test Customer", "08010000002", zone.id, is_test=True)
        toff = _user(UserRole.OFFICER, "Test Officer", "08010000003", zone.id, is_test=True)
        direc = _user(UserRole.DIRECTOR, "Real Director", "08010000004", None)
        db.add_all([real, tcust, toff, direc])
        await db.flush()

        rcard = ContributionCard(owner_id=real.id, card_type=CardType.REGULAR, rate_kobo=10_000, total_days_contributed=2, total_contributed_kobo=20_000)
        tcard = ContributionCard(owner_id=tcust.id, card_type=CardType.REGULAR, rate_kobo=10_000, total_days_contributed=3, total_contributed_kobo=30_000)
        db.add_all([rcard, tcard])
        await db.flush()
        # a TEST officer recorded the REAL customer's payments — must survive, re-attributed
        for i in range(2):
            db.add(ContributionRecord(card_id=rcard.id, logical_month=1, logical_day=i + 1, amount_kobo=10_000, contributed_by=toff.id,
                                      method=ContributionMethod.CASH_VIA_OFFICER, reference=f"R-{i}"))
        for i in range(3):
            db.add(ContributionRecord(card_id=tcard.id, logical_month=1, logical_day=i + 1, amount_kobo=10_000, contributed_by=toff.id,
                                      method=ContributionMethod.CASH_VIA_OFFICER, reference=f"T-{i}"))
        rw = Wallet(owner_id=real.id, balance_kobo=5_000)
        tw = Wallet(owner_id=tcust.id, balance_kobo=7_000)
        db.add_all([rw, tw])
        await db.flush()
        db.add(WalletTransaction(wallet_id=tw.id, type=TxType.CREDIT, category=TxCategory.WALLET_FUNDING, amount_kobo=7_000, balance_after_kobo=7_000,
                                 reference="TW-1", description="x", initiated_by=tcust.id))
        db.add(WalletTransaction(wallet_id=rw.id, type=TxType.CREDIT, category=TxCategory.WALLET_FUNDING, amount_kobo=5_000, balance_after_kobo=5_000,
                                 reference="RW-1", description="x", initiated_by=toff.id))   # test officer funded a real wallet
        db.add(Withdrawal(customer_id=tcust.id, card_id=tcard.id, requested_amount_kobo=10_000, charge_kobo=0, net_payable_kobo=10_000,
                          bank_name="GTBank", account_number="0123456789", account_name="X", status=WithdrawalStatus.PENDING,
                          claimed_by_director_id=direc.id))
        await db.execute(text("INSERT INTO notifications (id, user_id, title, body, type, is_read, created_at) VALUES (gen_random_uuid(), :u, 't', 'b', 'info', false, now())"), {"u": str(tcust.id)})
        await db.commit()
        ids = {"real": real.id, "tcust": tcust.id, "toff": toff.id, "dir": direc.id, "rcard": rcard.id}

    async with maker() as db:
        plan = await purge_service.build_plan(db, [ids["tcust"], ids["toff"]])
        s = purge_service.summarize(plan)
        assert s["users"] == 2 and s["can_purge"], s
        assert s["tables"]["contribution_cards"] == 1 and s["tables"]["contribution_records"] == 3
        assert any(v["full_name"] == "Test Customer" for v in s["value_users"])        # has wallet money / card balance
        assert "contribution_records.contributed_by" in s["will_reassign_to_you"]
        assert "wallet_transactions.initiated_by" in s["will_reassign_to_you"]

    # protected tables (like the cooperative money book) refuse DELETE/UPDATE through "immutable" triggers
    async with maker() as db:
        await db.execute(text("CREATE FUNCTION refuse_change() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'immutable'; END; $$ LANGUAGE plpgsql"))
        for t in ("notifications", "wallet_transactions"):
            await db.execute(text(f"CREATE TRIGGER {t}_immutable BEFORE UPDATE OR DELETE ON {t} FOR EACH ROW EXECUTE FUNCTION refuse_change()"))
        await db.commit()

    async with maker() as db:
        res = await purge_service.purge(db, test_user_ids=[ids["tcust"], ids["toff"]], director_id=ids["dir"])
        await db.commit()
        assert res["users"] == 2

    async with maker() as db:   # protection is back on afterwards
        on = (await db.execute(text("select count(*) from pg_trigger where tgname like '%_immutable' and tgenabled = 'O'"))).scalar_one()
        assert on == 2

    async with maker() as db:
        users = {u.full_name for u in (await db.execute(select(User))).scalars().all()}
        assert users == {"Real Customer", "Real Director"}
        assert (await db.execute(select(func.count()).select_from(ContributionCard))).scalar_one() == 1
        recs = (await db.execute(select(ContributionRecord))).scalars().all()
        assert len(recs) == 2 and all(r.contributed_by == ids["dir"] for r in recs)
        txs = (await db.execute(select(WalletTransaction))).scalars().all()
        assert len(txs) == 1 and txs[0].initiated_by == ids["dir"]
        assert (await db.execute(select(func.count()).select_from(Withdrawal))).scalar_one() == 0
        assert (await db.execute(text("select count(*) from notifications"))).scalar_one() == 0

        # a conflict: a test wallet transaction that touches a REAL card must block the purge
        extra = _user(UserRole.CUSTOMER, "Test Two", "08010000009", None, is_test=True)
        db.add(extra)
        await db.flush()
        w = Wallet(owner_id=extra.id, balance_kobo=0)
        db.add(w)
        await db.flush()
        db.add(WalletTransaction(wallet_id=w.id, type=TxType.DEBIT, category=TxCategory.CHARGE, amount_kobo=1, balance_after_kobo=0,
                                 reference="X-1", description="x", initiated_by=extra.id, related_card_id=ids["rcard"]))
        await db.commit()
        plan = await purge_service.build_plan(db, [extra.id])
        assert not purge_service.summarize(plan)["can_purge"]
        assert any(c["table"] == "wallet_transactions" for c in plan.conflicts)
    await engine.dispose()


def test_purge_engine():
    asyncio.run(_run())
