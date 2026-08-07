from typing import Annotated
from fastapi import Depends, HTTPException, status, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import verify_supabase_jwt
from app.core.cookies import get_access_cookie
from app.models.user import User, UserRole


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

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

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