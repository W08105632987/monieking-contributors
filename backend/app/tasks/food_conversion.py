"""Nightly: convert every unfinished Food Card once the director's completion deadline has passed."""
import asyncio

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal


async def _run() -> dict:
    from app.services.food_conversion_service import convert_overdue
    async with AsyncSessionLocal() as db:
        result = await convert_overdue(db)
        await db.commit()
        return result


@celery_app.task(name="app.tasks.food_conversion.convert_overdue_food_cards")
def convert_overdue_food_cards():
    return asyncio.run(_run())
