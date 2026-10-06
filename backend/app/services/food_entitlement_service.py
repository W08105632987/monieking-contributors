"""Food entitlement creation — one pass per completed food card.

A customer may hold more than one food card (MAX_FOOD_CARDS_PER_CUSTOMER),
and every completed card is its own independent entitlement with its own QR
token and collection PIN. `food_entitlements.card_id` is UNIQUE, which is the
database-level guarantee of "one entitlement per card".

Entitlements are created from two places that can run at the same moment:
  * the customer opening their food page   (food_collections.py  GET /me)
  * a director loading oversight / closing a year (food_ledger.py backfill)

Both used to do "check, then db.add(...)", which can race: whichever
transaction commits second hits the UNIQUE constraint and the request fails
with a 500. Every insert here is INSERT ... ON CONFLICT DO NOTHING instead, so
losing the race is harmless — the other request's row simply wins.
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import ContributionCard
from app.models.food_entitlement import FoodEntitlement, EntitlementStatus

DEFAULT_PACKAGE_NAME = "Standard Holiday Food Package"


def new_qr_token() -> str:
    return "MKF_" + secrets.token_urlsafe(16)


def new_collection_pin() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(4))


async def create_missing_entitlements(
    db: AsyncSession,
    cards: Iterable[ContributionCard],
    year: int | None = None,
) -> None:
    """Create one ACTIVE entitlement for each given card, skipping any card
    that already has one (including one created concurrently by another
    request). Safe to call with cards that already have entitlements."""
    year = year or datetime.now(timezone.utc).year
    rows = [
        {
            "card_id": card.id,
            "customer_id": card.owner_id,
            "qr_token": new_qr_token(),
            "collection_pin": new_collection_pin(),
            "package_name": DEFAULT_PACKAGE_NAME,
            "year": year,
            "status": EntitlementStatus.ACTIVE,
        }
        for card in cards
    ]
    if not rows:
        return

    stmt = pg_insert(FoodEntitlement.__table__).on_conflict_do_nothing()
    await db.execute(stmt, rows)
    await db.flush()
