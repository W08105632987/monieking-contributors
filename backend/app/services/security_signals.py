"""
Fraud and abuse signals. Hot paths call record_soon(...) with a one-line description of what just happened; this counts
repeats in Redis and, once the count reaches `threshold` inside `window_s`, raises an alert through alert_service (email,
and SMS if critical). Fire-and-forget: it can never slow down or break the request that reported the signal.

  threshold=1   alert on the FIRST occurrence ("even the slightest" suspicious event)
  each_event    every occurrence is its own alert (use for money events, where every single one matters)
"""
from __future__ import annotations

import asyncio
import logging

from app.services.alert_service import raise_alert

logger = logging.getLogger("monieking.signals")


async def record(kind: str, subject: str = "*", *, title: str, detail: dict | None = None, severity: str = "warning",
                 category: str = "security", threshold: int = 1, window_s: int = 600, each_event: bool = False) -> int:
    count = 1
    if not each_event and threshold > 1:
        try:
            from app.core.redis_client import get_redis
            r = get_redis()
            key = f"sig:{kind}:{subject}"
            count = int(await r.incr(key))
            if count == 1:
                await r.expire(key, window_s)
        except Exception:  # noqa: BLE001
            count = threshold          # Redis is down: better one extra alert than a missed one
    if count < threshold:
        return count
    await raise_alert(
        severity=severity, category=category, title=title,
        detail={**(detail or {}), **({"times_in_window": count, "window_seconds": window_s} if threshold > 1 else {})},
        dedupe_key=None if each_event else f"sig:{kind}:{subject}", notify="auto")
    return count


def record_soon(kind: str, subject: str = "*", **kwargs) -> None:
    try:
        asyncio.get_running_loop().create_task(record(kind, subject, **kwargs))
    except RuntimeError:
        pass
