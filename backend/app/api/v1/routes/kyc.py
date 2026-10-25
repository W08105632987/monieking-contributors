"""KYC page backend: optional phone check, then NIN verification through Techhub (name shown before the person confirms)."""
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, invalidate_user_cache
from app.core.limiter import limiter
from app.core.security import hash_password, verify_password
from app.integrations import techhub as T
from app.integrations.monnify import get_payment_provider
from app.models.notification import NotificationType
from app.models.user import User
from app.schemas.wallet import WalletResponse
from app.services import kyc_flow
from app.services.notification_service import send_notification
from app.services.wallet_service import get_or_create_wallet
from app.utils.audit import log_action
from app.verification import breaker as B
from app.verification import constants as C
from app.verification import extract as X
from app.verification import service as vs
from app.verification.normalize import InputError, normalize_inputs, mask_id
from app.verification.sheet_pdf import full_name

logger = logging.getLogger("monieking.kyc")
router = APIRouter(prefix="/wallets/me/kyc", tags=["kyc"])

UNAVAILABLE = "Identity verification is unavailable right now. Please try again later."
PHONE_OTP_MINUTES = 10


async def _notify(db: AsyncSession, user_id, title: str, body: str):
    try:
        await send_notification(db, user_id=user_id, title=title, body=body, type=NotificationType.INFO)
        await db.commit()
    except Exception as e:  # a notification problem must never break verification
        logger.warning("kyc notification failed: %r", e)
        await db.rollback()


# ── Step 2 (optional): prove the phone number is theirs ────────────────
class CodeBody(BaseModel):
    code: str


@router.post("/phone/send")
@limiter.limit("3/minute")
async def phone_send(request: Request, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    from app.integrations.termii import send_sms
    user = await db.get(User, current_user.id)
    if user.phone_verified_at:
        return {"message": "Your phone number is already verified.", "already": True}
    code = f"{secrets.randbelow(1_000_000):06d}"
    user.phone_otp_hash = hash_password(code)
    user.phone_otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=PHONE_OTP_MINUTES)
    user.phone_otp_attempts = 0
    await db.commit()
    try:
        await send_sms(user.phone_number, f"Your MonieKing phone verification code is {code}. It expires in {PHONE_OTP_MINUTES} minutes. Don't share it.")
    except Exception as e:
        logger.warning("kyc phone sms failed: %r", e)
        raise HTTPException(status_code=503, detail="We couldn't send the code right now. You can skip this step and do it later.")
    return {"message": f"We sent a 6-digit code to {user.phone_number}.", "already": False}


@router.post("/phone/verify")
@limiter.limit("10/minute")
async def phone_verify(request: Request, body: CodeBody, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, current_user.id)
    if user.phone_verified_at:
        return {"phone_verified": True}
    if not user.phone_otp_hash or not user.phone_otp_expires_at or user.phone_otp_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="That code has expired. Ask for a new one.")
    if (user.phone_otp_attempts or 0) >= 5:
        raise HTTPException(status_code=429, detail="Too many wrong codes. Ask for a new one.")
    if not verify_password((body.code or "").strip(), user.phone_otp_hash):
        user.phone_otp_attempts = (user.phone_otp_attempts or 0) + 1
        await db.commit()
        raise HTTPException(status_code=400, detail="That code is not correct.")
    user.phone_verified_at = datetime.now(timezone.utc)
    user.phone_otp_hash = None
    user.phone_otp_expires_at = None
    await db.commit()
    await invalidate_user_cache(str(user.id))
    return {"phone_verified": True}


# ── Step 3: NIN ─────────────────────────────────────────────────────────
class NinBody(BaseModel):
    number: str


class NinConfirmBody(NinBody):
    proof: str
    auth_method: str = "password"
    pin: str | None = None
    webauthn_assertion: dict | None = None


@router.post("/nin/preview")
@limiter.limit("6/minute")
async def nin_preview(request: Request, body: NinBody, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Look the NIN up and return the VERIFIED NAME, before the person confirms anything."""
    if current_user.nin_linked or current_user.bvn_linked:
        raise HTTPException(status_code=400, detail="Your identity is already verified.")
    try:
        fields = normalize_inputs("nin", {"nin": body.number})
    except InputError as e:
        raise HTTPException(status_code=422, detail=str(e))
    uid = current_user.id

    cfg = await vs.load_settings(db)
    endpoint = C.ENDPOINTS.get(("nin", cfg.lookup_tier["nin"]))
    st = await vs._state_row(db, "nin")
    if endpoint is None or not B.allows_call(vs._to_breaker(st), vs._now()):
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    await db.commit()   # no open transaction while we wait on the network

    try:
        result = await T.call_techhub(endpoint, fields)
    except T.TechhubNotFound:
        await vs.record_outcome(db, "nin", ok=True)
        await db.commit()
        await _notify(db, uid, "KYC not completed", "We couldn't find that NIN. Check the number and try again from your KYC page.")
        raise HTTPException(status_code=404, detail="We couldn't find that NIN. Check the number and try again.")
    except T.TechhubInvalidInput as e:
        raise HTTPException(status_code=422, detail=e.user_message)
    except T.TechhubError as e:
        if e.counts_as_failure:
            await vs.record_outcome(db, "nin", ok=False, reason=e.reason)
            await db.commit()
        logger.warning("kyc nin preview failed reason=%s", e.reason)
        await _notify(db, uid, "KYC not completed", "Identity verification is unavailable right now. Please try again in a few minutes.")
        raise HTTPException(status_code=503, detail=e.user_message)

    person = X.complete(result.user_data, result.pdf, id_key="nin", requested_id=fields["nin"])
    if not X.has_identity(person):
        await vs.record_outcome(db, "nin", ok=False, reason="unreadable_result")
        await db.commit()
        logger.warning("kyc nin unreadable keys=%s", X.key_names(result.user_data))
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    await vs.record_outcome(db, "nin", ok=True)
    await db.commit()

    verified_name = full_name(person)
    ok = kyc_flow.names_match(current_user.full_name, verified_name)
    proof = kyc_flow.make_proof(user_id=str(uid), kind="nin", number=fields["nin"], name=verified_name, name_ok=ok)
    message = None
    if not ok:
        message = (f"The name on this NIN ({verified_name}) doesn't match the name on your MonieKing account "
                   f"({current_user.full_name}). Check you typed your own NIN, or ask your officer to correct your name.")
        await _notify(db, uid, "KYC not completed", "The name on the NIN you entered doesn't match your MonieKing account name.")
    return {"verified_name": verified_name, "registered_name": current_user.full_name, "name_matches": ok,
            "id_masked": mask_id(fields["nin"]), "proof": proof, "message": message}


@router.post("/nin/confirm", response_model=WalletResponse)
@limiter.limit("6/minute")
async def nin_confirm(request: Request, body: NinConfirmBody, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """The person has seen their verified name: PIN, then KYC is complete."""
    try:
        number = normalize_inputs("nin", {"nin": body.number})["nin"]
    except InputError as e:
        raise HTTPException(status_code=422, detail=str(e))
    proof = kyc_flow.read_proof(body.proof, user_id=str(current_user.id), kind="nin", number=number)
    if not proof.get("ok"):
        raise HTTPException(status_code=422, detail="The name on that NIN doesn't match your account name, so it can't be linked.")

    if body.auth_method == "password":
        from app.services.pin_service import check_pin
        await check_pin(db, current_user, body.pin, need_kyc=False)
    elif body.auth_method == "biometric":
        if not body.webauthn_assertion:
            raise HTTPException(status_code=400, detail="WebAuthn assertion required")
        from app.services.webauthn_service import verify_authentication
        await verify_authentication(db, current_user, body.webauthn_assertion)
    else:
        raise HTTPException(status_code=400, detail="Invalid auth method")

    user = await db.get(User, current_user.id)
    wallet = await get_or_create_wallet(db, user.id)
    verified_name = proof["n"]
    provider = get_payment_provider()

    if wallet.virtual_account_ref:
        # The account was created at signup. Attach the NIN so Monnify lifts the account's limit. Not fatal if Monnify is slow.
        try:
            await provider.update_reserved_account_kyc(account_reference=wallet.virtual_account_ref, nin=number)
        except Exception as e:
            logger.error("[kyc] Monnify limit update failed for %s: %r", user.id, e)
    else:
        # Signup couldn't create the account: create it now, in the verified name, with the NIN.
        try:
            await _create_account(db, user, wallet, provider, name=verified_name, nin=number)
        except HTTPException as e:
            logger.error("[kyc] account creation during KYC failed for %s: %s", user.id, e.detail)
            # The identity IS verified; don't make them redo it. Account number can be fetched again from the wallet page.

    user.nin_linked, user.nin_last4 = True, number[-4:]
    user.kyc_completed_at = datetime.now(timezone.utc)
    await log_action(db, actor_id=user.id, action="kyc.verified", entity_type="user", entity_id=str(user.id),
                     new_value={"kind": "nin", "id_last4": number[-4:], "verified_name": verified_name})
    await db.commit()
    await invalidate_user_cache(str(user.id))
    await _notify(db, user.id, "KYC complete 🎉", "Thank you! Your identity is verified and you now have full access to MonieKing.")
    return wallet


def _reason(exc: Exception) -> str:
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            msg = response.json().get("responseMessage")
            if msg:
                return str(msg)[:160]
        except Exception:
            pass
    return ""


async def _create_account(db: AsyncSession, user: User, wallet, provider, *, name: str, nin: str | None = None):
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    kwargs = {"nin": nin} if nin else {}
    try:
        account = await provider.create_reserved_account(
            account_reference=f"MK-{role.upper()[:4]}-{user.id.hex[:8].upper()}",
            account_name=name,
            customer_email=f"{user.phone_number}@monieking.app",
            customer_name=name,
            **kwargs,
        )
    except Exception as e:
        reason = _reason(e)
        logger.error("[va] virtual account creation FAILED for %s: %r | monnify said: %s", user.id, e, reason or "(nothing)")
        raise HTTPException(status_code=502, detail="We couldn't create your account number just yet." + (f" ({reason})" if reason else "") + " Please try again in a minute.")
    if not account.account_number:
        logger.error("[va] Monnify returned no account number for %s", user.id)
        raise HTTPException(status_code=502, detail="We couldn't create your account number just yet. Please try again in a minute.")
    wallet.virtual_account_number = account.account_number
    wallet.virtual_account_bank = account.bank_name
    wallet.virtual_account_ref = account.account_reference
    wallet.virtual_account_name = account.account_name or name
    await db.flush()
