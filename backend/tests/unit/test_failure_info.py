import asyncio
import os
import types
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")
from app.services import receipt_service as rs


class FakeDB:
    def __init__(self, row): self.row = row
    async def get(self, model, key): return self.row


def tx(kind):
    return types.SimpleNamespace(related_entity_type=kind, related_entity_id=uuid.uuid4(), category="charge")


def run(kind, row):
    return asyncio.run(rs.failure_info(FakeDB(row), tx(kind)))


def test_bill_failure_reason_and_fallback():
    r = run("bill_payment", types.SimpleNamespace(status="failed", failure_reason="Meter number not found"))
    assert r == {"failed": True, "failure_reason": "Meter number not found"}
    r = run("bill_payment", types.SimpleNamespace(status="failed", failure_reason=None))
    assert r["failed"] and "returned to your wallet" in r["failure_reason"]
    assert run("bill_payment", types.SimpleNamespace(status="completed", failure_reason=None))["failed"] is False


def test_service_worker_reason_and_internal_noise_hidden():
    r = run("manual_service_request", types.SimpleNamespace(status="failed", worker_remarks="NIN does not match the photo", worker_response=None))
    assert r["failure_reason"] == "NIN does not match the photo"
    r = run("identity_service", types.SimpleNamespace(status="failed", failure_reason="Traceback (most recent call last)"))
    assert "could not be completed" in r["failure_reason"]
    r = run("withdrawal", types.SimpleNamespace(status="rejected", rejection_reason="Account name mismatch"))
    assert r["failure_reason"] == "Account name mismatch"
