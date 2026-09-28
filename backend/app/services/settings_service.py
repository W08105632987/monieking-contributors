import time
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.settings import SystemConfig
from app.utils.audit import log_action

# In-process TTL cache for system_config table reads
# Avoids repeated DB queries on high-traffic endpoints (job pool lists, claims, disputes, manual services)
CONFIG_CACHE_TTL_SECONDS = 90.0
_config_cache: dict[str, tuple[str | None, float]] = {}


def invalidate_config_cache(key: str | None = None) -> None:
    """Invalidate a specific key from the cache, or clear the entire cache."""
    global _config_cache
    if key is None:
        _config_cache.clear()
    else:
        _config_cache.pop(key, None)


async def get_config_value(db: AsyncSession, key: str, default: str | None = None) -> str | None:
    now = time.monotonic()
    if key in _config_cache:
        cached_val, expires_at = _config_cache[key]
        if now < expires_at:
            return cached_val if cached_val is not None else default

    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    row = result.scalar_one_or_none()
    val = row.value if row else None
    _config_cache[key] = (val, now + CONFIG_CACHE_TTL_SECONDS)
    return val if val is not None else default


async def get_config_int(db: AsyncSession, key: str, default: int) -> int:
    value = await get_config_value(db, key)
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


async def get_config_float(db: AsyncSession, key: str, default: float) -> float:
    value = await get_config_value(db, key)
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


async def set_config_value(
    db: AsyncSession,
    *,
    key: str,
    value: str,
    updated_by: uuid.UUID,
) -> SystemConfig:
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    row = result.scalar_one_or_none()
    if not row:
        row = SystemConfig(key=key, value=value, updated_by=updated_by)
        db.add(row)
        old_value = None
    else:
        old_value = row.value
        row.value = value
        row.updated_by = updated_by
    await db.flush()

    # Bust the in-process cache immediately upon update
    invalidate_config_cache(key)

    await log_action(
        db,
        actor_id=    updated_by,
        action=      "settings.updated",
        entity_type= "system_config",
        entity_id=   key,
        old_value=   {"value": old_value},
        new_value=   {"value": value},
    )
    return row
