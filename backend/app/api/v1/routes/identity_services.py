import re
import uuid
import io
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly, CustomerOrOfficer, CustomerOnly
from app.models.identity_service import (
    IdentityService, IdentityServiceRequest, IdentityServiceNotifyRequest,
    IdentityRequestStatus, InitiatedBy,
)
from app.models.user import User
from app.models.wallet import TxCategory
from app.schemas.identity_service import (
    IdentityServiceItem, IdentityServicePriceUpdate, IdentityServiceActiveUpdate,
    IdentityServiceRequestCreate, IdentityServiceRequestItem,
)
from app.services.wallet_service import get_or_create_wallet, debit_wallet
from app.services.verification_reference_pdf import build_verification_reference_pdf
from app.integrations.youverify import call_youverify, YouverifyError
from app.core.security import generate_reference
from app.utils.audit import log_action

router = APIRouter(prefix="/identity-services", tags=["identity-services"])

# Field keys treated as sensitive — masked before ever being written to the
# DB or returned in an API response. Extend this if a new service's
# required_fields introduces another identifier type (e.g. a document number).
_SENSITIVE_KEYS = {"id", "mobile", "registrationNumber", "phone", "bvn", "nin"}
# Response keys dropped entirely, never persisted at all — biometric
# images are the biggest liability in this whole feature if leaked.
_DROP_RESPONSE_KEYS_CONTAINING = ("photo", "image", "base64")
# Response keys masked the same way as request payload keys.
_SENSITIVE_RESPONSE_KEYS = _SENSITIVE_KEYS | {"phoneNumber", "dateOfBirth", "address", "mobile"}


def _mask(value: str) -> str:
    v = str(value)
    if len(v) <= 4:
        return "•" * len(v)
    return f"{v[:4]}{'•' * (len(v) - 8) if len(v) > 8 else '•••'}{v[-4:]}"


def _mask_payload(payload: dict) -> dict:
    return {k: (_mask(v) if k in _SENSITIVE_KEYS and isinstance(v, str) else v) for k, v in payload.items()}


def _summarize_response(raw: dict) -> dict:
    """Provider's raw JSON -> a small, masked, display-safe dict. Never
    store the full provider response as-is — it can carry a base64 photo
    and fields we have no product reason to retain.

    Round 19: this used to drop every nested dict/list outright (e.g. the
    whole `address` block), which meant the customer-facing result was
    reduced to a bare handful of top-level fields — not far off the "just
    returns true/false" experience this was meant to avoid. Nested dicts
    are now walked recursively so real detail (address, validations,
    etc.) survives into what the customer sees and into the reference
    PDF — the photo/image/base64 strip and sensitive-field masking still
    apply at every level, not just the top one. Lists are still dropped:
    provider responses don't put anything customer-relevant in a list at
    any of the services currently wired, and lists are a much easier
    place to accidentally smuggle an unmasked identifier or an image
    array through than a named dict key is."""
    data = raw.get("data", raw) if isinstance(raw, dict) else {}
    return _summarize_value(data) if isinstance(data, dict) else {}


def _summarize_value(data: dict) -> dict:
    summary: dict = {}
    for key, value in data.items():
        lowered = key.lower()
        if any(bad in lowered for bad in _DROP_RESPONSE_KEYS_CONTAINING):
            continue
        if isinstance(value, dict):
            nested = _summarize_value(value)
            if nested:
                summary[key] = nested
            continue
        if isinstance(value, list):
            continue  # see docstring above — lists are dropped, not walked
        if key in _SENSITIVE_RESPONSE_KEYS and isinstance(value, str):
            summary[key] = _mask(value)
        else:
            summary[key] = value
    return summary


# ── Catalog — read (all authenticated roles, so every portal's Quick ──
# Actions grid can check is_active/price before rendering a tile) ──────
@router.get("", response_model=list[IdentityServiceItem])
async def list_services(
    user: CurrentUser,
    category: str | None = Query(None),
    active_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(IdentityService).order_by(IdentityService.category, IdentityService.name)
    if category:
        stmt = stmt.where(IdentityService.category == category)
    if active_only:
        stmt = stmt.where(IdentityService.is_active.is_(True))
    result = await db.execute(stmt)
    return result.scalars().all()


# ── Catalog — director-only pricing & activation control ──────────────
@router.patch("/{service_id}/price", response_model=IdentityServiceItem)
async def update_price(
    service_id: uuid.UUID,
    body: IdentityServicePriceUpdate,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    service = await db.get(IdentityService, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    old_price = service.price_kobo
    service.price_kobo = body.price_kobo
    await db.flush()
    await log_action(
        db, actor_id=director.id, action="identity_service.price_changed",
        entity_type="identity_service", entity_id=str(service.id),
        old_value={"price_kobo": old_price}, new_value={"price_kobo": body.price_kobo},
    )
    await db.commit()
    await db.refresh(service)
    return service


@router.patch("/{service_id}/active", response_model=IdentityServiceItem)
async def update_active(
    service_id: uuid.UUID,
    body: IdentityServiceActiveUpdate,
    director: DirectorOnly,
    db: AsyncSession = Depends(get_db),
):
    service = await db.get(IdentityService, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    old = service.is_active
    service.is_active = body.is_active
    await db.flush()
    await log_action(
        db, actor_id=director.id, action="identity_service.activation_changed",
        entity_type="identity_service", entity_id=str(service.id),
        old_value={"is_active": old}, new_value={"is_active": body.is_active},
    )
    await db.commit()
    await db.refresh(service)
    return service


# ── History — create (customer self-service OR officer-on-behalf-of) ──
@router.post("/requests", response_model=IdentityServiceRequestItem, status_code=201)
async def create_request(
    body: IdentityServiceRequestCreate,
    user: CustomerOrOfficer,
    customer_id: uuid.UUID | None = Query(None, description="Required when an officer is submitting on a customer's behalf"),
    db: AsyncSession = Depends(get_db),
):
    service = await db.get(IdentityService, body.service_id)
    if not service or not service.is_active:
        raise HTTPException(status_code=400, detail="This service isn't available right now.")

    target_customer_id = customer_id if user.role == "officer" else user.id
    if user.role == "officer" and not customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required when an officer submits this on a customer's behalf.")

    missing = [f["key"] for f in service.required_fields if f["required"] and not body.payload.get(f["key"])]
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing required field(s): {', '.join(missing)}")

    # Check funds BEFORE calling the provider — no point spending a paid
    # provider call on a request we can't collect for anyway.
    wallet = await get_or_create_wallet(db, target_customer_id)
    if service.price_kobo > 0 and wallet.balance_kobo < service.price_kobo:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient wallet balance for this service. Available: ₦{wallet.balance_kobo // 100:,}",
        )

    request_row = IdentityServiceRequest(
        service_id=service.id,
        customer_id=target_customer_id,
        initiated_by=InitiatedBy.OFFICER if user.role == "officer" else InitiatedBy.CUSTOMER,
        officer_id=user.id if user.role == "officer" else None,
        status=IdentityRequestStatus.PENDING,
        request_payload=_mask_payload(body.payload),
        amount_charged_kobo=0,  # only set once we actually charge, below
    )
    db.add(request_row)
    await db.flush()  # get request_row.id before the provider call, so it exists even if the call fails

    if service.provider != "youverify":
        # No live integration for this provider yet (e.g. a Tier-2 gated
        # service the director shouldn't have been able to activate, or
        # a future provider like VTpass not wired up yet). Fail closed,
        # don't 500 — the customer still gets a real, viewable request
        # showing exactly why it didn't go through.
        request_row.status = IdentityRequestStatus.FAILED
        request_row.failure_reason = f"No live integration configured for provider '{service.provider}' yet."
        await db.commit()
        await db.refresh(request_row)
        return IdentityServiceRequestItem(**request_row.__dict__, service_name=service.name, service_category=service.category)

    try:
        raw = await call_youverify(service.provider_endpoint, body.payload)
    except YouverifyError as e:
        request_row.status = IdentityRequestStatus.FAILED
        request_row.failure_reason = e.user_message
        await db.commit()
        await db.refresh(request_row)
        await log_action(
            db, actor_id=user.id, action="identity_service_request.provider_failed",
            entity_type="identity_service_request", entity_id=str(request_row.id),
            new_value={"service_code": service.code, "retryable": e.retryable},
        )
        await db.commit()
        return IdentityServiceRequestItem(**request_row.__dict__, service_name=service.name, service_category=service.category)

    # Provider call succeeded (found or not_found — both are a completed
    # lookup and both get charged, same as how the provider charges us).
    reference = generate_reference()
    if service.price_kobo > 0:
        try:
            await debit_wallet(
                db, wallet=wallet, amount_kobo=service.price_kobo, category=TxCategory.CHARGE,
                reference=reference, description=f"{service.name}",
                initiated_by=user.id,
                related_entity_type="identity_service", related_entity_id=request_row.id,
            )
        except HTTPException:
            # Balance changed between our pre-check and now (a race), or
            # the wallet got frozen mid-request. Youverify has already run
            # and returned a result — that cost is on MonieKing here, not
            # left as a stuck 'pending' row or a raw 500 to the customer.
            # The customer still gets a real, viewable, honest outcome.
            request_row.status = IdentityRequestStatus.FAILED
            request_row.failure_reason = (
                "We couldn't complete billing for this request. Please check your wallet balance and try again — "
                "you have not been charged."
            )
            await db.commit()
            await db.refresh(request_row)
            return IdentityServiceRequestItem(**request_row.__dict__, service_name=service.name, service_category=service.category)

    request_row.status = IdentityRequestStatus.COMPLETED
    request_row.response_summary = _summarize_response(raw)
    request_row.amount_charged_kobo = service.price_kobo
    request_row.provider_reference = reference
    request_row.completed_at = datetime.now(timezone.utc)
    await db.flush()

    await log_action(
        db, actor_id=user.id, action="identity_service_request.completed",
        entity_type="identity_service_request", entity_id=str(request_row.id),
        new_value={"service_code": service.code, "amount_charged_kobo": service.price_kobo},
    )
    await db.commit()
    await db.refresh(request_row)

    return IdentityServiceRequestItem(**request_row.__dict__, service_name=service.name, service_category=service.category)


# ── History — list (own history for customers; any customer's for officers/directors) ──
@router.get("/requests", response_model=list[IdentityServiceRequestItem])
async def list_requests(
    user: CurrentUser,
    customer_id: uuid.UUID | None = Query(None),
    category: str | None = Query(None),
    page_size: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    target_id = user.id if user.role == "customer" else (customer_id or user.id)
    stmt = (
        select(IdentityServiceRequest, IdentityService.name, IdentityService.category)
        .join(IdentityService, IdentityService.id == IdentityServiceRequest.service_id)
        .where(IdentityServiceRequest.customer_id == target_id)
        .order_by(IdentityServiceRequest.created_at.desc())
        .limit(page_size)
    )
    if category:
        stmt = stmt.where(IdentityService.category == category)
    rows = (await db.execute(stmt)).all()
    return [
        IdentityServiceRequestItem(**req.__dict__, service_name=name, service_category=cat)
        for req, name, cat in rows
    ]


@router.get("/requests/{request_id}", response_model=IdentityServiceRequestItem)
async def get_request(
    request_id: uuid.UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            select(IdentityServiceRequest, IdentityService.name, IdentityService.category)
            .join(IdentityService, IdentityService.id == IdentityServiceRequest.service_id)
            .where(IdentityServiceRequest.id == request_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    req, name, cat = row
    if user.role == "customer" and req.customer_id != user.id:
        raise HTTPException(status_code=403, detail="Not your request")
    return IdentityServiceRequestItem(**req.__dict__, service_name=name, service_category=cat)


@router.get("/requests/{request_id}/reference.pdf")
async def download_reference_pdf(
    request_id: uuid.UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Downloadable 'MonieKing Verification Reference' PDF for a completed
    request — NOT an official document (see IdentityService.official_document_note,
    rendered into the PDF itself). Built only from response_summary, the same
    masked/photo-stripped dict already shown in the app — never from a raw
    provider response, so this route can't leak more than the app already shows."""
    row = (
        await db.execute(
            select(IdentityServiceRequest, IdentityService)
            .join(IdentityService, IdentityService.id == IdentityServiceRequest.service_id)
            .where(IdentityServiceRequest.id == request_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    req, service = row
    if user.role == "customer" and req.customer_id != user.id:
        raise HTTPException(status_code=403, detail="Not your request")
    if req.status != IdentityRequestStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Only a completed request has a reference to download.")

    customer = await db.get(User, req.customer_id)
    customer_name = customer.full_name if customer else "Unknown customer"

    pdf_bytes = build_verification_reference_pdf(req, service, customer_name)
    filename = f"MonieKing-{service.code}-reference-{str(req.id)[:8]}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Notify me — Coming Soon services, real demand data instead of a guess ──
@router.post("/{service_id}/notify-me", status_code=201)
async def notify_me(
    service_id: uuid.UUID,
    user: CustomerOnly,
    db: AsyncSession = Depends(get_db),
):
    service = await db.get(IdentityService, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    if service.is_active:
        raise HTTPException(status_code=400, detail="This service is already live — no need to be notified.")

    existing = (
        await db.execute(
            select(IdentityServiceNotifyRequest).where(
                IdentityServiceNotifyRequest.service_id == service_id,
                IdentityServiceNotifyRequest.customer_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return {"already_notified": True}

    db.add(IdentityServiceNotifyRequest(service_id=service_id, customer_id=user.id))
    await db.commit()
    return {"already_notified": False}


@router.get("/{service_id}/notify-me/status")
async def get_notify_status(
    service_id: uuid.UUID,
    user: CustomerOnly,
    db: AsyncSession = Depends(get_db),
):
    """So the frontend can show 'You'll be notified' instead of the button
    again after a page reload, without the user having to remember."""
    existing = (
        await db.execute(
            select(IdentityServiceNotifyRequest).where(
                IdentityServiceNotifyRequest.service_id == service_id,
                IdentityServiceNotifyRequest.customer_id == user.id,
            )
        )
    ).scalar_one_or_none()
    return {"already_notified": existing is not None}
