"""Lookup + slip orchestration. Money rules (same as the existing identity
services, tightened):

  * funds are checked BEFORE Techhub is called;
  * the customer wallet is charged only AFTER Techhub returned a usable result;
  * not-found, invalid input, provider outage -> customer is never charged;
  * every charge has a deterministic reference derived from the row id, and the
    row is protected by a unique key, so a retry/double-tap cannot charge twice;
  * stored person data is encrypted and wiped after the retention window.
"""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.techhub import (TechhubError, TechhubInvalidInput, TechhubNotFound, call_techhub)
from app.models.settings import SystemConfig
from app.models.user import User
from app.models.wallet import TxCategory
from app.services.wallet_service import debit_wallet, get_or_create_wallet
from app.utils.audit import log_action
from app.verification import breaker as B
from app.verification import constants as C
from app.verification import crypto
from app.verification import extract as X
from app.verification import settings as S
from app.verification.models import VerificationLookup, VerificationServiceState, VerificationSlip
from app.verification.normalize import InputError, mask_id, mask_name, normalize_inputs
from app.verification.photo import extract_portrait
from app.verification.sheet_pdf import build_sheet_pdf, full_name

logger = logging.getLogger(__name__)

_CRID = re.compile(r"^[A-Za-z0-9_\-]{8,64}$")
UNAVAILABLE_MSG = "This service is temporarily unavailable. You have not been charged."


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── settings ──────────────────────────────────────────────────────────────
async def load_settings(db: AsyncSession) -> S.Settings:
    """Read straight from system_config (no in-process cache) so a director's
    change applies on every worker immediately."""
    rows = (await db.execute(select(SystemConfig).where(SystemConfig.key.in_(S.all_keys())))).scalars().all()
    return S.parse({r.key: r.value for r in rows})


async def save_settings(db: AsyncSession, *, director: User, patch: dict) -> S.Settings:
    current = await load_settings(db)
    try:
        updates = S.validate_update(current, patch)
    except S.SettingsError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if updates.get(C.K_ENABLED) == "true" and not crypto.is_configured():
        raise HTTPException(status_code=422, detail="The encryption key is not set on the server, so this cannot be turned on yet.")
    from app.core.config import settings as env
    if updates.get(C.K_ENABLED) == "true" and not env.TECHHUB_API_KEY:
        raise HTTPException(status_code=422, detail="The Techhub key is not set on the server, so this cannot be turned on yet.")
    existing = {r.key: r for r in (await db.execute(select(SystemConfig).where(SystemConfig.key.in_(list(updates))))).scalars().all()}
    for key, value in updates.items():
        row = existing.get(key)
        if row:
            row.value, row.updated_by = value, director.id
        else:
            db.add(SystemConfig(key=key, value=value, updated_by=director.id))
    await db.flush()
    await log_action(db, actor_id=director.id, action="verification.settings_updated",
                     entity_type="system_config", entity_id="verification",
                     new_value={"keys": sorted(updates)})
    return await load_settings(db)


# ── breaker ───────────────────────────────────────────────────────────────
async def _state_row(db: AsyncSession, kind: str, lock: bool = False) -> VerificationServiceState:
    q = select(VerificationServiceState).where(VerificationServiceState.service == kind)
    if lock:
        q = q.with_for_update().execution_options(populate_existing=True)
    row = (await db.execute(q)).scalar_one_or_none()
    if row is None:
        row = VerificationServiceState(service=kind, failures=0, alerted=False)
        db.add(row)
        await db.flush()
    return row


def _to_breaker(row: VerificationServiceState) -> B.Breaker:
    return B.Breaker(failures=row.failures, opened_at=row.opened_at, last_reason=row.last_reason, alerted=row.alerted)


def _apply(row: VerificationServiceState, b: B.Breaker) -> None:
    row.failures, row.opened_at, row.last_reason, row.alerted = b.failures, b.opened_at, b.last_reason, b.alerted


async def alert_directors(subject: str, body: str) -> None:
    """Best effort email/SMS to the same recipients the system-health monitor uses."""
    try:
        from app.core.config import settings as env
        from app.integrations.email_sender import send_email
        from app.integrations.termii import send_sms
        emails = [e.strip() for e in env.ALERT_EMAIL_TO.split(",") if e.strip()]
        phones = [p.strip() for p in env.ALERT_PHONE_TO.split(",") if p.strip()]
        if emails:
            await send_email(to=emails, subject=subject, body=body)
        for p in phones:
            try:
                await send_sms(p, subject[:300])
            except Exception:
                pass
    except Exception:
        logger.warning("verification alert could not be sent")


async def record_outcome(db: AsyncSession, kind: str, *, ok: bool, reason: str = "") -> None:
    """Update the breaker for `kind` and commit. `ok=True` also for clean
    not-found / invalid-input answers: the provider is healthy."""
    row = await _state_row(db, kind, lock=True)
    b = _to_breaker(row)
    if ok:
        nb, recovered = B.on_success(b)
        _apply(row, nb)
        await db.commit()
        if recovered:
            await alert_directors(f"MonieKing: {kind.upper()} verification has recovered",
                                  f"{kind.upper()} verification is working again and is open to customers.\nTime: {_now().isoformat()}")
        return
    nb, tripped = B.on_failure(b, _now(), reason)
    _apply(row, nb)
    await db.commit()
    if tripped:
        await alert_directors(
            f"MonieKing: {kind.upper()} verification is down ({reason})",
            f"{kind.upper()} verification failed {C.BREAKER_THRESHOLD} times in a row (reason: {reason}). "
            f"Customers now see 'temporarily unavailable' and are not charged. It retests every 5 minutes and "
            f"reopens by itself when Techhub answers again.\nTime: {_now().isoformat()}")


async def service_status(db: AsyncSession, cfg: S.Settings) -> dict:
    """Public status for the lookup screens. `available` is what the UI uses
    to enable/disable the Verify button."""
    from app.core.config import settings as env
    configured = bool(env.TECHHUB_API_KEY) and crypto.is_configured()
    out = {}
    for kind in C.KINDS:
        row = await _state_row(db, kind)
        b = _to_breaker(row)
        fees_ok = all(cfg.fee_for(m) > 0 for m, k in C.METHODS.items() if k == kind)
        available = cfg.enabled and configured and fees_ok and B.allows_call(b, _now())
        out[kind] = {
            "available": available,
            "reason": None if available else ("off" if not cfg.enabled else "unavailable"),
            "retry_at": B.retry_at(b).isoformat() if b.is_open and B.retry_at(b) else None,
        }
    return out


# ── views ─────────────────────────────────────────────────────────────────
def _expired(row: VerificationLookup) -> bool:
    return row.purged_at is not None or (row.expires_at is not None and _now() >= row.expires_at)


def lookup_summary_view(row: VerificationLookup) -> dict:
    return {
        "id": str(row.id), "kind": row.kind, "method": row.method, "status": row.status,
        "failure_reason": row.failure_reason, "fee_kobo": row.fee_kobo,
        "summary": {k: v for k, v in (row.summary or {}).items() if k != "diag"}, "created_at": row.created_at.isoformat() if row.created_at else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "expired": _expired(row), "by_officer": row.officer_id is not None,
    }


async def lookup_full_view(db: AsyncSession, row: VerificationLookup) -> dict:
    """Summary plus, while inside the retention window, the decrypted result."""
    view = lookup_summary_view(row)
    slips = (await db.execute(select(VerificationSlip).where(VerificationSlip.lookup_id == row.id))).scalars().all()
    view["slips"] = sorted(s.tier for s in slips if s.purged_at is None)
    view["result"], view["photo_b64"] = None, None
    if row.status == "found" and not _expired(row) and row.result_enc:
        data = crypto.decrypt_json(row.result_enc)
        if data is not None:
            view["result"] = {k: data.get(k) for k in
                              ("nin", "bvn", "first_name", "middle_name", "last_name", "gender",
                               "date_of_birth", "phone_number", "address")}
            view["result"]["full_name"] = full_name(data)
            if row.photo_enc:
                raw = crypto.decrypt_bytes(row.photo_enc)
                if raw:
                    import base64
                    view["photo_b64"] = base64.b64encode(raw).decode()
    return view


# ── access ────────────────────────────────────────────────────────────────
def can_open(user: User, row: VerificationLookup) -> bool:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role == "customer":
        return row.customer_id == user.id
    if role == "officer":
        return row.officer_id == user.id
    return False


async def get_lookup_for(db: AsyncSession, user: User, lookup_id: uuid.UUID, *, lock: bool = False) -> VerificationLookup:
    q = select(VerificationLookup).where(VerificationLookup.id == lookup_id)
    if lock:
        q = q.with_for_update().execution_options(populate_existing=True)
    row = (await db.execute(q)).scalar_one_or_none()
    if row is None or not can_open(user, row):
        raise HTTPException(status_code=404, detail="Not found.")
    return row


# ── lookup ────────────────────────────────────────────────────────────────
async def create_lookup(db: AsyncSession, *, actor: User, customer_id: uuid.UUID, method: str, fields: dict,
                        consent: bool, client_request_id: str) -> dict:
    cfg = await load_settings(db)
    if not cfg.enabled:
        raise HTTPException(status_code=400, detail="This service isn't available right now.")
    if method not in C.METHODS:
        raise HTTPException(status_code=422, detail="Unknown verification method.")
    kind = C.METHODS[method]
    if not consent:
        raise HTTPException(status_code=422, detail="Consent is required before a check can be run.")
    if not _CRID.match(client_request_id or ""):
        raise HTTPException(status_code=422, detail="Invalid request id.")
    try:
        normalized = normalize_inputs(method, fields)
    except InputError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Replay of the same tap: hand back the stored outcome, never a second charge.
    prior = (await db.execute(select(VerificationLookup).where(
        VerificationLookup.initiated_by_id == actor.id,
        VerificationLookup.client_request_id == client_request_id))).scalar_one_or_none()
    if prior is not None:
        return await lookup_full_view(db, prior)

    fee = cfg.fee_for(method)
    if fee <= 0 or not crypto.is_configured():
        raise HTTPException(status_code=503, detail=UNAVAILABLE_MSG)

    st = await _state_row(db, kind)
    if not B.allows_call(_to_breaker(st), _now()):
        raise HTTPException(status_code=503, detail=UNAVAILABLE_MSG)

    wallet = await get_or_create_wallet(db, customer_id)
    if wallet.balance_kobo < fee:
        raise HTTPException(status_code=400, detail=f"Insufficient wallet balance. Available: ₦{wallet.balance_kobo // 100:,}")

    tier = C.DEMOGRAPHIC_TIER if method == "demographic" else cfg.lookup_tier[kind]
    endpoint = C.ENDPOINTS.get((method, tier))
    if endpoint is None:
        raise HTTPException(status_code=503, detail=UNAVAILABLE_MSG)

    is_officer = (actor.role.value if hasattr(actor.role, "value") else str(actor.role)) == "officer"
    row = VerificationLookup(
        id=uuid.uuid4(), kind=kind, method=method, customer_id=customer_id, initiated_by_id=actor.id,
        officer_id=actor.id if is_officer else None, client_request_id=client_request_id,
        status="pending", tier_used=tier, fee_kobo=0, consent_at=_now(),
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(VerificationLookup).where(
            VerificationLookup.initiated_by_id == actor.id,
            VerificationLookup.client_request_id == client_request_id))).scalar_one()
        return await lookup_full_view(db, prior)

    try:
        result = await call_techhub(endpoint, normalized)
    except TechhubNotFound:
        await record_outcome(db, kind, ok=True)
        row = await db.get(VerificationLookup, row.id)
        row.status, row.completed_at = "not_found", _now()
        row.summary = {"method": method}
        await db.commit()
        return await lookup_full_view(db, row)
    except TechhubInvalidInput as e:
        await record_outcome(db, kind, ok=True)
        row = await db.get(VerificationLookup, row.id)
        row.status, row.failure_reason, row.completed_at = "failed", e.user_message, _now()
        await db.commit()
        return await lookup_full_view(db, row)
    except TechhubError as e:
        if e.counts_as_failure:
            await record_outcome(db, kind, ok=False, reason=e.reason)
        row = await db.get(VerificationLookup, row.id)
        row.status, row.failure_reason, row.completed_at = "failed", e.user_message, _now()
        await db.commit()
        return await lookup_full_view(db, row)

    id_key = "nin" if kind == "nin" else "bvn"
    person = X.complete(result.user_data, result.pdf, id_key=id_key, requested_id=str(normalized.get(id_key) or ""))
    if not X.has_identity(person):
        # Techhub answered "success" but nothing we can read as a person. Never charge for that,
        # and log key NAMES only so the field mapping can be corrected without seeing any data.
        names = X.key_names(result.user_data)
        logger.warning("verification unreadable result kind=%s method=%s keys=%s pdf=%s", kind, method, names, bool(result.pdf))
        await record_outcome(db, kind, ok=False, reason="unreadable_result")
        row = await db.get(VerificationLookup, row.id)
        row.status, row.completed_at = "failed", _now()
        row.failure_reason = UNAVAILABLE_MSG
        row.summary = {"method": method, "diag": {"keys": names, "had_pdf": bool(result.pdf)}}
        await db.commit()
        return await lookup_full_view(db, row)
    await record_outcome(db, kind, ok=True)
    row = await db.get(VerificationLookup, row.id)
    result.user_data = person
    photo = X.photo_from_data(result.user_data) or await asyncio.to_thread(extract_portrait, result.pdf)
    ident = str(person.get(id_key) or "")
    reference = f"VF-{row.id.hex}"
    wallet = await get_or_create_wallet(db, customer_id)
    try:
        await debit_wallet(
            db, wallet=wallet, amount_kobo=fee, category=TxCategory.CHARGE, reference=reference,
            description=f"{kind.upper()} verification", initiated_by=actor.id,
            related_entity_type=C.ENTITY_LOOKUP, related_entity_id=row.id,
        )
    except HTTPException:
        # Balance changed during the call (or wallet frozen). Nothing stored, nothing charged.
        await db.rollback()
        row = await db.get(VerificationLookup, row.id)
        row.status, row.completed_at = "failed", _now()
        row.failure_reason = "We couldn't complete billing for this check. You have not been charged."
        await db.commit()
        return await lookup_full_view(db, row)

    row.status, row.fee_kobo, row.fee_reference = "found", fee, reference
    row.completed_at = _now()
    row.expires_at = row.completed_at + timedelta(hours=cfg.retention_hours)
    row.result_enc = crypto.encrypt_json(result.user_data)
    row.pdf_enc = crypto.encrypt_bytes(result.pdf) if result.pdf else None
    row.photo_enc = crypto.encrypt_bytes(photo) if photo else None
    row.summary = {"method": method, "name": mask_name(full_name(result.user_data)), "id_masked": mask_id(ident)}
    await log_action(db, actor_id=actor.id, action="verification.lookup_completed",
                     entity_type="verification_lookup", entity_id=str(row.id),
                     new_value={"kind": kind, "method": method, "customer_id": str(customer_id),
                                "officer_id": str(row.officer_id) if row.officer_id else None, "fee_kobo": fee})
    await db.commit()
    return await lookup_full_view(db, row)


# ── slips ─────────────────────────────────────────────────────────────────
async def buy_slip(db: AsyncSession, *, actor: User, lookup_id: uuid.UUID, tier: str) -> dict:
    cfg = await load_settings(db)
    row = await get_lookup_for(db, actor, lookup_id, lock=True)
    if tier not in C.TIERS_BY_KIND[row.kind]:
        raise HTTPException(status_code=422, detail="Unknown slip type.")
    if row.status != "found" or _expired(row) or not row.result_enc:
        raise HTTPException(status_code=410, detail="This result has expired. Please run the check again.")

    have = (await db.execute(select(VerificationSlip).where(
        VerificationSlip.lookup_id == row.id, VerificationSlip.tier == tier))).scalar_one_or_none()
    if have is not None and have.purged_at is None:
        return {"tier": tier, "already_owned": True, "price_kobo": 0}

    price = cfg.slip_price(row.kind, tier)
    if price <= 0:
        raise HTTPException(status_code=400, detail="This slip isn't available right now.")

    wallet = await get_or_create_wallet(db, row.customer_id)
    if wallet.balance_kobo < price:
        raise HTTPException(status_code=400, detail=f"Insufficient wallet balance. Available: ₦{wallet.balance_kobo // 100:,}")

    pdf_enc = None
    if tier != row.tier_used or not row.pdf_enc:
        if not crypto.is_configured():
            raise HTTPException(status_code=503, detail=UNAVAILABLE_MSG)
        st = await _state_row(db, row.kind)
        if not B.allows_call(_to_breaker(st), _now()):
            raise HTTPException(status_code=503, detail=UNAVAILABLE_MSG)
        data = crypto.decrypt_json(row.result_enc) or {}
        ident = str(data.get("nin" if row.kind == "nin" else "bvn") or "")
        endpoint = C.ENDPOINTS.get(("nin" if row.kind == "nin" else "bvn", tier))
        if not ident or not endpoint:
            raise HTTPException(status_code=503, detail=UNAVAILABLE_MSG)
        try:
            res = await call_techhub(endpoint, {("nin" if row.kind == "nin" else "bvn"): ident})
        except TechhubError as e:
            if e.counts_as_failure:
                await record_outcome(db, row.kind, ok=False, reason=e.reason)
                row = await get_lookup_for(db, actor, lookup_id, lock=True)
            raise HTTPException(status_code=503 if e.counts_as_failure else 422, detail=e.user_message)
        await record_outcome(db, row.kind, ok=True)
        row = await get_lookup_for(db, actor, lookup_id, lock=True)
        if not res.pdf:
            raise HTTPException(status_code=503, detail="This slip couldn't be prepared right now. You have not been charged.")
        pdf_enc = crypto.encrypt_bytes(res.pdf)

    # record_outcome() commits (and so releases the lock) — re-check ownership
    # after re-locking so a parallel purchase of this tier is never charged twice.
    have = (await db.execute(select(VerificationSlip).where(
        VerificationSlip.lookup_id == row.id, VerificationSlip.tier == tier))).scalar_one_or_none()
    if have is not None and have.purged_at is None:
        return {"tier": tier, "already_owned": True, "price_kobo": 0}

    slip_id = uuid.uuid4()
    reference = f"VS-{slip_id.hex}"
    wallet = await get_or_create_wallet(db, row.customer_id)
    await debit_wallet(
        db, wallet=wallet, amount_kobo=price, category=TxCategory.CHARGE, reference=reference,
        description=f"{row.kind.upper()} {tier} slip", initiated_by=actor.id,
        related_entity_type=C.ENTITY_SLIP, related_entity_id=slip_id,
    )
    if have is not None:   # purged earlier slip of this tier being re-bought: reuse the row
        have.pdf_enc, have.purged_at, have.price_kobo, have.reference = pdf_enc, None, price, reference
    else:
        db.add(VerificationSlip(id=slip_id, lookup_id=row.id, tier=tier, price_kobo=price, reference=reference, pdf_enc=pdf_enc))
    await log_action(db, actor_id=actor.id, action="verification.slip_purchased",
                     entity_type="verification_lookup", entity_id=str(row.id),
                     new_value={"tier": tier, "price_kobo": price})
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()   # the debit rolls back with it: no double charge
        return {"tier": tier, "already_owned": True, "price_kobo": 0}
    return {"tier": tier, "already_owned": False, "price_kobo": price}


async def slip_pdf(db: AsyncSession, *, actor: User, lookup_id: uuid.UUID, tier: str) -> bytes:
    row = await get_lookup_for(db, actor, lookup_id)
    slip = (await db.execute(select(VerificationSlip).where(
        VerificationSlip.lookup_id == row.id, VerificationSlip.tier == tier))).scalar_one_or_none()
    if slip is None:
        raise HTTPException(status_code=402, detail="Buy this slip first.")
    if _expired(row) or slip.purged_at is not None:
        raise HTTPException(status_code=410, detail="This slip has expired. Please run the check again.")
    blob = slip.pdf_enc or row.pdf_enc
    pdf = crypto.decrypt_bytes(blob) if blob else None
    if pdf is None:
        raise HTTPException(status_code=410, detail="This slip is no longer available.")
    return pdf


async def sheet_pdf(db: AsyncSession, *, actor: User, lookup_id: uuid.UUID, reveal: bool) -> bytes:
    row = await get_lookup_for(db, actor, lookup_id)
    if row.status != "found" or _expired(row) or not row.result_enc:
        raise HTTPException(status_code=410, detail="This result has expired. Please run the check again.")
    data = crypto.decrypt_json(row.result_enc)
    if data is None:
        raise HTTPException(status_code=410, detail="This result is no longer available.")
    photo = crypto.decrypt_bytes(row.photo_enc) if row.photo_enc else None
    return await asyncio.to_thread(
        build_sheet_pdf, kind=row.kind, data=data, photo_jpeg=photo,
        reference=f"MK-VF-{row.id.hex[:12].upper()}", verified_at=row.completed_at or row.created_at, reveal_id=reveal)


async def list_lookups(db: AsyncSession, *, actor: User, customer_id: uuid.UUID | None, limit: int, kind: str | None) -> list[dict]:
    role = actor.role.value if hasattr(actor.role, "value") else str(actor.role)
    target = actor.id if role == "customer" else customer_id
    if target is None:
        raise HTTPException(status_code=400, detail="customer_id is required.")
    q = select(VerificationLookup).where(VerificationLookup.customer_id == target)
    if kind in C.KINDS:
        q = q.where(VerificationLookup.kind == kind)
    q = q.where(VerificationLookup.status != "pending").order_by(VerificationLookup.created_at.desc()).limit(limit)
    return [lookup_summary_view(r) for r in (await db.execute(q)).scalars().all()]


# ── retention sweep ───────────────────────────────────────────────────────
async def purge_expired(db: AsyncSession) -> dict:
    now = _now()
    wiped = await db.execute(
        update(VerificationLookup)
        .where(VerificationLookup.expires_at <= now, VerificationLookup.purged_at.is_(None))
        .values(result_enc=None, pdf_enc=None, photo_enc=None, purged_at=now))
    ids = select(VerificationLookup.id).where(VerificationLookup.purged_at.is_not(None))
    await db.execute(update(VerificationSlip).where(VerificationSlip.lookup_id.in_(ids), VerificationSlip.purged_at.is_(None))
                     .values(pdf_enc=None, purged_at=now))
    stuck = await db.execute(
        update(VerificationLookup)
        .where(VerificationLookup.status == "pending", VerificationLookup.created_at <= now - timedelta(minutes=15))
        .values(status="failed", failure_reason="This check did not finish. You have not been charged.", completed_at=now))
    await db.commit()
    return {"purged": wiped.rowcount or 0, "stuck_closed": stuck.rowcount or 0}
