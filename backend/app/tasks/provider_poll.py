"""Check open Techhub tickets and finish the jobs they belong to (see provider/service.py)."""
import asyncio

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal


async def _run() -> dict:
    from app.provider.service import poll_open_tickets
    async with AsyncSessionLocal() as db:
        return await poll_open_tickets(db)


@celery_app.task(name="app.tasks.provider_poll.poll_provider_tickets")
def poll_provider_tickets():
    return asyncio.run(_run())
