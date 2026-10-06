"""Unit tests for how GET /food-collections/me builds its response.

Business rule: a customer may hold more than one food card, and every
completed food card is its own independent entitlement (its own QR token and
PIN). The old endpoint assumed one entitlement per customer, so the moment a
second card completed it crashed with MultipleResultsFound -> HTTP 500.

Tests (pure logic, no database):
  1. No entitlements -> has_entitlement False, empty passes
  2. One entitlement -> one pass, legacy single-pass fields filled in
  3. Two entitlements -> two passes, each with its own QR token and PIN
  4. Legacy fields point at the first UNCOLLECTED pass, even if a collected
     one comes first (this is the real production shape: card 1015 collected,
     card 1019 new)
  5. Everything collected -> legacy fields fall back to the first pass
"""
import os
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/x")

from app.api.v1.routes.food_collections import build_entitlement_response
from app.models.food_entitlement import EntitlementStatus


def _ent(card_number, status=EntitlementStatus.ACTIVE, collected_at=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        card_id=uuid.uuid4(),
        card=SimpleNamespace(card_number=card_number),
        qr_token=f"MKF_token_{card_number}",
        collection_pin=f"{card_number % 10000:04d}",
        package_name="Standard Holiday Food Package",
        status=status,
        collected_at=collected_at,
    )


def test_no_entitlements():
    r = build_entitlement_response([])
    assert r.has_entitlement is False
    assert r.passes == []
    assert r.qr_token is None


def test_single_entitlement():
    r = build_entitlement_response([_ent(1015)])
    assert r.has_entitlement is True
    assert len(r.passes) == 1
    assert r.passes[0].card_number == 1015
    assert r.qr_token == "MKF_token_1015"        # legacy field still filled in
    assert r.card_number == 1015


def test_two_cards_give_two_independent_passes():
    r = build_entitlement_response([_ent(1015), _ent(1019)])
    assert [p.card_number for p in r.passes] == [1015, 1019]
    assert len({p.qr_token for p in r.passes}) == 2
    assert len({p.entitlement_id for p in r.passes}) == 2
    assert len({p.card_id for p in r.passes}) == 2


def test_legacy_fields_prefer_the_first_uncollected_pass():
    collected = _ent(1015, EntitlementStatus.USED, datetime(2026, 9, 29, tzinfo=timezone.utc))
    fresh = _ent(1019)
    r = build_entitlement_response([collected, fresh])

    assert [p.status for p in r.passes] == ["used", "active"]
    assert r.passes[0].collected_at is not None           # collected pass is kept, not hidden
    assert r.card_number == 1019                          # legacy fields -> the usable pass
    assert r.qr_token == "MKF_token_1019"
    assert r.status == "active"


def test_all_collected_falls_back_to_first_pass():
    when = datetime(2026, 9, 29, tzinfo=timezone.utc)
    r = build_entitlement_response([
        _ent(1015, EntitlementStatus.USED, when),
        _ent(1019, EntitlementStatus.USED, when),
    ])
    assert len(r.passes) == 2
    assert r.card_number == 1015
    assert r.status == "used"
