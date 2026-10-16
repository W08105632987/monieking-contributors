"""Fail and refund manual-service jobs that no worker claimed in time (see services/refund_service.py)."""
import asyncio

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal


async def _run() -> dict:
    from app.services.refund_service import expire_unclaimed_jobs
    async with AsyncSessionLocal() as db:
        return await expire_unclaimed_jobs(db)


@celery_app.task(name="app.tasks.job_expiry.expire_unclaimed_jobs")
def expire_unclaimed_jobs():
    return asyncio.run(_run())
