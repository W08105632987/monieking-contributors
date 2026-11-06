"""Settle PENDING bill payments in the background (see services/bill_payment_service.sweep_pending_bills)."""
import asyncio

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal


async def _run() -> dict:
    from app.services.bill_payment_service import sweep_pending_bills
    async with AsyncSessionLocal() as db:
        return await sweep_pending_bills(db)


@celery_app.task(name="app.tasks.bill_resolver.sweep_pending_bills")
def sweep_pending_bills():
    return asyncio.run(_run())
