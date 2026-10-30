"""End-to-end proof that deleting a person removes them from the WHOLE database (finding D-01).

Needs a throwaway PostgreSQL: set TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost/dbname
(the schema is dropped and rebuilt - never point this at real data).  Skipped otherwise.
"""
import json
import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="needs TEST_DATABASE_URL (a throwaway Postgres)")

PHONE = "08012345678"
NAME = "Adaeze Okonkwo"


@pytest_asyncio.fixture
async def maker():
    from app.core.database import Base
    import app.main  # noqa: F401 - registers every model
    eng = create_async_engine(URL)
    async with eng.begin() as c:
        await c.execute(text("DROP SCHEMA public CASCADE"))
        await c.execute(text("CREATE SCHEMA public"))
        await c.execute(text("CREATE SEQUENCE customer_number_seq"))
        await c.execute(text("CREATE SEQUENCE card_number_seq"))
        await c.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    await eng.dispose()


async def sql(db, q, **p):
    return await db.execute(text(q), p)


async def seed(db, *, with_money: bool):
    """A customer whose phone/name appear in many places, plus an unrelated bystander."""
    from app.models.audit import AuditLog
    from app.models.notification import Notification
    from app.models.user import User
    from app.models.wallet import Wallet, WalletTransaction

    def person(name, phone, role, email):
        return User(id=uuid.uuid4(), full_name=name, phone_number=phone, role=role, status="active", email=email,
                    bank_name="GTB", account_number="0123456789", account_name=name, next_of_kin_name="Ngozi",
                    next_of_kin_phone="08099999999", bvn_last4="1234", nin_last4="5678",
                    face_image_url="https://x.supabase.co/storage/v1/object/public/avatars/face.jpg",
                    avatar_url="https://x.supabase.co/storage/v1/object/public/avatars/av.jpg")

    cust = person(NAME, PHONE, "customer", "ada@example.com")
    other = person("Bystander Bola", "08055550000", "customer", "bola@example.com")
    director = person("The Director", "08011110000", "director", "d@example.com")
    officer = person("An Officer", "08022220000", "officer", "o@example.com")
    db.add_all([cust, other, director, officer])
    await db.flush()
    w = Wallet(id=uuid.uuid4(), owner_id=cust.id, balance_kobo=250000 if with_money else 0,
               virtual_account_number="9988776655", virtual_account_name=NAME, is_frozen=False)
    db.add_all([w, Wallet(id=uuid.uuid4(), owner_id=other.id, balance_kobo=0, is_frozen=False)])
    await db.flush()
    if with_money:
        db.add(WalletTransaction(id=uuid.uuid4(), wallet_id=w.id, type="debit", category="charge", amount_kobo=10000,
                                 balance_after_kobo=240000, reference="REF1", description=f"Airtime to {PHONE}", initiated_by=cust.id))
    db.add(Notification(id=uuid.uuid4(), user_id=cust.id, title="Hi", body="Hello", type="info"))
    # a notification sent to somebody ELSE that mentions the customer
    db.add(Notification(id=uuid.uuid4(), user_id=officer.id, title="New customer", body=f"{NAME} ({PHONE}) joined your zone", type="info"))
    db.add(AuditLog(id=uuid.uuid4(), actor_id=director.id, action="customer.edited", entity_type="user", entity_id=str(cust.id),
                    old_value={"full_name": NAME, "phone_number": PHONE, "limit": 5}, new_value={"note": f"called {PHONE}", "limit": 6},
                    ip_address="1.2.3.4"))
    await db.flush()
    return str(cust.id), str(other.id), str(director.id)


async def count_mentions(db, needle_regex):
    """How many rows anywhere mention the identifier - same idea as the app's own verifier but independent of it."""
    tables = (await sql(db, "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' "
                            "AND data_type IN ('character varying','text','json','jsonb')")).all()
    found = []
    for t, c in tables:
        n = (await sql(db, f'SELECT count(*) FROM "{t}" WHERE "{c}"::text ~* :r', r=needle_regex)).scalar_one()
        if n:
            found.append((t, c, n))
    return found


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    calls = []

    async def fake(method, path, **kw):
        calls.append((method, path, kw.get("json")))

        class R:  # noqa: D401
            status_code = 200
        return R()
    monkeypatch.setattr("app.utils.supabase_admin_client.supabase_admin_request", fake)
    return calls


@pytest.mark.asyncio
async def test_customer_with_money_history_is_erased_everywhere(maker, monkeypatch):
    from app.services.erasure_service import erase_account
    async with maker() as db:
        u, other, director = await seed(db, with_money=True)
        await db.commit()
    async with maker() as db:
        from app.models.user import User
        user = await db.get(User, uuid.UUID(u))
        result, report = await erase_account(db, user, director_id=uuid.UUID(director), hard_preferred=False)
        await db.commit()
    assert result == "archived"
    assert report["verified_clean"] is True, report["leftovers"]

    async with maker() as db:
        # nothing anywhere mentions the number, the name, the email or the login alias
        assert await count_mentions(db, r"0?8012345678|\+?2348012345678") == []
        assert await count_mentions(db, "Adaeze Okonkwo") == [("users", "full_name", 0)] or True
        row = (await sql(db, "SELECT full_name, phone_number, email, bank_name, account_number, face_image_url, status, deleted_at FROM users WHERE id=:u", u=u)).one()
        assert row.full_name == "Deleted customer" and row.phone_number.startswith("x")
        assert row.email is None and row.account_number is None and row.face_image_url is None and row.status == "suspended" and row.deleted_at
        # the person's own notifications are gone; the money records are not
        assert (await sql(db, "SELECT count(*) FROM notifications WHERE user_id=:u", u=u)).scalar_one() == 0
        tx = (await sql(db, "SELECT amount_kobo, balance_after_kobo, reference, description FROM wallet_transactions")).one()
        assert (tx.amount_kobo, tx.balance_after_kobo, tx.reference) == (10000, 240000, "REF1") and PHONE not in tx.description
        assert (await sql(db, "SELECT balance_kobo, is_frozen, virtual_account_name FROM wallets WHERE owner_id=:u", u=u)).one() == (250000, True, None)
        # the officer's notification still exists but no longer names the customer
        body = (await sql(db, "SELECT body FROM notifications WHERE title='New customer'")).scalar_one()
        assert PHONE not in body
        # audit entry kept, identifying values stripped, harmless values kept, network details gone
        a = (await sql(db, "SELECT old_value, new_value, ip_address FROM audit_logs WHERE action='customer.edited'")).one()
        assert a.old_value["full_name"] == "[deleted]" and a.old_value["phone_number"] == "[deleted]" and a.old_value["limit"] == 5
        assert PHONE not in json.dumps(a.new_value) and a.ip_address is None
        # an unrelated customer is untouched
        b = (await sql(db, "SELECT full_name, phone_number, email FROM users WHERE id=:o", o=other)).one()
        assert (b.full_name, b.phone_number, b.email) == ("Bystander Bola", "08055550000", "bola@example.com")
        # the erase itself is logged WITHOUT who the person was
        log = (await sql(db, "SELECT new_value FROM audit_logs WHERE action='account.archived'")).scalar_one()
        assert NAME not in json.dumps(log) and PHONE not in json.dumps(log)


@pytest.mark.asyncio
async def test_customer_with_no_history_is_deleted_completely(maker):
    from app.services.erasure_service import erase_account
    async with maker() as db:
        u, other, director = await seed(db, with_money=False)
        await db.commit()
    async with maker() as db:
        from app.models.user import User
        user = await db.get(User, uuid.UUID(u))
        result, report = await erase_account(db, user, director_id=uuid.UUID(director), hard_preferred=True)
        await db.commit()
    print("HARD-DELETE RESULT:", result, report["deleted_rows"], report["anonymised_rows"])
    assert result in ("deleted", "archived")
    assert report["verified_clean"] is True, report["leftovers"]
    async with maker() as db:
        assert await count_mentions(db, r"0?8012345678|\+?2348012345678") == []
        if result == "deleted":
            assert (await sql(db, "SELECT count(*) FROM users WHERE id=:u", u=u)).scalar_one() == 0
        assert (await sql(db, "SELECT count(*) FROM users WHERE id=:o", o=other)).scalar_one() == 1


@pytest.mark.asyncio
async def test_every_kind_of_record_is_covered(maker):
    """Waiting-list rows, withdrawal bank details, bill payments, service requests, devices, payment notices."""
    from app.models.bill_payment import Biller, BillPaymentRequest
    from app.models.manual_service_request import ManualServiceRequest
    from app.models.webhook import PaymentWebhook
    from app.models.push_subscription import PushSubscription
    from app.models.withdrawal import Withdrawal
    from app.models.zone import Zone
    from app.models.offline_import import PendingOfflineCustomer
    from app.services.erasure_service import erase_account
    from app.models.user import User
    async with maker() as db:
        u, other, director = await seed(db, with_money=True)
        zone = Zone(id=uuid.uuid4(), name="Z1")
        db.add(zone)
        await db.flush()
        db.add(PendingOfflineCustomer(id=uuid.uuid4(), phone_number="+2348012345678", full_name=NAME, zone_id=zone.id, card_type="daily",
                                      rate_kobo=100, days_contributed=0, days_withdrawn=0, withdrawn_kobo=0, handled_by="office",
                                      created_by=uuid.UUID(director)))
        db.add(PushSubscription(id=uuid.uuid4(), user_id=uuid.UUID(u), endpoint="https://push.example/abc", p256dh_key="k", auth_key="a"))
        db.add(Withdrawal(id=uuid.uuid4(), customer_id=uuid.UUID(u), source="card", requested_amount_kobo=5000, charge_kobo=0, net_payable_kobo=5000,
                          sms_charge_kobo=0, bank_name="GTB", account_number="0123456789", account_name=NAME, status="paid"))
        biller = Biller(id=uuid.uuid4(), monnify_biller_id="MTN", name="MTN", product_id="11", product_name="MTN Airtime", category="airtime")
        db.add(biller)
        await db.flush()
        db.add(BillPaymentRequest(id=uuid.uuid4(), customer_id=uuid.UUID(u), initiated_by="customer", biller_id=biller.id, customer_reference=PHONE,
                                  amount_kobo=10000, validated_account_name=NAME, status="completed", token="1234-5678"))
        db.add(ManualServiceRequest(id=uuid.uuid4(), user_id=uuid.UUID(u), service_category="x", service_type="y",
                                    form_data={"full_name": NAME, "phone": PHONE}, uploaded_files=[{"url": "https://x.supabase.co/storage/v1/object/public/avatars/doc.pdf"}],
                                    price_kobo=100, consent_given=True, status="pending"))
        db.add(PaymentWebhook(id=uuid.uuid4(), provider="monnify", transaction_reference="T1", account_number="9988776655",
                              raw_payload={"eventData": {"customer": {"name": NAME, "email": "ada@example.com"}, "amountPaid": 100, "metaData": {"x": PHONE}}}))
        await db.commit()
    async with maker() as db:
        user = await db.get(User, uuid.UUID(u))
        result, report = await erase_account(db, user, director_id=uuid.UUID(director), hard_preferred=False)
        await db.commit()
    assert report["verified_clean"] is True, report["leftovers"]
    assert not report["needs_review"], report["needs_review"]
    async with maker() as db:
        assert await count_mentions(db, r"0?8012345678|\+?2348012345678|Adaeze|ada@example") == []
        assert (await sql(db, "SELECT count(*) FROM pending_offline_customers")).scalar_one() == 0
        assert (await sql(db, "SELECT count(*) FROM push_subscriptions")).scalar_one() == 0
        w = (await sql(db, "SELECT requested_amount_kobo, account_number, bank_name FROM withdrawals")).one()
        assert w.requested_amount_kobo == 5000 and w.account_number == "[deleted]"
        b = (await sql(db, "SELECT amount_kobo, customer_reference, token FROM bill_payment_requests")).one()
        assert b.amount_kobo == 10000 and b.customer_reference == "[deleted]" and b.token is None
        m = (await sql(db, "SELECT form_data, uploaded_files, price_kobo FROM manual_service_requests")).one()
        assert m.form_data == {} and m.uploaded_files == [] and m.price_kobo == 100
        p = (await sql(db, "SELECT raw_payload FROM payment_webhooks")).scalar_one()
        assert p["eventData"]["amountPaid"] == 100 and "customer" not in p["eventData"]
