"""Short, safe response cache for heavy read-only director reports.

Why: dashboards run several aggregate queries over big tables. Many directors (or one director on a 30-second auto-refresh)
repeating them is wasted database load, and when a cached value expires every waiting request would recompute it at once
(a cache stampede).

How it avoids that:
  * single-flight: only the request that wins a short Redis lock recomputes; the others wait briefly and reuse its result;
  * jittered TTL: copies of the same report written together do not all expire together;
  * fail open: if Redis is down, the report is simply computed live. Never used for money-moving or per-person data.
"""
import asyncio
import functools
import hashlib
import json
import random
from datetime import date, datetime
from typing import Awaitable, Callable

from fastapi.encoders import jsonable_encoder

from app.core.redis_client import get_redis

_LOCK_SECONDS = 15
_WAIT_STEP = 0.15
_WAIT_MAX = 4.0


async def cached_json(key: str, ttl: int, build: Callable[[], Awaitable]):
    redis = get_redis()
    full = f"rc:{key}"
    try:
        hit = await redis.get(full)
        if hit is not None:
            return json.loads(hit)
    except Exception:  # noqa: BLE001 - fail open
        return jsonable_encoder(await build())

    got_lock = False
    try:
        got_lock = bool(await redis.set(f"{full}:lock", "1", nx=True, ex=_LOCK_SECONDS))
    except Exception:  # noqa: BLE001
        return jsonable_encoder(await build())

    if not got_lock:
        waited = 0.0
        while waited < _WAIT_MAX:
            await asyncio.sleep(_WAIT_STEP)
            waited += _WAIT_STEP
            try:
                hit = await redis.get(full)
            except Exception:  # noqa: BLE001
                break
            if hit is not None:
                return json.loads(hit)
        return jsonable_encoder(await build())      # the leader was too slow or failed: compute for ourselves

    try:
        value = jsonable_encoder(await build())
        try:
            await redis.set(full, json.dumps(value), ex=int(ttl * random.uniform(0.9, 1.15)) or 1)
        except Exception:  # noqa: BLE001
            pass
        return value
    finally:
        try:
            await redis.delete(f"{full}:lock")
        except Exception:  # noqa: BLE001
            pass


def cache_report(ttl: int = 20, name: str | None = None):
    """Decorator for a FastAPI GET handler. The key is the handler name plus its plain query arguments (dates, numbers,
    text, flags). Dependencies (db session, the signed-in director) are not part of the key: every director sees the same report."""
    def deco(fn):
        label = name or fn.__name__

        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            plain = {k: (v.isoformat() if isinstance(v, (date, datetime)) else v) for k, v in kwargs.items()
                     if v is None or isinstance(v, (str, int, float, bool, date, datetime))}
            digest = hashlib.sha1(json.dumps(plain, sort_keys=True, default=str).encode()).hexdigest()[:16]
            return await cached_json(f"{label}:{digest}", ttl, lambda: fn(*args, **kwargs))
        return wrapper
    return deco
