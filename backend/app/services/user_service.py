"""Shared helpers for resolving a user from either its UUID or its
public-facing customer_number, and for building the API-facing
UserResponse (which needs one field patched in after the fact — see
build_user_response below)."""
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User
from app.models.zone import Zone
from app.schemas.user import UserResponse


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


async def build_user_response(db: AsyncSession, user: User) -> UserResponse:
    """
    BUG FIX (officer-portal zone badge showing blank until refresh): every
    endpoint that returns a UserResponse needs zone_name filled in, but
    zone_name isn't a real column on User — it only exists as a
    relationship to Zone. `UserResponse.model_validate(user)` alone
    always serializes it as null, since Pydantic's from_attributes can't
    get a non-existent attribute off the ORM object, and just falls back
    to the field's None default instead of raising.

    /users/me already had a correct, independent workaround for exactly
    this (look up the Zone by zone_id after the fact, since lazy-loading
    the relationship on current_user inside an async endpoint is its own
    footgun) — but /auth/login and /auth/refresh both skipped it and
    just `return user`-ed the raw ORM object. That's why the badge
    looked right after a refresh (which calls /users/me) but showed a
    blank label right after logging in (which only had /auth/login's
    zone_name=null response to go on): two different code paths for
    "build a UserResponse", only one of which was ever fixed. This is
    that same fix, shared, so it can't drift out of sync between the
    three call sites again.
    """
    response = UserResponse.model_validate(user)
    if user.zone_id:
        zone = await db.get(Zone, user.zone_id)
        response.zone_name = zone.name if zone else None
    return response


async def build_user_responses(db: AsyncSession, users: list[User]) -> list[UserResponse]:
    """Batch version of build_user_response, for list endpoints
    (GET /users) — one query for every distinct zone_id involved
    instead of one per row, so a paginated officer/customer list doesn't
    turn into an N+1 the way a naive per-row build_user_response call
    would."""
    zone_ids = {u.zone_id for u in users if u.zone_id}
    zones_by_id: dict = {}
    if zone_ids:
        result = await db.execute(select(Zone).where(Zone.id.in_(zone_ids)))
        zones_by_id = {z.id: z for z in result.scalars().all()}

    responses = []
    for u in users:
        response = UserResponse.model_validate(u)
        if u.zone_id:
            zone = zones_by_id.get(u.zone_id)
            response.zone_name = zone.name if zone else None
        responses.append(response)
    return responses
