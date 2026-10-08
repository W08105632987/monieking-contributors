"""
Manual Services Routes
======================
Customer-facing endpoints for submitting manual service requests
(NIN modification, BVN, TIN, CAC, Attestation, etc.)
that enter the Service Worker job pool.
"""
import uuid
from datetime import datetime, timezone
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import CurrentUser, CustomerOrOfficer, DirectorOrAdmin
from app.core.security import generate_reference
from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus
from app.models.wallet import TxCategory
from app.models.user import User, UserRole
from app.models.settings import SystemConfig
from app.models.notification import NotificationType
from app.services.notification_service import send_notification
from app.services.settings_service import get_config_value, invalidate_config_cache
from app.services.manual_pricing import (
    get_price,
    merge_price_map,
    is_known_category,
    resolve_category,
    effective_cover_labels,
    normalize_pricing_update,
)
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.services import service_template_engine as tpl_engine
from app.services.service_template_submit import prepare_submission
from app.services.wallet_service import get_or_create_wallet, debit_wallet
from app.services.withdrawal_auth_service import check_withdrawal_password
from app.utils.supabase_admin_client import supabase_admin_request

settings = get_settings()
router = APIRouter(prefix="/manual-services", tags=["manual-services"])


# ─── Pricing ──────────────────────────────────────────────────────────────────
# The price table and the price lookup now live in app/services/manual_pricing.py
# so the charge, the quote endpoint and the director screen all use one source.
# (_get_price is kept as an alias for any code that still imports the old name.)
_get_price = get_price


async def _get_current_price_map(db: AsyncSession) -> dict[str, dict[str, int]]:
    return merge_price_map(await get_config_value(db, "manual_services_pricing"))


LIVE_TEMPLATES_KEY = "service_templates_live"


async def _live_template_codes(db: AsyncSession) -> set[str]:
    """Services the director/ops have switched to the template flow (empty = none, i.e. today's behaviour)."""
    raw = await get_config_value(db, LIVE_TEMPLATES_KEY)
    if not raw:
        return set()
    try:
        data = json.loads(raw)
    except Exception:
        return set()
    return {str(c) for c in data} if isinstance(data, list) else set()


async def _get_template(
    db: AsyncSession, category: str,
) -> tuple[ServiceTemplate, ServiceTemplateVersion] | None:
    """The template (and its published version) for a service, if one exists. Read straight from the
    database every time, so the director's on/off switch takes effect immediately."""
    tpl = await db.scalar(select(ServiceTemplate).where(ServiceTemplate.service_code == category))
    if not tpl or not tpl.current_version_id:
        return None
    ver = await db.get(ServiceTemplateVersion, tpl.current_version_id)
    return (tpl, ver) if ver else None


def _assert_available(tpl: ServiceTemplate) -> None:
    if tpl.archived_at is not None or not tpl.is_enabled:
        raise HTTPException(status_code=400, detail="This service is switched off right now. Please check back later.")


async def _quote_price(
    db: AsyncSession,
    category: str,
    service_type: str,
    enrollment_bank: str | None = None,
    bulk_count: int = 1,
) -> int:
    """The ONE place that decides what a request costs. Used by the charge and
    by the quote endpoint, so the amount a customer is shown is the amount they
    are charged. Refuses unknown services, switched-off services and non-positive
    prices instead of silently treating them as free."""
    category = resolve_category(category)
    found = await _get_template(db, category)
    if found:
        _assert_available(found[0])
    if found and category in await _live_template_codes(db):
        selections = {"service_type": service_type, "enrollment_bank": enrollment_bank}
        fixed = found[1].schema.get("fixed_service_type")
        if fixed:
            selections["service_type"] = fixed
        try:
            price_kobo = tpl_engine.compute_price(found[1].price_rules, selections, bulk_count)
        except tpl_engine.NoPriceError:
            raise HTTPException(status_code=400, detail="This option has no price set yet, so it can't be ordered.")
        if price_kobo <= 0:
            raise HTTPException(status_code=400, detail="This service has no price set yet, so it can't be ordered. Please try again later.")
        return price_kobo

    price_map = await _get_current_price_map(db)
    if not is_known_category(category, price_map):
        raise HTTPException(status_code=400, detail="This service isn't available right now.")
    price_kobo = get_price(
        category,
        service_type,
        enrollment_bank=enrollment_bank,
        bulk_count=bulk_count,
        custom_map=price_map,
    )
    if price_kobo <= 0:
        raise HTTPException(
            status_code=400,
            detail="This service has no price set yet, so it can't be ordered. Please try again later.",
        )
    return price_kobo


def _has_content(form_data: dict | None) -> bool:
    """True if at least one field actually holds a value."""
    return any(v not in (None, "", [], {}) for v in (form_data or {}).values())


# ─── Schemas ──────────────────────────────────────────────────────────────────

class SubmitServiceRequest(BaseModel):
    service_category:   str = Field(..., description="e.g. nin_modification, bvn_retrieval")
    service_type:       str = Field(..., description="e.g. update_name, phone_number")
    form_data:          dict = Field(default_factory=dict, description="All form fields")
    uploaded_files:     list = Field(default_factory=list, description="Uploaded document URLs or base64 files")
    consent_given:      bool = Field(..., description="Explicit user consent required")
    referred_worker_id: str | None = Field(None, description="Optional Service Worker referral code or ID")
    transaction_pin:    str | None = Field(None, description="User transaction PIN")
    withdrawal_password: str | None = Field(None, description="User withdrawal password")
    enrollment_bank:    str | None = Field(None, description="Bank for BVN modification")
    bulk_count:         int = Field(1, description="Number of items for bulk services")
    template_version_id: str | None = Field(None, description="Version of the service template the customer was shown")


class FileUploadRequest(BaseModel):
    filename:    str = Field(..., description="Original filename")
    file_base64: str = Field(..., description="Base64 encoded data (data:image/jpeg;base64,...)")


def _serialize(req: ManualServiceRequest) -> dict:
    return {
        "id":              str(req.id),
        "service_category": req.service_category,
        "service_type":    req.service_type,
        "price_kobo":      req.price_kobo,
        "status":          req.status.value if hasattr(req.status, "value") else req.status,
        "consent_given":   req.consent_given,
        "worker_status":   req.worker_status,
        "worker_response": req.worker_response,
        "worker_remarks":  req.worker_remarks,
        "worker_additional_info": req.worker_additional_info,
        "worker_result_file_url": req.worker_result_file_url,
        "worker_commission_kobo": req.worker_commission_kobo,
        "form_data":       req.form_data or {},
        "uploaded_files":  req.uploaded_files or [],
        "claimed_at":      req.claimed_at.isoformat() if req.claimed_at else None,
        "expires_at":      req.expires_at.isoformat() if req.expires_at else None,
        "completed_at":    req.completed_at.isoformat() if req.completed_at else None,
        "created_at":      req.created_at.isoformat(),
        "updated_at":      req.updated_at.isoformat() if req.updated_at else None,
    }


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_document(
    body: FileUploadRequest,
    current_user: CurrentUser,
):
    """
    Upload a document (ID, photo, CAC certificate, affidavit, screenshot)
    to Supabase Storage and return the public URL.
    """
    import base64
    data_url = body.file_base64
    if not data_url or "base64," not in data_url:
        raise HTTPException(status_code=400, detail="Invalid file data")

    header, encoded = data_url.split("base64,", 1)
    content_type = "image/jpeg"
    ext = "jpg"
    if "png" in header:
        content_type = "image/png"
        ext = "png"
    elif "webp" in header:
        content_type = "image/webp"
        ext = "webp"
    elif "pdf" in header:
        content_type = "application/pdf"
        ext = "pdf"

    try:
        file_bytes = base64.b64decode(encoded)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode file data")

    if len(file_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    storage_filename = f"manual_{current_user.id}_{uuid.uuid4().hex[:8]}.{ext}"

    try:
        await supabase_admin_request(
            "POST",
            f"/storage/v1/object/avatars/{storage_filename}",
            content=file_bytes,
            extra_headers={"Content-Type": content_type, "x-upsert": "true"},
            failure_detail="Could not upload file — please try again",
        )
        url = f"{settings.SUPABASE_URL}/storage/v1/object/public/avatars/{storage_filename}"
    except Exception:
        # Fallback to serving the data url if storage request fails
        url = data_url

    return {"url": url, "filename": body.filename}


@router.post("", status_code=201)
async def submit_service_request(
    body: SubmitServiceRequest,
    current_user: CustomerOrOfficer,
    customer_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit a new manual service request. The request enters the job pool
    immediately as 'pending' and can be claimed by a Service Worker.
    Debits the customer's wallet atomically for the service cost.
    """
    if not body.consent_given:
        raise HTTPException(
            status_code=400,
            detail="You must give explicit consent before submitting this service request."
        )

    target_user_id = current_user.id
    if customer_id and current_user.role == UserRole.OFFICER:
        target_user_id = customer_id

    # Validate Withdrawal Password (or legacy PIN) if set
    pwd = body.withdrawal_password or body.transaction_pin
    user_row = await db.get(User, current_user.id)
    if user_row and user_row.has_withdrawal_password:
        if not pwd:
            raise HTTPException(
                status_code=400,
                detail="Your withdrawal password is required to authorise this service request."
            )
        await check_withdrawal_password(db, user_row, pwd)

    # Guards run BEFORE any money moves.
    category = resolve_category(body.service_category)
    found = await _get_template(db, category)
    live = bool(found) and category in await _live_template_codes(db)
    template_version_id: uuid.UUID | None = None
    prepared_form: dict | None = None
    service_type = body.service_type
    enrollment_bank = body.enrollment_bank
    uploaded_files = body.uploaded_files

    if live:
        tpl, ver = found
        _assert_available(tpl)
        if body.template_version_id and body.template_version_id != str(ver.id):
            raise HTTPException(
                status_code=409,
                detail="This service was just updated. Please reload the page and fill it in again.",
            )
        # referral info is added by the app next to the form's own fields; keep it out of validation
        carried = {k: v for k, v in (body.form_data or {}).items() if k in ("referral_code", "referred_worker")}
        prepared = prepare_submission(
            ver.schema, ver.price_rules,
            service_type=body.service_type, enrollment_bank=body.enrollment_bank,
            form_data={k: v for k, v in (body.form_data or {}).items() if k not in carried},
        )
        if prepared.errors:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Please correct the form: " + " ".join(prepared.errors[:6]),
                    "errors": prepared.errors,
                },
            )
        price_kobo = prepared.price_kobo
        prepared_form = {**prepared.form_data, **carried}
        service_type = prepared.service_type
        enrollment_bank = prepared.enrollment_bank
        uploaded_files = prepared.uploaded_files
        template_version_id = ver.id
    else:
        if not _has_content(body.form_data) and not body.uploaded_files:
            raise HTTPException(status_code=400, detail="Please fill in the form before submitting.")
        price_kobo = await _quote_price(
            db,
            body.service_category,
            body.service_type,
            enrollment_bank=body.enrollment_bank,
            bulk_count=body.bulk_count,
        )

    # Wallet balance verification & atomic debit
    # req_id generated up front (not after the ManualServiceRequest insert
    # below) so the debit's related_entity_id can point at it from the
    # start — same reasoning as the withdrawal_id fix in wallets.py.
    req_id = uuid.uuid4()
    if price_kobo > 0:
        wallet = await get_or_create_wallet(db, target_user_id)
        if wallet.balance_kobo < price_kobo:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient wallet balance. Required: ₦{price_kobo // 100:,.2f}, Available: ₦{wallet.balance_kobo // 100:,.2f}",
            )
        await debit_wallet(
            db,
            wallet=wallet,
            amount_kobo=price_kobo,
            category=TxCategory.CHARGE,
            reference=generate_reference(),
            description=f"Manual Service: {body.service_category.replace('_', ' ').title()}",
            initiated_by=current_user.id,
            related_entity_type="manual_service_request",
            related_entity_id=req_id,
        )

    # Resolve referred worker
    referred_worker_id: uuid.UUID | None = None
    if body.referred_worker_id:
        raw_val = str(body.referred_worker_id).strip()
        worker = await db.scalar(
            select(User).where(
                (User.referral_code == raw_val.upper()) | (User.phone_number == raw_val),
                User.role == UserRole.SERVICE_WORKER,
            )
        )
        if not worker:
            try:
                wid = uuid.UUID(raw_val)
                worker = await db.scalar(
                    select(User).where(User.id == wid, User.role == UserRole.SERVICE_WORKER)
                )
            except ValueError:
                pass
        if worker:
            referred_worker_id = worker.id

    req_form_data = dict(prepared_form if prepared_form is not None else (body.form_data or {}))
    if customer_id and current_user.role == UserRole.OFFICER:
        req_form_data["submitted_by_officer_id"] = str(current_user.id)

    req = ManualServiceRequest(
        id=req_id,
        user_id=target_user_id,
        service_category=body.service_category,
        service_type=service_type,
        form_data=req_form_data,
        uploaded_files=uploaded_files,
        template_version_id=template_version_id,
        price_kobo=price_kobo,
        consent_given=body.consent_given,
        referred_worker_id=referred_worker_id,
        status=ManualServiceStatus.PENDING,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    # Immediately notify referred worker if referral code was used
    if referred_worker_id:
        category_title = req.service_category.replace("_", " ").title()
        try:
            await send_notification(
                db,
                user_id=referred_worker_id,
                title="New Referred Job Waiting",
                body=f"A customer submitted a {category_title} request using your referral code. Claim it before the hold expires!",
                type=NotificationType.INFO,
                related_entity_id=req.id,
            )
            await db.commit()
        except Exception:
            pass

    return {
        "request": _serialize(req),
        "id": str(req.id),
        "message": "Your service request has been submitted and is awaiting a service worker.",
        "price_kobo": price_kobo,
    }


@router.get("/my-requests")
async def list_my_requests(
    current_user: CurrentUser,
    service_status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Customer sees their own service request history."""
    q = select(ManualServiceRequest).where(
        ManualServiceRequest.user_id == current_user.id
    )
    if service_status:
        q = q.where(ManualServiceRequest.status == service_status)
    q = q.order_by(ManualServiceRequest.created_at.desc())

    total = await db.scalar(
        select(func.count()).select_from(ManualServiceRequest).where(
            ManualServiceRequest.user_id == current_user.id
        )
    ) or 0

    offset = (page - 1) * page_size
    rows = (await db.scalars(q.offset(offset).limit(page_size))).all()
    return {"data": [_serialize(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/my-requests/{request_id}")
async def get_my_request(
    request_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get detailed view of a single service request."""
    req = await db.scalar(
        select(ManualServiceRequest).where(
            ManualServiceRequest.id == request_id
        )
    )
    if not req:
        raise HTTPException(status_code=404, detail="Service request not found.")

    is_owner = req.user_id == current_user.id
    is_submitter_officer = (req.form_data or {}).get("submitted_by_officer_id") == str(current_user.id)
    is_director = current_user.role in (UserRole.DIRECTOR, UserRole.ADMIN)

    if not (is_owner or is_submitter_officer or is_director):
        raise HTTPException(status_code=403, detail="Access denied.")

    return _serialize(req)


@router.get("/officer-requests")
async def list_officer_requests(
    current_user: CurrentUser,
    service_status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Officer sees requests they submitted on customers' behalf."""
    if current_user.role not in (UserRole.OFFICER, UserRole.DIRECTOR, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="Officers and Directors only")

    from sqlalchemy import cast, String
    officer_str = str(current_user.id)
    # Search in JSONB form_data
    q = select(ManualServiceRequest).where(
        cast(ManualServiceRequest.form_data["submitted_by_officer_id"], String) == f'"{officer_str}"'
    )
    if service_status:
        q = q.where(ManualServiceRequest.status == service_status)
    q = q.order_by(ManualServiceRequest.created_at.desc())

    total = await db.scalar(
        select(func.count()).select_from(ManualServiceRequest).where(
            cast(ManualServiceRequest.form_data["submitted_by_officer_id"], String) == f'"{officer_str}"'
        )
    ) or 0

    offset = (page - 1) * page_size
    rows = (await db.scalars(q.offset(offset).limit(page_size))).all()
    return {"data": [_serialize(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/validate-referral/{code}")
async def validate_referral_code(
    code: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Validate a referral code or phone number and return the worker's name without throwing 404."""
    clean_code = code.strip().upper()
    raw_code = code.strip()
    worker = await db.scalar(
        select(User).where(
            (User.referral_code == clean_code) | (User.phone_number == raw_code),
            User.role == UserRole.SERVICE_WORKER,
        )
    )
    if not worker:
        return {
            "valid": False,
            "message": "No verified Service Worker found with this referral code or phone number.",
        }
    return {
        "valid": True,
        "worker_name": worker.full_name,
        "worker_id": str(worker.id),
        "phone_number": worker.phone_number,
        "referral_code": worker.referral_code,
    }


async def _get_stored_cover_labels(db: AsyncSession) -> dict[str, str]:
    """Only labels a director explicitly typed (may be empty)."""
    val = await get_config_value(db, "manual_services_cover_labels")
    if not val:
        return {}
    try:
        custom = json.loads(val) if isinstance(val, str) else val
    except Exception:
        return {}
    return {k: v for k, v in custom.items() if isinstance(v, str)} if isinstance(custom, dict) else {}


# ─── Quote ────────────────────────────────────────────────────────────────────

@router.get("/quote")
async def quote_manual_service(
    current_user: CurrentUser,
    service_category: str,
    service_type: str,
    enrollment_bank: str | None = None,
    bulk_count: int = Query(1, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """The exact amount that would be charged right now. Uses the same function
    as the charge, so what the screen shows is what the wallet is debited."""
    price_kobo = await _quote_price(
        db, service_category, service_type,
        enrollment_bank=enrollment_bank, bulk_count=bulk_count,
    )
    return {"price_kobo": price_kobo}


# ─── Director Pricing Oversight ───────────────────────────────────────────────

@router.get("/pricing")
async def get_manual_services_pricing(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Return all manual service categories and their child category prices and cover card labels."""
    price_map = await _get_current_price_map(db)
    stored = await _get_stored_cover_labels(db)
    return {"pricing": price_map, "cover_labels": effective_cover_labels(price_map, stored)}


@router.patch("/pricing")
async def update_manual_services_pricing(
    body: dict[str, Any],
    current_user: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """
    Director updates child category prices and/or cover card labels.
    Accepts:
      { "pricing": { "nin_modification": { "update_name": 500000 } },
        "cover_labels": { "nin_modification": "From ₦7,000" } }
      or direct { "nin_modification": { ... } }
    An empty label removes the override (the card then shows the live "From ₦X").
    """
    incoming_pricing = body.get("pricing") if "pricing" in body or "cover_labels" in body else body
    incoming_labels = body.get("cover_labels")

    current_pricing = await _get_current_price_map(db)
    if incoming_pricing and isinstance(incoming_pricing, dict):
        try:
            clean = normalize_pricing_update(incoming_pricing)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        for cat, sub in clean.items():
            current_pricing.setdefault(cat, {}).update(sub)

        cfg = await db.get(SystemConfig, "manual_services_pricing")
        if not cfg:
            cfg = SystemConfig(
                key="manual_services_pricing",
                value=json.dumps(current_pricing),
                description="Manual services child pricing tiers",
                updated_by=current_user.id,
            )
            db.add(cfg)
        else:
            cfg.value = json.dumps(current_pricing)
            cfg.updated_at = datetime.now(timezone.utc)
            cfg.updated_by = current_user.id

    stored_labels = await _get_stored_cover_labels(db)
    if incoming_labels and isinstance(incoming_labels, dict):
        for k, v in incoming_labels.items():
            if isinstance(v, str) and v.strip():
                stored_labels[k] = v.strip()
            else:
                stored_labels.pop(k, None)
        label_cfg = await db.get(SystemConfig, "manual_services_cover_labels")
        if not label_cfg:
            label_cfg = SystemConfig(
                key="manual_services_cover_labels",
                value=json.dumps(stored_labels),
                description="Manual services cover card labels",
                updated_by=current_user.id,
            )
            db.add(label_cfg)
        else:
            label_cfg.value = json.dumps(stored_labels)
            label_cfg.updated_at = datetime.now(timezone.utc)
            label_cfg.updated_by = current_user.id

    await db.commit()
    invalidate_config_cache("manual_services_pricing")
    invalidate_config_cache("manual_services_cover_labels")
    return {
        "pricing": current_pricing,
        "cover_labels": effective_cover_labels(current_pricing, stored_labels),
        "message": "Pricing tiers and cover card labels updated successfully.",
    }
