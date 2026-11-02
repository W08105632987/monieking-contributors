"""WhatsApp community gate + the global "Contact support" details.

Customers must tap "Join" once before they see their dashboard. The tap is confirmed by the SERVER
(`whatsapp_joined_at`), never by the browser, so a network failure, a closed app or a log-out cannot count as joining:
the pop-up simply comes back on the next sign-in until the server has recorded the tap.
Directors control the words and the link (and the support phone number) from Business Settings.
"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly, invalidate_user_cache
from app.models.user import User, UserRole
from app.services.settings_service import get_config_value, set_config_value

router = APIRouter(tags=["community"])

DEFAULT_TITLE = "Join the MonieKing family 🎉"
DEFAULT_MESSAGE = ("Welcome to MonieKing! Join all MonieKing customers worldwide in our WhatsApp group so you never feel "
                   "alone on your contribution journey. Get updates, tips and support from the community.")
DEFAULT_BUTTON = "Join WhatsApp group"
K = {"title": "community.whatsapp_title", "message": "community.whatsapp_message", "button": "community.whatsapp_button",
     "link": "community.whatsapp_link", "support_phone": "support.phone", "support_whatsapp": "support.whatsapp"}


async def _community(db: AsyncSession) -> dict:
    return {
        "title": await get_config_value(db, K["title"], DEFAULT_TITLE) or DEFAULT_TITLE,
        "message": await get_config_value(db, K["message"], DEFAULT_MESSAGE) or DEFAULT_MESSAGE,
        "button": await get_config_value(db, K["button"], DEFAULT_BUTTON) or DEFAULT_BUTTON,
        "link": (await get_config_value(db, K["link"], "") or "").strip(),
    }


async def support_contact(db: AsyncSession) -> dict:
    phone = (await get_config_value(db, K["support_phone"], "") or "").strip()
    wa = re.sub(r"\D", "", await get_config_value(db, K["support_whatsapp"], "") or "")
    return {"phone": phone, "whatsapp": wa, "configured": bool(phone or wa),
            "tel_url": f"tel:{re.sub(r'[^0-9+]', '', phone)}" if phone else None,
            "whatsapp_url": f"https://wa.me/{wa}" if wa else None}


@router.get("/support-contact")
async def get_support_contact(db: AsyncSession = Depends(get_db)):
    """The one place every 'Contact support' button reads from."""
    return await support_contact(db)


@router.get("/community/whatsapp")
async def whatsapp_gate(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    c = await _community(db)
    is_customer = (user.role.value if hasattr(user.role, "value") else str(user.role)) == "customer"
    joined = getattr(user, "whatsapp_joined_at", None) is not None
    # Without a link there is nothing to join, so nobody is ever locked out by an unfinished setup.
    return {**c, "joined": joined, "required": bool(is_customer and not joined and c["link"])}


@router.post("/community/whatsapp/joined")
async def whatsapp_joined(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Called when the customer taps the join button. Only this call unlocks the dashboard."""
    row = await db.get(User, user.id)
    if row and row.whatsapp_joined_at is None:
        row.whatsapp_joined_at = datetime.now(timezone.utc)
        await db.flush()
    await invalidate_user_cache(str(user.id))
    return {"ok": True, "joined": True}


class CommunityIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=1000)
    button: str = Field(default=DEFAULT_BUTTON, min_length=1, max_length=40)
    link: str = Field(default="", max_length=300)
    support_phone: str = Field(default="", max_length=30)
    support_whatsapp: str = Field(default="", max_length=30)


@router.get("/community/admin")
async def community_admin_get(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    sup = await support_contact(db)
    joined = (await db.execute(select(func.count()).select_from(User).where(
        User.role == UserRole.CUSTOMER, User.whatsapp_joined_at.is_not(None)))).scalar_one()
    total = (await db.execute(select(func.count()).select_from(User).where(User.role == UserRole.CUSTOMER))).scalar_one()
    return {**(await _community(db)), "support_phone": sup["phone"], "support_whatsapp": sup["whatsapp"], "joined_count": joined, "customer_count": total}


@router.put("/community/admin")
async def community_admin_put(body: CommunityIn, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    link = body.link.strip()
    if link and not re.match(r"^https://(chat\.whatsapp\.com|wa\.me|whatsapp\.com)/\S+$", link):
        raise HTTPException(400, "That does not look like a WhatsApp link. It should start with https://chat.whatsapp.com/")
    for key, val in (("title", body.title.strip()), ("message", body.message.strip()), ("button", body.button.strip()), ("link", link),
                     ("support_phone", body.support_phone.strip()), ("support_whatsapp", re.sub(r"\D", "", body.support_whatsapp))):
        await set_config_value(db, key=K[key], value=val, updated_by=director.id)
    return {"ok": True}
