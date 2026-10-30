"""Page-view events are queued and written in batches; a forged user id must not lose the others (P-04)."""
import asyncio
import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="needs TEST_DATABASE_URL (a throwaway Postgres)")


@pytest_asyncio.fixture
async def schema():
    from app.core.database import Base
    import app.main  # noqa: F401
    eng = create_async_engine(URL)
    async with eng.begin() as c:
        await c.execute(text("DROP SCHEMA public CASCADE"))
        await c.execute(text("CREATE SCHEMA public"))
        await c.execute(text("CREATE SEQUENCE customer_number_seq"))
        await c.execute(text("CREATE SEQUENCE card_number_seq"))
        await c.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.mark.asyncio
async def test_events_are_batched_and_a_forged_user_id_costs_only_itself(schema):
    from app.services import analytics_service as svc
    ok = [svc.enqueue_event(event_type="pageview", path=f"/p/{i}", label=None, session_id=f"s{i}", user_id=None, role=None, referrer=None)
          for i in range(450)]
    bad = svc.enqueue_event(event_type="pageview", path="/forged", label=None, session_id="forged",
                            user_id=uuid.uuid4(), role="customer", referrer=None)   # no such user -> foreign-key error
    assert all(ok) and bad
    for _ in range(40):   # wait for the background writer
        await asyncio.sleep(0.5)
        async with schema.connect() as c:
            n = (await c.execute(text("SELECT count(*) FROM analytics_events"))).scalar_one()
        if n >= 450:
            break
    assert n == 450   # every good event written; only the forged one lost


def test_full_queue_drops_instead_of_blocking():
    from app.services import analytics_service as svc
    q = asyncio.Queue(maxsize=1)
    q.put_nowait({})
    old = svc._queue
    svc._queue = q
    try:
        assert svc.enqueue_event(event_type="pageview", path="/x", label=None, session_id="s", user_id=None, role=None, referrer=None) is False
    finally:
        svc._queue = old
