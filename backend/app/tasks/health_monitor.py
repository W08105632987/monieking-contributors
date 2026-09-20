"""
Runs the system health monitor (see health_service.py) on a schedule —
every 3 minutes by default (celery_app.py). Same asyncio.run()-inside-
a-sync-Celery-task pattern already used in tasks/pricing.py.
"""
import asyncio

from app.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.health_service import run_all_checks


async def _run() -> list[dict]:
    async with AsyncSessionLocal() as db:
        return await run_all_checks(db)


@celery_app.task(name="app.tasks.health_monitor.run_health_checks")
def run_health_checks():
    results = asyncio.run(_run())
    return {r["check_name"]: r["status"] for r in results}
