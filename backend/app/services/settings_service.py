import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.settings import SystemConfig
from app.utils.audit import log_action


async def get_config_value(db: AsyncSession, key: str, default: str | None = None) -> str | None:
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else default


async def get_config_int(db: AsyncSession, key: str, default: int) -> int:
    value = await get_config_value(db, key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
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
