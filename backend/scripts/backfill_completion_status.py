"""
One-time backfill for the paid/unpaid/partially-paid badge fix.

WHY THIS EXISTS: recompute_card_completion_status() (added in
card_service.py) only runs when a withdrawal is requested, paid, or
rejected — it fixes the bug going forward, but does nothing for cards
that already have withdrawal history sitting in the database from
before the fix existed. Those rows are stuck showing whatever value
they were stuck with (almost always 'unpaid', per the original bug)
until this script runs once, or until another withdrawal happens to
touch that specific card.

Safe to run multiple times — it's a pure recompute from source data
(contribution_records.is_withdrawn), not an increment/decrement, so
running it twice produces the same result as running it once.

Run with:  python -m scripts.backfill_completion_status
"""
import asyncio
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.card import ContributionCard, CardStatus
from app.services.card_service import recompute_card_completion_status


async def backfill():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ContributionCard).where(
                ContributionCard.status.in_([CardStatus.COMPLETED, CardStatus.ARCHIVED])
            )
        )
        cards = result.scalars().all()
        print(f"Found {len(cards)} completed/archived card(s) to recheck.")

        changed = 0
        for card in cards:
            before = card.completion_status
            await recompute_card_completion_status(db, card)
            if card.completion_status != before:
                print(f"  card {card.card_number}: {before} -> {card.completion_status}")
                changed += 1

        await db.commit()
        print(f"Done. {changed} card(s) had their badge corrected.")


if __name__ == "__main__":
    asyncio.run(backfill())
