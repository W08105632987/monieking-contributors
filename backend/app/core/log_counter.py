"""
Counts ERROR log lines per minute into Redis, so the monitor can alert when "the logs are getting bad" (an error storm), even
when every individual health check still looks green. Shared through Redis because the web server and the monitor run as
separate processes. Never raises and never slows a request: if Redis is unreachable it switches itself off for a minute.
"""
from __future__ import annotations

import logging
import re
import time

_PREFIX = "logerr:"
_TTL_SECONDS = 20 * 60
_SKIP = ("redis", "monieking.log_counter")
_installed = False


class ErrorCounterHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.ERROR)
        self._client = None
        self._off_until = 0.0

    def _redis(self):
        if self._client is None:
            import redis  # the synchronous client: a logging handler cannot await
            from app.core.config import settings
            self._client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=0.3, socket_timeout=0.3)
        return self._client

    def emit(self, record: logging.LogRecord) -> None:
        if record.name.startswith(_SKIP) or time.monotonic() < self._off_until:
            return
        try:
            minute = int(time.time() // 60)
            sig = re.sub(r"[0-9a-fA-F-]{8,}|\d+", "#", f"{record.name}: {record.getMessage()}")[:90]
            pipe = self._redis().pipeline()
            pipe.incr(f"{_PREFIX}{minute}")
            pipe.expire(f"{_PREFIX}{minute}", _TTL_SECONDS)
            pipe.hincrby(f"{_PREFIX}sig:{minute}", sig, 1)
            pipe.expire(f"{_PREFIX}sig:{minute}", _TTL_SECONDS)
            pipe.execute()
        except Exception:  # noqa: BLE001
            self._off_until = time.monotonic() + 60


def install_error_counter() -> None:
    """Idempotent. Call once per process (web server and Celery worker)."""
    global _installed
    if _installed:
        return
    logging.getLogger().addHandler(ErrorCounterHandler())
    _installed = True


async def recent_errors(minutes: int = 5) -> dict:
    """{'count': N, 'top': [(signature, count), ...]} for the last `minutes`."""
    from app.core.redis_client import get_redis
    r = get_redis()
    now_min = int(time.time() // 60)
    keys = [f"{_PREFIX}{now_min - i}" for i in range(minutes)]
    counts = await r.mget(keys)
    total = sum(int(c) for c in counts if c)
    sigs: dict[str, int] = {}
    for i in range(minutes):
        for sig, n in (await r.hgetall(f"{_PREFIX}sig:{now_min - i}")).items():
            sigs[sig] = sigs.get(sig, 0) + int(n)
    top = sorted(sigs.items(), key=lambda kv: kv[1], reverse=True)[:3]
    return {"count": total, "top": top}
