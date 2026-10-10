"""Append-only audit trail for cooperative decisions (table coop_events, immutable)."""
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.coop.models import CoopEvent


async def record(db: AsyncSession, entity: str, entity_id, action: str, actor_id: uuid.UUID | None = None, data: dict | None = None) -> None:
    db.add(CoopEvent(entity=entity, entity_id=str(entity_id) if entity_id is not None else None,
                     action=action, actor_id=actor_id, data=data or {}))
