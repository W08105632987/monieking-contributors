import asyncio
import uuid
from types import SimpleNamespace

from app.services import job_pool_service as jp


class _Db:
    def __init__(self, worker): self.worker = worker
    async def get(self, model, pk): return self.worker


def _worker(kind, balance=0):
    return SimpleNamespace(worker_type=kind, commission_balance_kobo=balance, commission_debt_kobo=0)


def test_company_worker_is_detected():
    assert asyncio.run(jp.is_company_worker(_Db(_worker("company")), uuid.uuid4())) is True
    assert asyncio.run(jp.is_company_worker(_Db(_worker("affiliated")), uuid.uuid4())) is False
    assert asyncio.run(jp.is_company_worker(_Db(_worker(None)), uuid.uuid4())) is False   # old rows count as affiliated
    assert asyncio.run(jp.is_company_worker(_Db(None), None)) is False


def test_company_worker_is_never_credited_a_commission():
    w = _worker("company")
    asyncio.run(jp.credit_worker_commission(_Db(w), uuid.uuid4(), 5000))
    assert w.commission_balance_kobo == 0


def test_affiliated_worker_is_credited():
    w = _worker("affiliated")
    asyncio.run(jp.credit_worker_commission(_Db(w), uuid.uuid4(), 5000))
    assert w.commission_balance_kobo == 5000


def test_company_job_has_zero_commission_and_is_tagged():
    job = SimpleNamespace(claimed_by_id=uuid.uuid4(), price_kobo=100000, worker_type=None)
    assert asyncio.run(jp.compute_commission(_Db(_worker("company")), job)) == 0
    assert job.worker_type == "company"


def test_payout_refused_for_company_worker():
    import pytest
    with pytest.raises(ValueError):
        asyncio.run(jp.request_payout(_Db(_worker("company", 9999)), uuid.uuid4(), 100, "1", "n", "b"))


def test_dispute_list_scope_param_exists():
    import inspect
    from app.api.v1.routes import disputes
    assert "scope" in inspect.signature(disputes.list_disputes).parameters
