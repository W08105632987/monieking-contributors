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
from app.services.wallet_service import credit_wallet, debit_wallet, get_or_create_wallet
from app.services.pin_service import check_pin
from app.utils.audit import log_action

router = APIRouter(prefix="/customer-admin", tags=["customer-admin"])


async def _customer(db: AsyncSession, user_id: str) -> User:
    user = await resolve_user(db, user_id)
    if not user or user.role != UserRole.CUSTOMER:
        raise HTTPException(status_code=404, detail="Customer not found")
    return user


async def _person(db: AsyncSession, user_id: str) -> User:
    """A customer OR an officer: the people a director may reset passwords, PINs and withdrawal passwords for."""
    user = await resolve_user(db, user_id)
    if not user or user.role not in (UserRole.CUSTOMER, UserRole.OFFICER):
        raise HTTPException(status_code=404, detail="Person not found")
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
    user = await _person(db, user_id)
    from app.services.default_password import default_password
    from app.core.security import hash_password
    from app.core.dependencies import invalidate_user_cache
    pw = default_password(user.phone_number)   # phone + MK; they are asked to change it at every login until they do
    from app.utils.supabase_admin_client import supabase_admin_request
    await supabase_admin_request(
        "PUT", f"/auth/v1/admin/users/{user.id}", json={"password": pw},
        failure_detail="Couldn't reach the login service to reset this password. Please try again.",
    )
    user.login_password_hash = hash_password(pw)
    user.must_change_password = True
    user.login_failed_attempts = 0       # a reset also lifts a login lockout
    user.login_locked_until = None
    await log_action(db, actor_id=director.id, action="user.password_reset", entity_type="user", entity_id=str(user.id),
                     new_value={"role": user.role.value})
    await db.flush()
    await invalidate_user_cache(str(user.id))
    return {"message": "Password reset", "temporary_password": pw, "phone_number": user.phone_number, "role": user.role.value,
            "email": user.email if (user.email and user.email_verified_at) else None, "sms_sent": False}


class SendPasswordBody(BaseModel):
    channel: str = Field(pattern="^(sms|email)$")
    temporary_password: str = Field(pattern="^[A-Za-z0-9]{8,32}$")   # the default (phone + MK) fits this
    pin: str


@router.post("/{user_id}/send-password")
async def send_password(user_id: str, body: SendPasswordBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Send the temporary password the director just generated, by SMS or to the customer's verified email."""
    await check_pin(db, director, body.pin)
    user = await _person(db, user_id)
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
    await log_action(db, actor_id=director.id, action="user.password_sent", entity_type="user", entity_id=str(user.id), new_value={"channel": body.channel})
    return {"sent": True, "channel": body.channel}


class ResetKind(BaseModel):
    pin: str


@router.post("/{user_id}/reset-payment-pin")
async def reset_payment_pin(user_id: str, body: ResetKind, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Clears the person's payment PIN (and any PIN lockout). They set a new one themselves the next time they open the app."""
    await check_pin(db, director, body.pin)
    user = await _person(db, user_id)
    from app.core.dependencies import invalidate_user_cache
    user.payment_pin_hash = None
    user.pin_failed_attempts = 0
    user.pin_locked_until = None
    await log_action(db, actor_id=director.id, action="user.payment_pin_reset", entity_type="user", entity_id=str(user.id),
                     new_value={"role": user.role.value})
    await send_notification(db, user_id=user.id, title="Payment PIN reset",
                            body="A director reset your payment PIN. Open the app and set a new 4-digit PIN before your next payment.",
                            type=NotificationType.INFO)
    await db.flush()
    await invalidate_user_cache(str(user.id))
    return {"message": "Payment PIN reset. They will be asked to set a new one."}


@router.post("/{user_id}/reset-withdrawal-password")
async def reset_withdrawal_password(user_id: str, body: ResetKind, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Clears the person's withdrawal password (and any lockout). They set a new one themselves in the app."""
    await check_pin(db, director, body.pin)
    user = await _person(db, user_id)
    from app.core.dependencies import invalidate_user_cache
    user.withdrawal_password_hash = None
    user.withdrawal_password_failed_attempts = 0
    user.withdrawal_password_locked_until = None
    await log_action(db, actor_id=director.id, action="user.withdrawal_password_reset", entity_type="user", entity_id=str(user.id),
                     new_value={"role": user.role.value})
    await send_notification(db, user_id=user.id, title="Withdrawal password reset",
                            body="A director reset your withdrawal password. Open the app and set a new one before your next withdrawal.",
                            type=NotificationType.INFO)
    await db.flush()
    await invalidate_user_cache(str(user.id))
    return {"message": "Withdrawal password reset. They will be asked to set a new one."}


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


@router.post("/{user_id}/debit-wallet")
async def debit_wallet_manually(user_id: str, body: FundBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Takes money OUT of a customer's wallet (a correction, a chargeback, money paid out by hand ...).
    Same guards as manual funding: director PIN, a written reason, audit log, customer notified.
    It can never take the wallet below zero. Recorded as its own transaction type so it is never
    mistaken for a service charge or a withdrawal in reports."""
    await check_pin(db, director, body.pin)
    user = await _customer(db, user_id)
    kobo = int(round(body.amount_naira * 100))
    wallet = await get_or_create_wallet(db, user.id)
    ref = f"MANUAL-DEBIT-{uuid.uuid4().hex[:12].upper()}"
    tx = await debit_wallet(
        db, wallet=wallet, amount_kobo=kobo, category=TxCategory.MANUAL_DEBIT, reference=ref,
        description=f"Manual debit by director: {body.reason.strip()}", initiated_by=director.id,
    )
    await log_action(db, actor_id=director.id, action="wallet.manual_debit", entity_type="user", entity_id=str(user.id),
                     new_value={"amount_kobo": kobo, "reason": body.reason.strip(), "reference": ref})
    await send_notification(
        db, user_id=user.id, title="Wallet debited",
        body=f"₦{body.amount_naira:,.2f} was deducted from your wallet. Reason: {body.reason.strip()}",
        type=NotificationType.WARNING, deep_link_url="/wallet",
    )
    return {"message": "Wallet debited", "reference": ref, "balance_kobo": tx.balance_after_kobo}


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
            "This customer has money history. Every personal detail is erased from the whole system — name, phone, bank details, photos, documents, devices, messages and the login — and the phone number can be used again. Only anonymous money records stay, for your books."
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
    name = user.full_name
    from app.services.erasure_service import erase_account
    # One engine for every delete: removes the person from every table, files and login, keeps only anonymous money
    # records, then re-scans the database and tells the director whether anything still mentions them.
    result, report = await erase_account(db, user, director_id=director.id, hard_preferred=(risk["mode"] == "delete"))
    await db.commit()
    return {
        "message": f"{name} was {result}" + ("" if report["verified_clean"] else " — a few leftovers need a look, see details"),
        "result": result,
        "verified_clean": report["verified_clean"],
        "report": report,
    }


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
