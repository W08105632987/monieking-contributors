"""Director powers over a single customer: reset password, fund wallet manually, delete with a clear warning.
Every action needs the director's PIN and is written to the audit log."""
import secrets
import string
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.card import ContributionCard, CardStatus
from app.models.notification import NotificationType
from app.models.user import User, UserRole, UserStatus
from app.models.wallet import TxCategory
from app.models.withdrawal import Withdrawal, WithdrawalStatus
from app.services import purge_service
from app.services.notification_service import send_notification
from app.services.user_service import resolve_user
from app.services.wallet_service import credit_wallet, get_or_create_wallet
from app.services.pin_service import check_pin
from app.utils.audit import log_action

router = APIRouter(prefix="/customer-admin", tags=["customer-admin"])


async def _customer(db: AsyncSession, user_id: str) -> User:
    user = await resolve_user(db, user_id)
    if not user or user.role != UserRole.CUSTOMER:
        raise HTTPException(status_code=404, detail="Customer not found")
    return user


def _temp_password(n: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(n))
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw):
            return pw


class PinBody(BaseModel):
    pin: str


@router.post("/{user_id}/reset-password")
async def reset_password(user_id: str, body: PinBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Sets a new temporary password and hands it to the DIRECTOR, who then chooses how to pass it on:
    copy it, WhatsApp, SMS or email (see /send-password). Nothing is sent to the customer automatically.
    The password is never written to the audit log."""
    await check_pin(db, director, body.pin)
    user = await _customer(db, user_id)
    pw = _temp_password()
    from app.utils.supabase_admin_client import supabase_admin_request
    await supabase_admin_request(
        "PUT", f"/auth/v1/admin/users/{user.id}", json={"password": pw},
        failure_detail="Couldn't reach the login service to reset this password. Please try again.",
    )
    await log_action(db, actor_id=director.id, action="customer.password_reset", entity_type="user", entity_id=str(user.id))
    return {"message": "Password reset", "temporary_password": pw, "phone_number": user.phone_number,
            "email": user.email if (user.email and user.email_verified_at) else None, "sms_sent": False}


class SendPasswordBody(BaseModel):
    channel: str = Field(pattern="^(sms|email)$")
    temporary_password: str = Field(pattern="^[A-Za-z0-9]{8,32}$")
    pin: str


@router.post("/{user_id}/send-password")
async def send_password(user_id: str, body: SendPasswordBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Send the temporary password the director just generated, by SMS or to the customer's verified email."""
    await check_pin(db, director, body.pin)
    user = await _customer(db, user_id)
    text_msg = f"MonieKing: your password was reset by a director. Temporary password: {body.temporary_password}. Please log in and change it now."
    if body.channel == "sms":
        from app.services.sms_service import send_sms
        try:
            ok = await send_sms(user.phone_number, text_msg)
        except Exception:
            ok = False
        if ok is False:
            raise HTTPException(status_code=502, detail="The SMS could not be delivered. Copy the password or use WhatsApp instead.")
    else:
        if not (user.email and user.email_verified_at):
            raise HTTPException(status_code=400, detail="This customer has no verified email address. Use SMS or WhatsApp instead.")
        from app.integrations.email_sender import send_email
        ok = await send_email(to=[user.email], subject="Your MonieKing password was reset",
                              body=text_msg + "\n\nIf you did not expect this, contact MonieKing support.")
        if not ok:
            raise HTTPException(status_code=502, detail="The email could not be sent. Copy the password or use WhatsApp instead.")
    await log_action(db, actor_id=director.id, action="customer.password_sent", entity_type="user", entity_id=str(user.id), new_value={"channel": body.channel})
    return {"sent": True, "channel": body.channel}


class FundBody(BaseModel):
    amount_naira: float = Field(gt=0, le=5_000_000)
    reason: str = Field(min_length=5, max_length=300)
    pin: str


@router.post("/{user_id}/fund-wallet")
async def fund_wallet(user_id: str, body: FundBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    await check_pin(db, director, body.pin)
    user = await _customer(db, user_id)
    kobo = int(round(body.amount_naira * 100))
    wallet = await get_or_create_wallet(db, user.id)
    ref = f"MANUAL-{uuid.uuid4().hex[:12].upper()}"
    tx = await credit_wallet(
        db, wallet=wallet, amount_kobo=kobo, category=TxCategory.WALLET_FUNDING, reference=ref,
        description=f"Manual funding by director: {body.reason.strip()}", initiated_by=director.id,
    )
    await log_action(db, actor_id=director.id, action="wallet.manual_funding", entity_type="user", entity_id=str(user.id),
                     new_value={"amount_kobo": kobo, "reason": body.reason.strip(), "reference": ref})
    await send_notification(
        db, user_id=user.id, title="Wallet funded",
        body=f"₦{body.amount_naira:,.2f} was added to your wallet.", type=NotificationType.INFO, deep_link_url="/wallet",
    )
    return {"message": "Wallet funded", "reference": ref, "balance_kobo": tx.balance_after_kobo}


async def _risk(db: AsyncSession, user: User) -> dict:
    wallet = await get_or_create_wallet(db, user.id)
    cards = (await db.execute(select(ContributionCard).where(ContributionCard.owner_id == user.id))).scalars().all()
    open_w = (await db.execute(select(Withdrawal).where(
        Withdrawal.customer_id == user.id,
        Withdrawal.status.in_([WithdrawalStatus.PENDING, WithdrawalStatus.CLAIMED])))).scalars().all()
    card_kobo = sum(int(c.total_contributed_kobo or 0) for c in cards)
    active_cards = [c for c in cards if c.status == CardStatus.ACTIVE]
    money = int(wallet.balance_kobo or 0) + card_kobo
    hard = bool(user.is_test) or (money == 0 and not open_w)
    return {
        "id": str(user.id), "full_name": user.full_name, "phone_number": user.phone_number, "is_test": bool(user.is_test),
        "wallet_balance_kobo": int(wallet.balance_kobo or 0),
        "card_balance_kobo": card_kobo,
        "cards_total": len(cards), "cards_active": len(active_cards),
        "unpaid_withdrawals": [{"id": str(w.id), "amount_kobo": int(w.amount_kobo), "status": w.status.value} for w in open_w],
        "mode": "delete" if hard else "archive",
        "blocked": bool(open_w) and not user.is_test,
        "explain": (
            "This account will be erased completely and the phone number can be used again."
            if hard else
            "This customer has money or open requests. The account is closed, personal details are wiped and the phone number is freed, but the money records stay for your books."
        ),
    }


@router.get("/{user_id}/delete-preview")
async def delete_preview(user_id: str, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    return await _risk(db, await _customer(db, user_id))


class DeleteBody(BaseModel):
    confirm_name: str
    pin: str
    acknowledge_money: bool = False


@router.post("/{user_id}/delete")
async def delete_customer(user_id: str, body: DeleteBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    user = await _customer(db, user_id)
    if body.confirm_name.strip().lower() != (user.full_name or "").strip().lower():
        raise HTTPException(status_code=400, detail="Type the customer's full name exactly to confirm.")
    await check_pin(db, director, body.pin)
    risk = await _risk(db, user)
    if risk["blocked"]:
        raise HTTPException(status_code=409, detail="This customer has unpaid withdrawals. Settle or reject them first.")
    money = risk["wallet_balance_kobo"] + risk["card_balance_kobo"]
    if money > 0 and not user.is_test and not body.acknowledge_money:
        raise HTTPException(status_code=409, detail="This customer still holds money. Tick the acknowledgement to continue.")
    uid, name, phone = user.id, user.full_name, user.phone_number

    if risk["mode"] == "delete":
        plan = await purge_service.build_plan(db, [uid])
        if plan.conflicts:
            raise HTTPException(status_code=409, detail="This account is tied to other real records, so it can only be archived.")
        try:
            await purge_service.purge(db, test_user_ids=[uid], director_id=director.id)
        except ValueError as e:
            await db.rollback()
            raise HTTPException(status_code=409, detail=str(e))
        result = "deleted"
    else:
        user.full_name = "Deleted customer"
        user.phone_number = f"x{uuid.uuid4().hex[:15]}"
        for col in ("bank_name", "bank_code", "account_number", "account_name", "face_image_url", "next_of_kin_name",
                    "next_of_kin_phone", "avatar_url", "location_latitude", "location_longitude", "detected_state",
                    "state_of_residence"):
            setattr(user, col, None)
        user.status = UserStatus.SUSPENDED
        user.deleted_at = datetime.now(timezone.utc)
        user.withdrawal_password_hash = None
        await db.execute(text("UPDATE pending_offline_customers SET claimed_at = now() WHERE phone_number = :p AND claimed_at IS NULL"), {"p": phone})
        await db.flush()
        result = "archived"

    from app.utils.supabase_admin_client import supabase_admin_request
    await supabase_admin_request(
        "DELETE", f"/auth/v1/admin/users/{uid}", ok_statuses=(200, 204), not_found_ok=True,
        failure_detail="Could not remove the login. Nothing was changed — please try again.",
    )
    await log_action(db, actor_id=director.id, action=f"customer.{result}", entity_type="user", entity_id=str(uid),
                     old_value={"full_name": name, "phone_number": phone, "wallet_kobo": risk["wallet_balance_kobo"], "card_kobo": risk["card_balance_kobo"]})
    await db.commit()
    return {"message": f"{name} was {result}", "result": result}


# ── Identity services: delete with a warning ───────────────────────
async def _service_info(db: AsyncSession, service_id: uuid.UUID):
    from app.models.identity_service import IdentityService, IdentityServiceRequest, IdentityServiceNotifyRequest
    svc = await db.get(IdentityService, service_id)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    reqs = (await db.execute(select(func.count(IdentityServiceRequest.id)).where(IdentityServiceRequest.service_id == service_id))).scalar_one()
    waiting = (await db.execute(select(func.count(IdentityServiceNotifyRequest.id)).where(IdentityServiceNotifyRequest.service_id == service_id))).scalar_one()
    return svc, int(reqs), int(waiting)


@router.get("/identity-services/{service_id}/delete-preview")
async def service_delete_preview(service_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    svc, reqs, waiting = await _service_info(db, service_id)
    return {"id": str(svc.id), "name": getattr(svc, "name", None) or svc.category.value, "requests": reqs,
            "waiting_customers": waiting, "can_delete": reqs == 0,
            "explain": "Customers have already used this service, so it can only be switched off." if reqs else
                       "No one has used this service. It can be removed; customers waiting for it are dropped."}


class ServiceDeleteBody(BaseModel):
    pin: str


@router.post("/identity-services/{service_id}/delete")
async def service_delete(service_id: uuid.UUID, body: ServiceDeleteBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    await check_pin(db, director, body.pin)
    svc, reqs, _ = await _service_info(db, service_id)
    if reqs:
        raise HTTPException(status_code=409, detail="Customers have used this service. Switch it off instead of deleting it.")
    await db.execute(text("DELETE FROM identity_service_notify_requests WHERE service_id = :s"), {"s": str(service_id)})
    await db.delete(svc)
    await log_action(db, actor_id=director.id, action="identity_service.deleted", entity_type="identity_service", entity_id=str(service_id))
    await db.flush()
    return {"message": "Service removed"}
