"""Officers act only for customers of THEIR zone; other roles never read identity records (finding S-17)."""
import os
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="needs TEST_DATABASE_URL (a throwaway Postgres)")


@pytest_asyncio.fixture
async def world():
    from app.core.database import Base
    import app.main  # noqa: F401
    from app.models.user import User
    from app.models.zone import Zone
    eng = create_async_engine(URL)
    async with eng.begin() as c:
        await c.execute(text("DROP SCHEMA public CASCADE"))
        await c.execute(text("CREATE SCHEMA public"))
        await c.execute(text("CREATE SEQUENCE customer_number_seq"))
        await c.execute(text("CREATE SEQUENCE card_number_seq"))
        await c.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        z1, z2 = Zone(id=uuid.uuid4(), name="Z1"), Zone(id=uuid.uuid4(), name="Z2")
        db.add_all([z1, z2])
        await db.flush()

        def mk(name, phone, role, zone=None):
            return User(id=uuid.uuid4(), full_name=name, phone_number=phone, role=role, status="active", zone_id=zone)
        w = dict(
            officer1=mk("Officer One", "08010000001", "officer", z1.id),
            officer2=mk("Officer Two", "08010000002", "officer", z2.id),
            nozone=mk("Officer NoZone", "08010000003", "officer"),
            cust1=mk("Cust In Zone1", "08020000001", "customer", z1.id),
            cust2=mk("Cust In Zone2", "08020000002", "customer", z2.id),
            worker=mk("A Worker", "08030000001", "service_worker"),
            director=mk("Director", "08040000001", "director"),
        )
        db.add_all(w.values())
        await db.commit()
        w["db"] = db
        yield w
    await eng.dispose()


async def status_of(coro):
    try:
        await coro
        return 200
    except HTTPException as e:
        return e.status_code


@pytest.mark.asyncio
async def test_officer_may_act_only_for_own_zone(world):
    from app.core.access import require_officer_zone_for as chk
    db = world["db"]
    assert await status_of(chk(db, world["officer1"], world["cust1"].id)) == 200
    assert await status_of(chk(db, world["officer1"], world["cust2"].id)) == 403   # another zone's customer
    assert await status_of(chk(db, world["nozone"], world["cust1"].id)) == 403    # officer with no zone
    assert await status_of(chk(db, world["officer1"], uuid.uuid4())) == 403       # no such customer
    assert await status_of(chk(db, world["officer1"], world["officer2"].id)) == 403   # not a customer at all


@pytest.mark.asyncio
async def test_who_may_read_a_customers_records(world):
    from app.core.access import require_can_view_customer_data as can
    db, c1 = world["db"], world["cust1"].id
    assert await status_of(can(db, world["cust1"], c1)) == 200            # themselves
    assert await status_of(can(db, world["cust2"], c1)) == 403            # another customer
    assert await status_of(can(db, world["officer1"], c1)) == 200         # officer of that zone
    assert await status_of(can(db, world["officer2"], c1)) == 403         # officer of another zone
    assert await status_of(can(db, world["worker"], c1)) == 403           # service worker: never
    assert await status_of(can(db, world["director"], c1)) == 200


@pytest.mark.asyncio
async def test_identity_history_endpoint_refuses_a_service_worker_over_http(world):
    """Same rule through the real endpoint: GET /identity-services/requests?customer_id=<someone else>."""
    import httpx
    from app.core.database import get_db
    from app.core.dependencies import get_current_user
    from app.main import app
    db = world["db"]

    async def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    try:
        for who, expected in (("worker", 403), ("officer2", 403), ("officer1", 200), ("director", 200)):
            app.dependency_overrides[get_current_user] = (lambda u=world[who]: u)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
                r = await c.get("/api/v1/identity-services/requests", params={"customer_id": str(world["cust1"].id)})
            assert r.status_code == expected, (who, r.status_code, r.text[:200])
    finally:
        app.dependency_overrides.clear()
