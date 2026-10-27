"""Record one provider call we can't count from another table (e.g. an SMS sent). Never raises, never blocks the caller for long."""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def record_usage(rate_key: str, quantity: int = 1, ok: bool = True) -> None:
    try:
        from app.core.database import AsyncSessionLocal
        from app.models.accounting import ProviderUsage

        async def _go():
            async with AsyncSessionLocal() as s:
                s.add(ProviderUsage(rate_key=rate_key, quantity=max(1, int(quantity)), ok=ok))
                await s.commit()
        await asyncio.wait_for(_go(), timeout=3)
    except Exception as e:  # accounting must never break the real work
        logger.warning("usage log failed for %s: %s", rate_key, e)
