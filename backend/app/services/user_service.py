"""Shared helpers for resolving a user from either its UUID or its
public-facing customer_number."""
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User


async def resolve_user(db: AsyncSession, user_ref: str) -> User | None:
    """
    Look a user up by its real UUID `id`, OR by its short public
    `customer_number` (e.g. "1024"). Routes take whichever string
    arrives in the URL/query param — the frontend now links to
    customers by customer_number, but this keeps the same routes
    working for any caller still passing the UUID.
    """
    try:
        user_id = uuid.UUID(user_ref)
    except ValueError:
        user_id = None

    if user_id is not None:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    try:
        number = int(user_ref)
    except ValueError:
        return None

    result = await db.execute(select(User).where(User.customer_number == number))
    return result.scalar_one_or_none()
