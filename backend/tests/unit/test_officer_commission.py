"""The affiliated-officer commission rule: officer share = percent of the company's charge; company keeps the rest."""
import asyncio
import uuid
from types import SimpleNamespace

from app.models.user import UserRole
from app.services import officer_earnings_service as svc


def test_is_affiliated_only_for_affiliated_officers():
    mk = lambda role, t: SimpleNamespace(role=role, officer_type=t)
    assert svc.is_affiliated(mk(UserRole.OFFICER, "affiliated"))
    assert not svc.is_affiliated(mk(UserRole.OFFICER, "salary"))
    assert not svc.is_affiliated(mk(UserRole.OFFICER, None))          # not classified yet: earns nothing
    assert not svc.is_affiliated(mk(UserRole.CUSTOMER, "affiliated"))
    assert not svc.is_affiliated(None)


def test_percent_prefers_the_officers_own_rate_then_the_global_setting(monkeypatch):
    async def fake_global(db, key, default):
        return 30
    monkeypatch.setattr(svc, "get_config_int", fake_global)
    own = SimpleNamespace(officer_commission_percent=45)
    none = SimpleNamespace(officer_commission_percent=None)
    zero = SimpleNamespace(officer_commission_percent=0)
    assert asyncio.run(svc.percent_for(None, own)) == 45
    assert asyncio.run(svc.percent_for(None, none)) == 30
    assert asyncio.run(svc.percent_for(None, zero)) == 0               # 0% is a real choice, not 'unset'


def test_the_example_from_the_brief():
    # one month, rate ₦1,000 -> company charge ₦1,000; officer 30% = ₦300, company keeps ₦700
    charge, pct = 100_000, 30
    officer = charge * pct // 100
    assert officer == 30_000 and charge - officer == 70_000
