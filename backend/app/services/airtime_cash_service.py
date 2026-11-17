"""
Airtime to Cash: a customer sells airtime from their own line and receives cash in their MonieKing wallet.

Flow (all through GYKDATASUB, see integrations/gyk.py):  start (OTP sent to the line) -> verify (OTP) -> submit (SIM PIN).
Money rules:
  * The supplier credits US at its rate; the customer gets that minus the director's margin. Quote and payout are computed here,
    never trusted from the browser.
  * We credit the customer ONLY after the supplier confirms success. If the supplier's reply is unclear, the request goes to
    "pending_review" and NO money is credited until a director decides, so a lost reply can never create money from nothing.
  * One wallet credit per request (the reference is unique), so a repeated submit can never pay twice.
  * The SIM PIN and the OTP are forwarded and forgotten: never stored, never logged, never in an error message.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.gyk import ID_TO_DISPLAY, NETWORK_SLUGS, VtuError, classify_failure, get_vtu_provider
from app.models.airtime_cash import AirtimeCashRequest
from app.models.user import User
from app.models.wallet import TxCategory, WalletTransaction
from app.services import bill_config
from app.services.wallet_service import credit_wallet, get_or_create_wallet
from app.utils.audit import log_action

logger = logging.getLogger("monieking.a2c")

CHARGE_KEYS = {"MTN": "air_mtn_charges", "Airtel": "air_airtel_charges", "Glo": "air_glo_charges", "9mobile": "air_9mobile_charges"}
ACTIVE = ("started", "otp_sent", "verified", "submitted", "pending_review", "completed")


def provider_credit_kobo(amount_naira: float, network: str, fees: dict) -> int:
    """What the supplier credits us for this airtime: amount minus their network percentage minus their fixed Airtime-to-Cash fee."""
    pct = float(fees.get(CHARGE_KEYS.get(network, ""), 0) or 0)
    fixed = float(fees.get("air_to_cash", 0) or 0)
    return max(0, int((amount_naira - amount_naira * pct / 100 - fixed) * 100))


def split_payout(provider_credit_kobo_: int, margin_percent: float) -> tuple[int, int]:
    """-> (customer payout, our fee). The customer's share is rounded DOWN to a whole kobo."""
    payout = int(provider_credit_kobo_ * (100 - margin_percent) / 100)
    return payout, provider_credit_kobo_ - payout


async def quote(db: AsyncSession, network: str, amount_naira: int) -> dict:
    cfg = await bill_config.get_bills_config(db)
    if network not in NETWORK_SLUGS:
        raise ValueError("Choose MTN, Airtel, Glo or 9mobile.")
    vtu = get_vtu_provider()
    try:
        fees = await vtu.get_fees()
    except VtuError:
        raise ValueError("Airtime to Cash is not available right now. Please try again later.")
    credit = provider_credit_kobo(amount_naira, network, fees)
    payout, fee = split_payout(credit, float(cfg["a2c_margin_percent"]))
    if payout < 5000:
        raise ValueError("That amount is too small to convert. Try a larger amount.")
    return {"network": network, "amount_kobo": amount_naira * 100, "provider_credit_kobo": credit, "payout_kobo": payout, "fee_kobo": fee}


async def _eligibility(db: AsyncSession, customer: User, cfg: dict, amount_naira: int) -> None:
    if not cfg["a2c_enabled"]:
        raise ValueError("Airtime to Cash is not available right now.")
    if not get_vtu_provider().configured:
        raise ValueError("Airtime to Cash is not available right now.")
    if not customer.kyc_completed_at:
        raise ValueError("Please complete your identity verification before using Airtime to Cash.")
    age_days = (datetime.now(timezone.utc) - customer.created_at).days if customer.created_at else 0
    if age_days < int(cfg["a2c_min_account_age_days"]):
        raise ValueError(f"Airtime to Cash opens {cfg['a2c_min_account_age_days']} days after you join. Please try again soon.")
    if not (cfg["a2c_min_naira"] <= amount_naira <= cfg["a2c_max_naira"]):
        raise ValueError(f"Choose an amount between ₦{cfg['a2c_min_naira']:,} and ₦{cfg['a2c_max_naira']:,}.")
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    used = (await db.execute(select(func.coalesce(func.sum(AirtimeCashRequest.amount_kobo), 0)).where(
        AirtimeCashRequest.customer_id == customer.id, AirtimeCashRequest.created_at >= day_start,
        AirtimeCashRequest.status.in_(("submitted", "pending_review", "completed"))))).scalar() or 0
    if used + amount_naira * 100 > int(cfg["a2c_daily_max_naira"]) * 100:
        raise ValueError("You have reached today's Airtime to Cash limit. Please try again tomorrow.")


async def start(db: AsyncSession, customer: User, network: str, phone: str, amount_naira: int) -> AirtimeCashRequest:
    cfg = await bill_config.get_bills_config(db)
    await _eligibility(db, customer, cfg, amount_naira)
    phone = bill_config.normalize_phone(phone) or ""
    if not phone:
        raise ValueError("Enter a valid phone number.")
    q = await quote(db, network, amount_naira)
    # One unfinished attempt per customer at a time: no stacking OTPs.
    open_one = (await db.execute(select(AirtimeCashRequest.id).where(
        AirtimeCashRequest.customer_id == customer.id, AirtimeCashRequest.status.in_(("started", "otp_sent", "verified")),
        AirtimeCashRequest.created_at >= datetime.now(timezone.utc) - timedelta(minutes=15)))).first()
    if open_one:
        raise ValueError("Please finish or wait for your last Airtime to Cash attempt first.")
    req = AirtimeCashRequest(customer_id=customer.id, network=network, phone=phone, amount_kobo=q["amount_kobo"],
                             provider_credit_kobo=q["provider_credit_kobo"], payout_kobo=q["payout_kobo"], fee_kobo=q["fee_kobo"], status="started")
    db.add(req)
    await db.flush()
    try:
        req.provider_identifier = await get_vtu_provider().a2c_otp(network=NETWORK_SLUGS[network], phone=phone)
    except VtuError as e:
        req.status, req.failure_reason = "failed", e.raw[:300]
        await db.commit()
        raise ValueError(e.message)
    req.status = "otp_sent"
    await db.commit()
    return req


async def _mine(db: AsyncSession, customer: User, request_id: uuid.UUID, *, lock: bool = False) -> AirtimeCashRequest:
    stmt = select(AirtimeCashRequest).where(AirtimeCashRequest.id == request_id, AirtimeCashRequest.customer_id == customer.id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    req = (await db.execute(stmt)).scalar_one_or_none()
    if req is None:
        raise ValueError("Request not found.")
    return req


async def verify(db: AsyncSession, customer: User, request_id: uuid.UUID, otp: str) -> AirtimeCashRequest:
    req = await _mine(db, customer, request_id)
    if req.status != "otp_sent" or not req.provider_identifier:
        raise ValueError("This request can no longer be verified. Please start again.")
    try:
        req.provider_session = await get_vtu_provider().a2c_verify(identifier=req.provider_identifier, otp=otp.strip())
    except VtuError as e:
        await db.commit()
        raise ValueError(e.message)
    req.status = "verified"
    await db.commit()
    return req


async def submit(db: AsyncSession, customer: User, request_id: uuid.UUID, simpin: str) -> AirtimeCashRequest:
    """The PIN has already been checked by the route. `simpin` is passed straight through and never stored or logged."""
    req = await _mine(db, customer, request_id, lock=True)
    if req.status != "verified" or not req.provider_session:
        raise ValueError("This request is not ready. Please start again.")
    cfg = await bill_config.get_bills_config(db)
    if not cfg["a2c_enabled"]:
        raise ValueError("Airtime to Cash is not available right now.")
    req.status = "submitted"             # claimed: a second tap on Submit finds it no longer 'verified' and stops here
    await db.commit()

    vtu = get_vtu_provider()
    before = await vtu.wallet_balance()
    try:
        result = await vtu.a2c_submit(network=NETWORK_SLUGS[req.network], phone=req.phone, amount_naira=req.amount_kobo / 100, simpin=simpin,
                                      session_id=req.provider_session, amount_to_receive=req.provider_credit_kobo / 100)
    except VtuError as e:
        if e.ambiguous:
            await _hold_for_review(db, req, f"supplier did not confirm: {e.raw}")
            raise ValueError("We are confirming this with our partner. You will be credited as soon as it is confirmed.")
        req.status, req.failure_reason = "failed", e.raw[:300]
        await db.commit()
        raise ValueError(e.message)
    finally:
        simpin = ""                      # drop our reference at once

    if result["vendStatus"] != "SUCCESS":
        err = classify_failure(200, str(result.get("responseMessage") or ""), purchase=True)
        if err.ambiguous:
            await _hold_for_review(db, req, f"supplier reply unclear: {err.raw}")
            raise ValueError("We are confirming this with our partner. You will be credited as soon as it is confirmed.")
        req.status, req.failure_reason = "failed", err.raw[:300]
        await db.commit()
        raise ValueError("The airtime could not be collected. Please check the PIN and try again.")

    # Success. If the supplier's wallet balance moved by less than we expected, pay out only what actually arrived.
    after = result.get("walletBalance")
    try:
        after = float(after) if after is not None else await vtu.wallet_balance()
    except (TypeError, ValueError):
        after = None
    credit = req.provider_credit_kobo
    if before is not None and after is not None and after - before > 0:
        arrived = int(round((after - before) * 100))
        if arrived < credit - 500:       # more than ₦5 short
            logger.error("[a2c] %s credit arrived %s but expected %s", req.id, arrived, credit)
            try:
                from app.services.alert_service import raise_alert
                await raise_alert(severity="warning", category="bills", dedupe_key=f"a2c:short:{req.id}",
                                  title="Airtime to Cash: the supplier credited less than quoted",
                                  detail={"request_id": str(req.id), "expected_kobo": credit, "arrived_kobo": arrived})
            except Exception:  # noqa: BLE001
                pass
            credit = arrived
    req.provider_reference = str(result.get("transactionReference") or "")[:120] or None
    await _pay_out(db, req, credit, float(cfg["a2c_margin_percent"]))
    return req


async def _hold_for_review(db: AsyncSession, req: AirtimeCashRequest, reason: str) -> None:
    req.status, req.failure_reason = "pending_review", reason[:300]
    await db.commit()
    try:
        from app.services.alert_service import raise_alert
        await raise_alert(severity="warning", category="bills", dedupe_key=f"a2c:review:{req.id}",
                          title="An Airtime to Cash request needs a decision (the supplier's reply was unclear)",
                          detail={"request_id": str(req.id), "network": req.network, "amount_naira": req.amount_kobo / 100})
    except Exception:  # noqa: BLE001
        pass


async def _pay_out(db: AsyncSession, req: AirtimeCashRequest, credit_kobo: int, margin_percent: float, *, actor: uuid.UUID | None = None) -> bool:
    """Credit the customer exactly once. Idempotent: the wallet reference is unique per request."""
    reference = f"A2C-{req.id}"
    already = (await db.execute(select(WalletTransaction.id).where(WalletTransaction.reference == reference))).first()
    if already:
        req.status, req.completed_at = "completed", req.completed_at or datetime.now(timezone.utc)
        await db.commit()
        return False
    payout, fee = split_payout(credit_kobo, margin_percent)
    req.provider_credit_kobo, req.payout_kobo, req.fee_kobo = credit_kobo, payout, fee
    wallet = await get_or_create_wallet(db, req.customer_id)
    await credit_wallet(db, wallet=wallet, amount_kobo=payout, category=TxCategory.AIRTIME_CASH, reference=reference,
                        description=f"Airtime to Cash: ₦{req.amount_kobo / 100:,.0f} {req.network} airtime"[:250],
                        initiated_by=actor or req.customer_id, related_entity_type="airtime_cash", related_entity_id=req.id)
    req.status, req.completed_at = "completed", datetime.now(timezone.utc)
    await db.commit()
    return True


async def director_decide(db: AsyncSession, director: User, request_id: uuid.UUID, approve: bool, note: str | None) -> AirtimeCashRequest:
    """A request the supplier left unclear. Approve ONLY after checking the supplier's own records show the airtime was taken."""
    req = (await db.execute(select(AirtimeCashRequest).where(AirtimeCashRequest.id == request_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if req is None:
        raise ValueError("Request not found.")
    if req.status != "pending_review":
        raise ValueError(f"This request is already {req.status}.")
    cfg = await bill_config.get_bills_config(db)
    req.reviewed_by = director.id
    await log_action(db, actor_id=director.id, action="a2c.approved" if approve else "a2c.rejected", entity_type="airtime_cash", entity_id=str(req.id),
                     new_value={"note": (note or "")[:200], "amount_kobo": req.amount_kobo})
    if approve:
        await _pay_out(db, req, req.provider_credit_kobo, float(cfg["a2c_margin_percent"]), actor=director.id)
    else:
        req.status, req.failure_reason = "rejected", (note or "rejected by director")[:300]
        await db.commit()
    return req
