"""Optional account email for every role (customer, officer, director, worker): add, verify, remove."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, invalidate_user_cache
from app.core.limiter import limiter
from app.models.user import User
from app.services import email_service as es

router = APIRouter(prefix="/auth/email", tags=["email"])


class EmailBody(BaseModel):
    email: str


class CodeBody(BaseModel):
    code: str


async def _issue(db: AsyncSession, user: User, email: str) -> dict:
    taken = (await db.execute(
        select(User.id).where(func.lower(User.email) == email, User.email_verified_at.is_not(None), User.id != user.id)
    )).first()
    if taken:
        raise HTTPException(status_code=409, detail="That email is already used on another account.")
    code = es.new_code()
    user.pending_email = email
    user.email_code_hash = es.hash_code(code)
    user.email_code_expires_at = es.expiry()
    user.email_code_attempts = 0
    await db.commit()
    await invalidate_user_cache(str(user.id))
    sent = await es.send_verification_code(email, code)
    if not sent:
        return {"message": "We saved your email but could not send the code right now. Tap Resend in a minute.", "sent": False}
    return {"message": f"We sent a 6-digit code to {email}.", "sent": True}


@router.post("/send-code")
@limiter.limit("5/minute")
async def send_code(request: Request, body: EmailBody, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    email = es.normalize_email(body.email)
    if not es.is_valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    user = await db.get(User, current_user.id)
    return await _issue(db, user, email)


@router.post("/resend")
@limiter.limit("3/minute")
async def resend(request: Request, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, current_user.id)
    if not user.pending_email:
        raise HTTPException(status_code=400, detail="There is no email waiting to be verified.")
    return await _issue(db, user, user.pending_email)


@router.post("/verify")
@limiter.limit("10/minute")
async def verify(request: Request, body: CodeBody, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, current_user.id)
    if not user.pending_email or not user.email_code_hash:
        raise HTTPException(status_code=400, detail="There is no email waiting to be verified.")
    if not user.email_code_expires_at or user.email_code_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This code has expired. Tap Resend to get a new one.")
    if user.email_code_attempts >= es.MAX_CODE_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many wrong codes. Tap Resend to get a new one.")
    if not es.check_code((body.code or "").strip(), user.email_code_hash):
        user.email_code_attempts += 1
        await db.commit()
        raise HTTPException(status_code=400, detail="That code is not correct.")
    taken = (await db.execute(
        select(User.id).where(func.lower(User.email) == user.pending_email, User.email_verified_at.is_not(None), User.id != user.id)
    )).first()
    if taken:
        raise HTTPException(status_code=409, detail="That email is already used on another account.")
    user.email = user.pending_email
    user.email_verified_at = datetime.now(timezone.utc)
    user.pending_email = None
    user.email_code_hash = None
    user.email_code_expires_at = None
    user.email_code_attempts = 0
    await db.commit()
    await invalidate_user_cache(str(user.id))
    return {"message": "Email verified.", "email": user.email}


@router.delete("")
async def remove(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, current_user.id)
    user.email = None
    user.email_verified_at = None
    user.pending_email = None
    user.email_code_hash = None
    user.email_code_expires_at = None
    await db.commit()
    await invalidate_user_cache(str(user.id))
    return {"message": "Email removed."}
