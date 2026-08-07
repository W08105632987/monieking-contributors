"""
Idempotency guard for endpoints where a duplicate submission (double-tap,
a client retry after a timed-out-but-actually-successful request, a flaky
connection) would create a real duplicate contribution or withdrawal —
not just an annoying repeated toast, an actual second debit.

This is a SECOND layer of defense, not the primary one. The primary
defense against real concurrent double-spending is the row-level
`.with_for_update()` locking already in card_service.py and
wallet_service.py — that's what makes the money correct even under true
concurrency. This layer's job is narrower: recognize "this exact
submission was already handled" and hand back the same result instead of
re-running the mutation a second time, including for a *sequential*
retry (not just simultaneous requests) that arrives after the first one
already completed.

Like the rate limiter, this fails OPEN if Redis is unreachable — a
Redis hiccup should never be the reason someone can't contribute or
withdraw. Losing idempotency protection temporarily means, worst case,
a genuine duplicate-tap creates two records instead of being caught here
— annoying and reviewable, not a security hole, since the row locks
still keep balances correct either way.
"""
import json
import logging
from typing import Any

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

RESULT_TTL_SECONDS = 24 * 60 * 60   # a retried request a day later is a new action, not a duplicate
IN_PROGRESS_TTL_SECONDS = 30        # generous, but bounded — a crashed request shouldn't wedge this key forever


class DuplicateInProgress(Exception):
    """Raised when the exact same idempotency key is already being
    processed by another in-flight request right now."""


async def claim_idempotency_key(redis: aioredis.Redis, user_id: str, key: str | None) -> dict[str, Any] | None:
    """
    Call at the START of a protected route.
    Returns a cached response dict to hand straight back if this exact
    action already completed. Returns None if this is a fresh action —
    the caller should proceed normally and call store_result() when done.
    Raises DuplicateInProgress if this exact key is mid-flight elsewhere
    right now (a truly simultaneous duplicate, not a sequential retry).
    """
    if not key:
        return None
    cache_key = f"idem:{user_id}:{key}"
    try:
        claimed = await redis.set(cache_key, "IN_PROGRESS", nx=True, ex=IN_PROGRESS_TTL_SECONDS)
        if claimed:
            return None  # fresh — proceed
        existing = await redis.get(cache_key)
        if existing == "IN_PROGRESS":
            raise DuplicateInProgress()
        return json.loads(existing) if existing else None
    except DuplicateInProgress:
        raise
    except Exception:
        logger.warning("Idempotency check failed (Redis unreachable?) — proceeding without it", exc_info=True)
        return None


async def store_result(redis: aioredis.Redis, user_id: str, key: str | None, result: dict[str, Any]) -> None:
    """Call after a successful mutation to cache the result for any
    later retry with the same key."""
    if not key:
        return
    cache_key = f"idem:{user_id}:{key}"
    try:
        await redis.set(cache_key, json.dumps(result, default=str), ex=RESULT_TTL_SECONDS)
    except Exception:
        logger.warning("Failed to store idempotency result (Redis unreachable?)", exc_info=True)


async def release_key(redis: aioredis.Redis, user_id: str, key: str | None) -> None:
    """Call after a FAILED mutation (validation error, insufficient
    funds, etc.) so a legitimate retry with the same key isn't
    permanently blocked by a stale IN_PROGRESS marker — only a
    successful completion should ever be cached and replayed."""
    if not key:
        return
    cache_key = f"idem:{user_id}:{key}"
    try:
        await redis.delete(cache_key)
    except Exception:
        pass
