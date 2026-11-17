"""Keep the VTU plan list and prices in step with the supplier (see services/bill_payment_service.sync_vtu_plans)."""
import asyncio

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal


async def _run() -> dict:
    from app.integrations.gyk import get_vtu_provider
    from app.services.bill_payment_service import sync_vtu_plans
    if not get_vtu_provider().configured:
        return {"skipped": "not configured"}
    async with AsyncSessionLocal() as db:
        return await sync_vtu_plans(db)


@celery_app.task(name="app.tasks.vtu_sync.sync_vtu_plans")
def sync_vtu_plans():
    return asyncio.run(_run())
