"""Hourly retention sweep for Techhub verification results (see verification/service.py)."""
import asyncio

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal


async def _run() -> dict:
    from app.verification.service import purge_expired
    async with AsyncSessionLocal() as db:
        return await purge_expired(db)


@celery_app.task(name="app.tasks.verification_purge.purge_expired_verifications")
def purge_expired_verifications():
    return asyncio.run(_run())
