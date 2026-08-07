"""
Shared async Redis client for direct app use (currently: idempotency
guards on money-moving endpoints). Separate from Celery's own Redis
connection and the rate limiter's — this one is for app code that needs
to read/write Redis directly.

Like everywhere else Redis is used in this app, this is explicitly NOT
a source of truth for anything financial — see idempotency.py for how
failures here are handled (fail open, never block a real request).
"""
import redis.asyncio as aioredis

from app.core.config import get_settings

settings = get_settings()

_redis_client: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client
