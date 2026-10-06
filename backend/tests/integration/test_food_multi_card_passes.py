"""Integration tests: multiple food cards per customer, against a REAL Postgres.

These exercise the real models, the real route functions, and the real
UNIQUE(card_id) constraint, which is the only way to prove that two requests
creating entitlements at the same moment cannot fail or duplicate a pass.

SAFETY — these tests RESET THE WHOLE SCHEMA (DROP SCHEMA public CASCADE), so
they are skipped unless TEST_DATABASE_URL is set AND the database name
contains "test". They can never run against your real database by accident.

How to run (any empty throwaway database whose name contains "test"):
    createdb monieking_test
    TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/monieking_test \\
        python -m pytest tests/integration/test_food_multi_card_passes.py -q

Tests:
  1. The production scenario: card A's pass exists, card B completes, a
     director's oversight backfill runs, the customer opens their pass —
     no crash, two independent passes
  2. A collected pass never hides the new card's pass
  3. Opening the pass / running the backfill repeatedly creates nothing new
     and never changes an existing QR token or PIN
  4. An incomplete card gets no pass; customers never see each other's passes
  5. Concurrent opens + backfills never fail and never duplicate a pass
  6. A pass from a previous year is left alone and does not crash the page
"""
import asyncio
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "")
_db_name = TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0].lower() if TEST_DB_URL else ""

pytestmark = pytest.mark.skipif(
    not TEST_DB_URL or "test" not in _db_name,
    reason="set TEST_DATABASE_URL to a throwaway database whose name contains 'test'",
)

if TEST_DB_URL and "test" in _db_name:
    os.environ["DATABASE_URL"] = TEST_DB_URL
    from sqlalchemy import select, func, text
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

    import app.main  # noqa: F401  (imports every model so the metadata is complete)
    from app.core.database import Base
    from app.models.card import ContributionCard, CardType, CardStatus
    from app.models.food_entitlement import FoodEntitlement, EntitlementStatus
    from app.models.user import User, UserRole
    from app.api.v1.routes.food_collections import get_my_food_entitlement
    from app.api.v1.routes.food_ledger import _backfill_entitlements


# ── helpers ─────────────────────────────────────────────────────────────────

async def _new_env():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        for stmt in (
            "DROP SCHEMA public CASCADE",
            "CREATE SCHEMA public",
            "CREATE SEQUENCE card_number_seq START 1015",
            "CREATE SEQUENCE customer_number_seq START 1000",
        ):
            await conn.execute(text(stmt))
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    return engine, maker


async def _customer(maker, n):
    async with maker() as db:
        u = User(role=UserRole.CUSTOMER, full_name=f"Customer {n}", phone_number=f"0800000{n:04d}")
        db.add(u)
        await db.commit()
        return SimpleNamespace(id=u.id)      # the route only ever reads current_user.id


async def _food_card(maker, owner, days=372):
    async with maker() as db:
        c = ContributionCard(
            owner_id=owner.id, card_type=CardType.FOOD, rate_kobo=10000,
            total_days_contributed=days,
            status=CardStatus.COMPLETED if days >= 372 else CardStatus.ACTIVE,
        )
        db.add(c)
        await db.commit()
        await db.refresh(c)
        return SimpleNamespace(id=c.id, card_number=c.card_number)


async def _open_pass(maker, user):
    async with maker() as db:
        r = await get_my_food_entitlement(current_user=user, db=db)
        await db.commit()
        return r


async def _run_backfill(maker):
    async with maker() as db:
        await _backfill_entitlements(db)
        await db.commit()


async def _count(maker, **filters):
    async with maker() as db:
        stmt = select(func.count()).select_from(FoodEntitlement)
        for k, v in filters.items():
            stmt = stmt.where(getattr(FoodEntitlement, k) == v)
        return (await db.execute(stmt)).scalar_one()


def _run(coro_fn):
    async def wrapper():
        engine, maker = await _new_env()
        try:
            await coro_fn(maker)
        finally:
            await engine.dispose()
    asyncio.run(wrapper())


# ── tests ───────────────────────────────────────────────────────────────────

def test_second_completed_card_gives_a_second_independent_pass():
    async def body(maker):
        user = await _customer(maker, 1)
        card_a = await _food_card(maker, user)

        first = await _open_pass(maker, user)                    # lazy-create for card A
        assert first.has_entitlement and [p.card_number for p in first.passes] == [card_a.card_number]

        card_b = await _food_card(maker, user)                   # second card completes
        await _run_backfill(maker)                               # director opens oversight

        r = await _open_pass(maker, user)                        # <- used to raise MultipleResultsFound
        assert [p.card_number for p in r.passes] == [card_a.card_number, card_b.card_number]
        assert len({p.qr_token for p in r.passes}) == 2          # separate QR codes
        assert r.passes[0].qr_token == first.passes[0].qr_token  # card A's QR did not change
        assert await _count(maker, customer_id=user.id) == 2
    _run(body)


def test_collected_pass_does_not_hide_the_new_cards_pass():
    async def body(maker):
        user = await _customer(maker, 1)
        card_a = await _food_card(maker, user)
        await _open_pass(maker, user)
        async with maker() as db:                                # card A already collected
            ent = (await db.execute(select(FoodEntitlement))).scalar_one()
            ent.status = EntitlementStatus.USED
            ent.collected_at = datetime(2026, 9, 29, tzinfo=timezone.utc)
            await db.commit()

        card_b = await _food_card(maker, user)
        r = await _open_pass(maker, user)

        assert [(p.card_number, p.status) for p in r.passes] == [
            (card_a.card_number, "used"), (card_b.card_number, "active"),
        ]
        assert r.passes[0].collected_at is not None              # collected pass kept as-is
        assert r.card_number == card_b.card_number               # legacy fields -> usable pass
        assert r.status == "active"
    _run(body)


def test_repeated_requests_create_nothing_new_and_change_no_tokens():
    async def body(maker):
        user = await _customer(maker, 1)
        await _food_card(maker, user)
        await _food_card(maker, user)

        first = await _open_pass(maker, user)
        for _ in range(3):
            again = await _open_pass(maker, user)
            await _run_backfill(maker)
            assert [(p.qr_token, p.collection_pin) for p in again.passes] == \
                   [(p.qr_token, p.collection_pin) for p in first.passes]
        assert await _count(maker) == 2
    _run(body)


def test_incomplete_card_gets_no_pass_and_customers_are_isolated():
    async def body(maker):
        alice = await _customer(maker, 1)
        bob = await _customer(maker, 2)
        await _food_card(maker, alice, days=100)                 # not completed
        bob_card = await _food_card(maker, bob)

        r_alice = await _open_pass(maker, alice)
        assert r_alice.has_entitlement is False and r_alice.passes == []

        await _run_backfill(maker)
        r_bob = await _open_pass(maker, bob)
        assert [p.card_number for p in r_bob.passes] == [bob_card.card_number]
        assert (await _open_pass(maker, alice)).passes == []
        assert await _count(maker) == 1
    _run(body)


def test_concurrent_opens_and_backfills_never_fail_or_duplicate():
    async def body(maker):
        user = await _customer(maker, 1)
        for _ in range(12):
            card = await _food_card(maker, user)                 # a brand-new card to race on
            results = await asyncio.gather(
                _open_pass(maker, user), _open_pass(maker, user),
                _run_backfill(maker), _run_backfill(maker),
                return_exceptions=True,
            )
            errors = [r for r in results if isinstance(r, Exception)]
            assert not errors, f"request failed during the race: {errors[0]!r}"
            assert await _count(maker, card_id=card.id) == 1     # exactly one pass per card
        assert await _count(maker, customer_id=user.id) == 12
    _run(body)


def test_previous_year_pass_is_left_alone_and_does_not_crash():
    async def body(maker):
        user = await _customer(maker, 1)
        card = await _food_card(maker, user)
        async with maker() as db:
            db.add(FoodEntitlement(
                card_id=card.id, customer_id=user.id, qr_token="MKF_old", collection_pin="1234",
                package_name="Standard Holiday Food Package", year=2025, status=EntitlementStatus.USED,
            ))
            await db.commit()

        r = await _open_pass(maker, user)                        # must not raise on UNIQUE(card_id)
        assert r.has_entitlement is False                        # nothing for THIS year
        await _run_backfill(maker)
        assert await _count(maker) == 1                          # no second row invented
    _run(body)
