import asyncio

from app.api.v1.routes import kyc as kyc_routes
from app.verification.models import KycLookup


class _Nested:
    def __init__(self, boom): self.boom = boom
    async def __aenter__(self):
        if self.boom: raise RuntimeError("table missing")
    async def __aexit__(self, *a): return False


class _Db:
    def __init__(self, boom=False): self.added, self.boom = [], boom
    def begin_nested(self): return _Nested(self.boom)
    def add(self, row): self.added.append(row)


def test_kyc_lookup_is_recorded_with_tier_and_outcome():
    db = _Db()
    asyncio.run(kyc_routes._record_kyc_lookup(db, tier="regular", outcome="found", user_id=None, source="customer"))
    assert len(db.added) == 1 and isinstance(db.added[0], KycLookup)
    assert (db.added[0].tier, db.added[0].outcome, db.added[0].source) == ("regular", "found", "customer")


def test_a_failure_to_record_never_breaks_kyc():
    asyncio.run(kyc_routes._record_kyc_lookup(_Db(boom=True), tier="regular", outcome="found", user_id=None, source="customer"))
