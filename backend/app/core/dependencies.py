import json
import uuid as uuid_module
from datetime import datetime, date
from typing import Annotated
from fastapi import Depends, HTTPException, status, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import verify_supabase_jwt
from app.core.cookies import get_access_cookie
from app.core.redis_client import get_redis
from app.models.user import User, UserRole, UserStatus, LocationConsentStatus


# Columns whose Python-side type is an enum, not a plain str — these need
# explicit reconstruction on cache read. Everything else on User happens to
# be a str subclass (UserRole/UserStatus/LocationConsentStatus are all
# `str, enum.Enum`), so plain string comparisons like
# `current_user.role == "officer"` would still work even without this, but
# `.value` access (used in dependencies.py's own require_role check) needs
# a real enum instance, not a bare string.
_ENUM_COLUMNS: dict[str, type] = {
    "role": UserRole,
    "status": UserStatus,
    "location_consent_status": LocationConsentStatus,
}

# Datetime-typed columns — stored as ISO strings in Redis (JSON has no
# native datetime type), so they need explicit reconstruction on read,
# same reasoning as UUIDs. This one had a sharper edge than the UUID bug:
# two of these (login_locked_until, withdrawal_password_locked_until) are
# compared with `<`/`>` in lockout-check code, and Python raises a hard
# TypeError comparing a datetime to a string rather than silently
# misbehaving — so this bug would have crashed those specific requests
# outright rather than corrupting them quietly. webauthn_challenge_expires_at
# is excluded here because it's excluded from the cache entirely (see
# _CACHE_EXCLUDE) — nothing to reconstruct.
_DATETIME_COLUMNS = {
    "created_at", "updated_at", "kyc_completed_at",
    "withdrawal_password_locked_until", "login_locked_until",
    "login_password_reset_otp_expires_at", "last_contacted_at",
    "two_factor_otp_expires_at", "terms_accepted_at",
}
# UUID-typed columns — MUST be reconstructed as real uuid.UUID objects on
# read, not left as the plain strings _serialize_user stores them as.
# This bit me for real: uuid.UUID("x") != "x" is ALWAYS True in Python (a
# UUID never equals a plain string, regardless of value), so leaving
# current_user.id as a string meant every `card.owner_id != current_user.id`
# -style check silently returned "not yours" for a genuinely-owned card,
# but only on a cache HIT — a fresh DB read returns a real UUID and worked
# fine, which is exactly why this looked intermittent rather than broken
# outright. Listed explicitly rather than type-sniffed, since guessing
# "this string looks like a UUID" is exactly the kind of implicit magic
# that caused the bug in the first place.
_UUID_COLUMNS = {"id", "zone_id", "created_by", "managing_officer_id"}


# Fields deliberately excluded from the cache: password/OTP hashes (no
# reason to duplicate secrets into a second store) and webauthn challenge
# state (short-lived, mutated mid-flow — caching it risks serving a stale
# challenge). Every other column is safe: current_user is read-only when
# served from cache (see get_current_user below) — any endpoint that
# mutates current_user directly fetches its own session-attached copy
# first, so a cached instance never needs to support being written to.
_CACHE_EXCLUDE = {"login_password_hash", "withdrawal_password_hash", "webauthn_challenge", "webauthn_challenge_expires_at"}
_USER_CACHE_TTL_SECONDS = 30   # staleness window: a role/suspension change can take up to this long to take effect app-wide — acceptable for an MVP, not for a "ban this user right now" screen


def _serialize_user(user: User) -> str:
    data = {}
    for col in User.__table__.columns:
        if col.name in _CACHE_EXCLUDE:
            continue
        value = getattr(user, col.name)
        if isinstance(value, (datetime, date)):
            value = value.isoformat()
        elif hasattr(value, "value"):   # enum columns (role, status, etc.)
            value = value.value
        elif not isinstance(value, (str, int, float, bool, type(None))):
            value = str(value)          # uuid.UUID and similar
        data[col.name] = value
    return json.dumps(data)


def _deserialize_user(raw: str) -> User:
    data = json.loads(raw)
    user = User()
    for key, value in data.items():
        if key in _ENUM_COLUMNS and value is not None:
            value = _ENUM_COLUMNS[key](value)
        elif key in _UUID_COLUMNS and value is not None:
            value = uuid_module.UUID(value)
        elif key in _DATETIME_COLUMNS and value is not None:
            value = datetime.fromisoformat(value)
        setattr(user, key, value)
    return user


async def invalidate_user_cache(user_id: str) -> None:
    """Call this anywhere a user row is mutated outside get_current_user's
    own write-through path — status changes (suspension), role changes,
    profile edits — so the change is visible immediately instead of
    waiting out the 30s TTL. Fails silently: a missed invalidation just
    means the change falls back to the normal TTL expiry, never a hard
    failure for the request doing the mutation."""
    try:
        await get_redis().delete(f"user:{user_id}")
    except Exception:
        pass


async def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    # New cookie-based session (see auth.py's /login, /refresh, /logout)
    # takes priority when present. Falls back to the old Authorization
    # header so the frontend can be migrated one flow at a time instead
    # of needing to switch everywhere in the same deploy — remove this
    # fallback once that migration is confirmed complete everywhere.
    token = get_access_cookie(request)

    if not token:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )
        token = authorization.split(" ", 1)[1]

    payload = await verify_supabase_jwt(token)

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    # Every authenticated request was re-fetching this same row from
    # Supabase before doing anything else — visible in the [TIMING] logs
    # as an identical ~600ms "SELECT users..." query on nearly every
    # endpoint, on top of whatever that endpoint's own query cost. That's
    # pure network round-trip to a remote DB, not query cost, so a short
    # cache removes it almost entirely. Redis failures fail OPEN (fall
    # through to the DB) rather than ever blocking a login — same
    # philosophy as idempotency.py's use of Redis elsewhere in this app.
    cache_key = f"user:{user_id}"
    redis = get_redis()
    try:
        cached = await redis.get(cache_key)
    except Exception:
        cached = None

    if cached:
        user = _deserialize_user(cached)
        # Deliberately NOT attached to this request's session — an
        # earlier version of this tried session.merge(user, load=False)
        # to make direct mutations persist safely, but that requires the
        # object to already carry a SQLAlchemy identity key from a prior
        # load, which a hand-built object never has; SQLAlchemy correctly
        # rejects it as "transient" and raises. Real fix: this cached
        # object is READ-ONLY. Every endpoint that mutates current_user
        # directly (see the explicit re-fetch pattern in auth.py/users.py/
        # wallets.py) fetches its own session-attached copy first — cheap,
        # since those are low-frequency write endpoints, not the hot-path
        # reads this cache exists to speed up.
    else:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            try:
                await redis.set(cache_key, _serialize_user(user), ex=_USER_CACHE_TTL_SECONDS)
            except Exception:
                pass   # cache write failing shouldn't fail the request

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="USER_NOT_IN_PLATFORM",
        )

    if user.status == "suspended":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is suspended")

    return user


def require_role(*roles: UserRole):
    async def _checker(current_user: User = Depends(get_current_user)) -> User:
        allowed = [r.value if isinstance(r, UserRole) else str(r) for r in roles]
        user_role = str(current_user.role.value) if hasattr(current_user.role, 'value') else str(current_user.role)
        if user_role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role(s): {', '.join(allowed)}",
            )
        return current_user
    return _checker


# ── Typed dependency aliases ──────────────────────────────────────
CurrentUser       = Annotated[User, Depends(get_current_user)]
CustomerOnly      = Annotated[User, Depends(require_role(UserRole.CUSTOMER))]
OfficerOnly       = Annotated[User, Depends(require_role(UserRole.OFFICER))]
DirectorOnly      = Annotated[User, Depends(require_role(UserRole.DIRECTOR))]
AdminOnly         = Annotated[User, Depends(require_role(UserRole.ADMIN))]
CustomerOrOfficer = Annotated[User, Depends(require_role(UserRole.CUSTOMER, UserRole.OFFICER))]
DirectorOrAdmin   = Annotated[User, Depends(require_role(UserRole.DIRECTOR, UserRole.ADMIN))]