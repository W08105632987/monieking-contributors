from typing import Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit import AuditLog
import uuid


async def log_action(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: str,
    old_value: Optional[dict] = None,
    new_value: Optional[dict] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """
    Append an immutable audit log entry.
    Called after every significant state change.
    """
    entry = AuditLog(
        actor_id=    actor_id,
        action=      action,
        entity_type= entity_type,
        entity_id=   str(entity_id),
        old_value=   old_value,
        new_value=   new_value,
        ip_address=  ip_address,
        user_agent=  user_agent,
    )
    db.add(entry)
    # Flush but don't commit — caller owns the transaction
    await db.flush()
