"""Regression tests for the dispute SLA auto-escalation sweep and for the
CORS-aware global 500 handler.

Background
----------
sweep_dispute_sla() runs at the top of GET /disputes. The previous version
crashed on the first overdue dispute (unknown `sender_role` kwarg, NOT NULL
sender_id / actor_id, log_action has no `details` param), and because
500 responses bypass CORSMiddleware, the browser reported that crash as a
CORS error on the "My Disputes" page.

Tests:
  1. Overdue disputes are escalated and every director is notified
  2. A failure inside the sweep never reaches the caller (the original bug)
  3. The 2-minute debounce skips a second run; force=True bypasses it
  4. Nothing overdue is a clean no-op
  5. A 500 from any route still carries CORS headers for allowed origins
  6. A 500 never carries CORS headers for an origin that isn't allowed

No database is needed: the sweep runs against an in-memory fake session.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import app.services.dispute_sla_sweep as sweep
from app.models.dispute import (
    Dispute, DisputeEntityType, DisputeReason, DisputeStatus,
)


# ── In-memory fake AsyncSession ─────────────────────────────────────────────

class _FakeScalars:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _FakeScalars(self._items)


class _FakeSavepoint:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        self.db.savepoints_opened += 1
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if exc_type is not None:
            self.db.savepoints_rolled_back += 1
        return False  # a real savepoint never swallows the exception


class _FakeDB:
    def __init__(self, disputes=(), director_ids=()):
        self._disputes = list(disputes)
        self._director_ids = list(director_ids)
        self.savepoints_opened = 0
        self.savepoints_rolled_back = 0

    def begin_nested(self):
        return _FakeSavepoint(self)

    async def scalars(self, stmt):
        return _FakeScalars(self._disputes)

    async def execute(self, stmt):
        return _FakeResult(self._director_ids)

    async def flush(self):
        pass


def _overdue_dispute(assigned_to):
    return Dispute(
        id=uuid.uuid4(),
        raised_by=uuid.uuid4(),
        entity_type=DisputeEntityType.WITHDRAWAL,
        entity_id=uuid.uuid4(),
        reason=DisputeReason.OTHER,
        status=DisputeStatus.OPEN,
        assigned_to=assigned_to,
        is_escalated=False,
        created_at=datetime.now(timezone.utc) - timedelta(hours=72),
    )


@pytest.fixture
def notified(monkeypatch):
    """Stubs out notifications + SLA lookup and resets the debounce clock."""
    sent = []

    async def fake_notify(db, **kwargs):
        sent.append(kwargs)

    async def fake_sla_hours(db):
        return 48

    monkeypatch.setattr(sweep, "send_notification", fake_notify)
    monkeypatch.setattr(sweep, "get_dispute_sla_hours", fake_sla_hours)
    monkeypatch.setattr(sweep, "_last_sweep_time", 0.0)
    return sent


# ── Sweep behaviour ─────────────────────────────────────────────────────────

def test_overdue_disputes_are_escalated_and_directors_notified(notified):
    d1, d2 = _overdue_dispute(uuid.uuid4()), _overdue_dispute(None)
    db = _FakeDB([d1, d2], [uuid.uuid4(), uuid.uuid4()])

    count = asyncio.run(sweep.sweep_dispute_sla(db))

    assert count == 2
    for d in (d1, d2):
        assert d.status == DisputeStatus.ESCALATED
        assert d.is_escalated is True
        assert d.assigned_to is None          # back in the open director queue
        assert d.escalated_at is not None
        assert "48 hours" in d.escalation_reason
    assert len(notified) == 4                 # 2 disputes x 2 directors
    assert db.savepoints_opened == 1


def test_sweep_failure_never_reaches_the_caller(notified, monkeypatch):
    """The original bug: an exception in the sweep became a 500 on GET /disputes."""
    async def boom(db):
        raise RuntimeError("simulated failure inside the sweep")

    monkeypatch.setattr(sweep, "_run_sweep", boom)
    db = _FakeDB()

    count = asyncio.run(sweep.sweep_dispute_sla(db, force=True))   # must not raise

    assert count == 0
    assert db.savepoints_rolled_back == 1     # only the sweep's own writes undone


def test_debounce_skips_second_run_and_force_bypasses_it(notified):
    db = _FakeDB([_overdue_dispute(None)], [uuid.uuid4()])

    asyncio.run(sweep.sweep_dispute_sla(db))
    assert db.savepoints_opened == 1

    assert asyncio.run(sweep.sweep_dispute_sla(db)) == 0     # inside the 120s window
    assert db.savepoints_opened == 1                          # did not run again

    asyncio.run(sweep.sweep_dispute_sla(db, force=True))
    assert db.savepoints_opened == 2                          # force=True ran it


def test_nothing_overdue_is_a_clean_noop(notified):
    db = _FakeDB([], [uuid.uuid4()])

    assert asyncio.run(sweep.sweep_dispute_sla(db, force=True)) == 0
    assert notified == []


# ── Global 500 handler carries CORS headers ─────────────────────────────────

@pytest.fixture
def client_with_boom_route():
    from fastapi.testclient import TestClient
    from app.main import app

    async def boom():
        raise RuntimeError("secret internal detail")

    app.add_api_route("/__test_boom__", boom, methods=["GET"])
    route = app.router.routes[-1]
    try:
        # raise_server_exceptions=False: behave like a real browser/client and
        # receive the 500 response instead of having the exception re-raised.
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.router.routes.remove(route)


def test_500_carries_cors_headers_for_allowed_origin(client_with_boom_route):
    from app.core.config import settings
    origin = settings.cors_origins_list[0]

    resp = client_with_boom_route.get("/__test_boom__", headers={"Origin": origin})

    assert resp.status_code == 500
    assert resp.headers.get("access-control-allow-origin") == origin
    assert resp.headers.get("access-control-allow-credentials") == "true"
    assert resp.json() == {"detail": "Internal server error"}
    assert "secret internal detail" not in resp.text      # still leaks nothing


def test_500_has_no_cors_headers_for_unlisted_origin(client_with_boom_route):
    resp = client_with_boom_route.get(
        "/__test_boom__", headers={"Origin": "https://evil.example.com"}
    )

    assert resp.status_code == 500
    assert "access-control-allow-origin" not in resp.headers
