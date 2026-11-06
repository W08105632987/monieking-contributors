"""The alert service against a real (in-memory SQLite) database, with email and SMS replaced by recorders."""
import asyncio
from datetime import timedelta

import pytest

pytest.importorskip("aiosqlite", reason="pip install aiosqlite to run the alert service tests")
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.system_alert import SystemAlert
from app.services import alert_service as A


@pytest.fixture()
def env(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def setup():
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: SystemAlert.__table__.create(c))
    asyncio.run(setup())

    sent = {"emails": [], "sms": []}

    async def fake_email(**kw):
        sent["emails"].append(kw)
        return True

    async def fake_sms(phone, text):
        sent["sms"].append((phone, text))
        return True

    async def fake_recipients(db):
        return ["ops@example.com", "cto@example.com"]

    monkeypatch.setattr(A, "AsyncSessionLocal", maker)
    monkeypatch.setattr(A, "send_email", fake_email)
    monkeypatch.setattr(A, "send_sms", fake_sms)
    monkeypatch.setattr(A, "alert_recipients", fake_recipients)
    monkeypatch.setattr(A, "configured_phones", lambda: ["2348000000000"])
    return maker, sent


def rows(maker):
    async def go():
        async with maker() as db:
            return (await db.execute(select(SystemAlert).order_by(SystemAlert.created_at))).scalars().all()
    return asyncio.run(go())


def test_first_alert_is_emailed_once_and_repeats_are_counted_not_resent(env):
    maker, sent = env
    for _ in range(5):
        asyncio.run(A.raise_alert(severity="warning", category="provider", title="Monnify slow", dedupe_key="k1"))
    r = rows(maker)
    assert len(r) == 1 and r[0].occurrences == 5 and r[0].status == "open"
    assert len(sent["emails"]) == 1                                  # one email for five occurrences
    assert sent["emails"][0]["to"] == ["ops@example.com", "cto@example.com"] and sent["emails"][0]["automated"] is True
    assert "<html" in sent["emails"][0]["html"] and "Monnify slow" in sent["emails"][0]["body"]


def test_critical_alert_also_sends_sms_and_warning_does_not(env):
    maker, sent = env
    asyncio.run(A.raise_alert(severity="critical", category="provider", title="Bills API down", dedupe_key="c1"))
    asyncio.run(A.raise_alert(severity="warning", category="provider", title="Slow", dedupe_key="w1"))
    assert len(sent["emails"]) == 2 and len(sent["sms"]) == 1 and "Bills API down" in sent["sms"][0][1]


def test_still_happening_is_mentioned_again_after_the_gap(env):
    maker, sent = env
    asyncio.run(A.raise_alert(severity="critical", category="infra", title="DB down", dedupe_key="d1"))
    async def age():
        async with maker() as db:
            a = (await db.execute(select(SystemAlert))).scalar_one()
            a.emailed_at = a.emailed_at - timedelta(minutes=45)       # past the 30 min critical gap
            await db.commit()
    asyncio.run(age())
    asyncio.run(A.raise_alert(severity="critical", category="infra", title="DB down", dedupe_key="d1"))
    assert len(sent["emails"]) == 2 and "[still happening]" in sent["emails"][1]["subject"]


def test_notify_always_emails_every_time(env):
    maker, sent = env
    for _ in range(3):
        asyncio.run(A.raise_alert(severity="warning", category="health", title="x", dedupe_key="h1", notify="always"))
    assert len(sent["emails"]) == 3 and rows(maker)[0].occurrences == 3


def test_severity_only_escalates(env):
    maker, sent = env
    asyncio.run(A.raise_alert(severity="warning", category="health", title="slow", dedupe_key="e1"))
    asyncio.run(A.raise_alert(severity="critical", category="health", title="down", dedupe_key="e1"))
    asyncio.run(A.raise_alert(severity="warning", category="health", title="slow again", dedupe_key="e1"))
    a = rows(maker)[0]
    assert a.severity == "critical" and a.title == "down"


def test_resolve_sends_recovery_and_a_new_incident_can_follow(env):
    maker, sent = env
    asyncio.run(A.raise_alert(severity="critical", category="infra", title="Redis down", dedupe_key="r1"))
    asyncio.run(A.resolve_alert("r1", note="back"))
    assert rows(maker)[0].status == "resolved" and "[recovered]" in sent["emails"][-1]["subject"]
    asyncio.run(A.raise_alert(severity="critical", category="infra", title="Redis down", dedupe_key="r1"))
    assert len(rows(maker)) == 2                                    # a fresh incident, not a reopened one


def test_resolving_something_nobody_was_told_about_is_silent(env):
    maker, sent = env
    asyncio.run(A.resolve_alert("never-existed"))
    assert sent["emails"] == []


def test_events_without_a_key_are_each_their_own_alert(env):
    maker, sent = env
    for i in range(3):
        asyncio.run(A.raise_alert(severity="warning", category="fraud", title=f"Manual credit {i}"))
    assert len(rows(maker)) == 3 and len(sent["emails"]) == 3


def test_a_broken_database_never_raises_out_of_an_alert(monkeypatch):
    class Boom:
        def __call__(self): raise RuntimeError("db is down")
    monkeypatch.setattr(A, "AsyncSessionLocal", Boom())
    asyncio.run(A.raise_alert(severity="critical", category="infra", title="whatever", dedupe_key="b1"))   # must not raise
