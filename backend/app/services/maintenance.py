"""Maintenance switch: directors turn the app off for customers, officers and service workers while they work on it."""
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import SystemConfig

KEYS = ("maintenance_mode", "maintenance_message", "maintenance_eta", "maintenance_started_at")
_TTL = 4.0
_cache: dict = {"at": 0.0, "state": None}
DEFAULT_MESSAGE = "We are making MonieKing better. Your money and records are safe. We will be back shortly."


def invalidate() -> None:
    _cache["at"] = 0.0
    _cache["state"] = None


async def state(db: AsyncSession) -> dict:
    now = time.monotonic()
    if _cache["state"] is not None and now - _cache["at"] < _TTL:
        return _cache["state"]
    rows = {r.key: r.value for r in (await db.execute(select(SystemConfig).where(SystemConfig.key.in_(KEYS)))).scalars().all()}
    s = {"on": rows.get("maintenance_mode") == "true", "message": rows.get("maintenance_message") or DEFAULT_MESSAGE,
         "eta": rows.get("maintenance_eta") or None, "started_at": rows.get("maintenance_started_at") or None}
    _cache["state"], _cache["at"] = s, now
    return s


async def is_on(db: AsyncSession) -> bool:
    return (await state(db))["on"]
