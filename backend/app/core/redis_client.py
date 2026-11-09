"""
Shared async Redis client for direct app use (currently: idempotency
guards on money-moving endpoints). Separate from Celery's own Redis
connection and the rate limiter's — this one is for app code that needs
to read/write Redis directly.

Like everywhere else Redis is used in this app, this is explicitly NOT
a source of truth for anything financial — see idempotency.py for how
failures here are handled (fail open, never block a real request).
"""
import asyncio

import redis.asyncio as aioredis

from app.core.config import get_settings

settings = get_settings()

_redis_client: aioredis.Redis | None = None
_redis_loop = None


def get_redis() -> aioredis.Redis:
    """One client per running event loop.

    The API has a single long-lived loop, so it keeps reusing one client. Celery tasks call asyncio.run(), which
    makes a NEW loop every time; a client created on an earlier (now closed) loop raises "Event loop is closed",
    which showed up as false "Redis is degraded" alerts. So when the loop changes we build a fresh client.
    """
    global _redis_client, _redis_loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if _redis_client is None or loop is not _redis_loop:
        _redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        _redis_loop = loop
    return _redis_client
