import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser
from app.models.user import User
from app.models.webauthn_credential import WebAuthnCredential
from app.schemas.webauthn import (
    RegistrationVerifyRequest, CredentialResponse, LoginOptionsRequest,
    LoginVerifyRequest,
)
from app.schemas.user import UserResponse
from app.services.webauthn_service import (
    build_registration_options, verify_registration,
    build_authentication_options, verify_authentication,
)
from app.utils.supabase_auth import generate_session_for_user
from app.core.limiter import limiter
from app.core.cookies import set_session_cookies

router = APIRouter(prefix="/webauthn", tags=["webauthn"])


# ── Enrollment (authenticated — Profile page, all three roles) ─────
@router.post("/register/options")
async def register_options(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    return await build_registration_options(db, current_user)


@router.post("/register/verify", response_model=CredentialResponse, status_code=201)
async def register_verify(
    body: RegistrationVerifyRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    return await verify_registration(db, current_user, body.credential, body.nickname)


@router.get("/credentials", response_model=list[CredentialResponse])
async def list_credentials(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == current_user.id))
    return result.scalars().all()


@router.delete("/credentials/{credential_id}")
async def delete_credential(credential_id: uuid.UUID, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WebAuthnCredential).where(
            WebAuthnCredential.id == credential_id, WebAuthnCredential.user_id == current_user.id
        )
    )
    cred = result.scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    await db.delete(cred)
    await db.flush()
    return {"message": "Removed"}


# ── Passwordless login (unauthenticated — Login page) ──────────────
@router.post("/login/options")
@limiter.limit("10/minute")
async def login_options(request: Request, body: LoginOptionsRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.phone_number == body.phone_number))
    user = result.scalar_one_or_none()
    if not user:
        # Deliberately generic — don't confirm/deny whether this phone has an account
        raise HTTPException(status_code=400, detail="No biometric login available for this number")
    return await build_authentication_options(db, user)


@router.post("/login/verify", response_model=UserResponse)
@limiter.limit("10/minute")
async def login_verify(request: Request, response: Response, body: LoginVerifyRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.phone_number == body.phone_number))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="No biometric login available for this number")

    await verify_authentication(db, user, body.credential)  # raises 401 on failure

    email = f"{user.phone_number}@monieking.app"
    session = await generate_session_for_user(email)
    # Same as /auth/login — the token never goes into the JSON body where
    # JS could read it; it goes straight into an httpOnly cookie.
    set_session_cookies(response, session["access_token"], session.get("refresh_token"))
    return user


# ── Step-up (authenticated — before a withdrawal or other sensitive action) ──
@router.post("/step-up/options")
async def step_up_options(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    return await build_authentication_options(db, current_user)
