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

from fastapi import APIRouter, Depends, HTTPException, status
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
from app.services.wallet_service import get_or_create_wallet, debit_wallet
from app.services.withdrawal_auth_service import check_withdrawal_password
from app.utils.supabase_admin_client import supabase_admin_request

settings = get_settings()
router = APIRouter(prefix="/manual-services", tags=["manual-services"])


# ─── Pricing constants (in kobo) ──────────────────────────────────────────────
PRICE_MAP: dict[str, dict[str, int]] = {
    "nin_modification": {
        "update_name":       500_000,  # ₦5,000
        "update_phone":      500_000,  # ₦5,000
        "update_dob":        500_000,  # ₦5,000
        "update_address":    500_000,  # ₦5,000
        "update_name_dob":   500_000,  # ₦5,000
        "update_name_phone": 500_000,  # ₦5,000
        "default":           500_000,
    },
    "nin_validation": {
        "no_record":               100_000,  # ₦1,000
        "sim_validation":          100_000,  # ₦1,000
        "vnin_validation":         120_000,  # ₦1,200
        "update_records":          100_000,  # ₦1,000
        "bank_validation":         100_000,  # ₦1,000
        "modification_validation": 120_000,  # ₦1,200
        "photographic_error":      120_000,  # ₦1,200
        "single":                  100_000,  # ₦1,000
        "default":                 100_000,
    },
    "bvn_modification": {
        # Bank-specific prices for single modifications (name, phone, dob, address)
        "agency":        600_000,    # ₦6,000
        "access_bank":   950_000,    # ₦9,500
        "boa_bank":      700_000,    # ₦7,000
        "first_bank":    750_000,    # ₦7,500
        "gtbank":        800_000,    # ₦8,000
        "heritage_bank": 700_000,    # ₦7,000
        "jaiz_bank":     1_000_000,  # ₦10,000
        "keystone_bank": 700_000,    # ₦7,000
        # Combination updates are fixed ₦9,000
        "update_name_dob":     900_000,
        "update_name_phone":   900_000,
        "update_name_address": 900_000,
        "update_dob_phone":    900_000,
        "default":             700_000,
    },
    "bvn_retrieval": {
        "phone_number":      70_000,   # ₦700
        "crm_investigation": 200_000,  # ₦2,000
        "default":           70_000,
    },
    "bvn_license": {
        "default": 700_000,  # ₦7,000
    },
    "nin_delinking": {
        "self_service_delinking": 350_000,  # ₦3,500
        "email_retrieval":        350_000,  # ₦3,500
        "default":                350_000,
    },
    "self_service_modification": {
        "update_name":       450_000,  # ₦4,500
        "update_phone":      450_000,  # ₦4,500
        "update_address":    450_000,  # ₦4,500
        "update_name_phone": 90_000,   # ₦900
        "update_name_dob":   500_000,  # ₦5,000
        "default":           450_000,
    },
    "modification_after_delinking": {
        "update_name":       450_000,  # ₦4,500
        "update_phone":      450_000,  # ₦4,500
        "update_dob":        450_000,  # ₦4,500
        "update_address":    450_000,  # ₦4,500
        "update_name_dob":   450_000,  # ₦4,500
        "update_name_phone": 450_000,  # ₦4,500
        "default":           450_000,
    },
    "tin_registration": {
        "individual": 150_000,  # ₦1,500
        "company":    450_000,  # ₦4,500
        "default":    150_000,
    },
    "nin_attestation": {
        "default": 1_500_000,  # ₦15,000
    },
    "cac_registration": {
        "business_name": 3_500_000,  # ₦35,000
        "company":       5_000_000,  # ₦50,000
        "default":       3_500_000,
    },
}


async def _get_current_price_map(db: AsyncSession) -> dict[str, dict[str, int]]:
    val = await get_config_value(db, "manual_services_pricing")
    if val:
        try:
            custom = json.loads(val)
            merged = {**PRICE_MAP}
            for cat, sub in custom.items():
                if cat in merged:
                    merged[cat] = {**merged[cat], **sub}
                else:
                    merged[cat] = sub
            return merged
        except Exception:
            pass
    return PRICE_MAP


def _get_price(
    category: str,
    service_type: str,
    enrollment_bank: str | None = None,
    bulk_count: int = 1,
    custom_map: dict | None = None,
) -> int:
    source_map = custom_map or PRICE_MAP
    category_map = source_map.get(category, {})

    # NIN Validation Bulk mode
    if category == "nin_validation" and bulk_count > 1:
        unit_price = category_map.get(service_type, category_map.get("default", 100_000))
        return unit_price * bulk_count

    # BVN Modification dynamic pricing by enrollment bank
    if category == "bvn_modification":
        # Check if combination update
        if service_type in ["update_name_dob", "update_name_phone", "update_name_address", "update_dob_phone"]:
            return category_map.get(service_type, 900_000)
        # Single update: use enrollment_bank if provided
        if enrollment_bank:
            bank_key = enrollment_bank.lower().replace(" ", "_")
            if bank_key in category_map:
                return category_map[bank_key]
        return category_map.get(service_type, category_map.get("default", 700_000))

    return category_map.get(service_type, category_map.get("default", 0))


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

    current_price_map = await _get_current_price_map(db)
    price_kobo = _get_price(
        body.service_category,
        body.service_type,
        enrollment_bank=body.enrollment_bank,
        bulk_count=body.bulk_count,
        custom_map=current_price_map,
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

    req_form_data = dict(body.form_data or {})
    if customer_id and current_user.role == UserRole.OFFICER:
        req_form_data["submitted_by_officer_id"] = str(current_user.id)

    req = ManualServiceRequest(
        id=req_id,
        user_id=target_user_id,
        service_category=body.service_category,
        service_type=body.service_type,
        form_data=req_form_data,
        uploaded_files=body.uploaded_files,
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


DEFAULT_COVER_LABELS: dict[str, str] = {
    "nin_modification": "From ₦5,000",
    "nin_validation": "From ₦700",
    "nin_delinking": "From ₦3,500",
    "bvn_modification": "From ₦6,000",
    "bvn_retrieval": "From ₦700",
    "bvn_license_onboarding": "From ₦15,000",
    "bvn_license": "From ₦15,000",
    "tin_registration": "From ₦2,000",
    "attestation": "From ₦3,000",
    "nin_attestation": "From ₦3,000",
    "cac_registration": "From ₦15,000",
    "self_service_modification": "From ₦5,000",
}


async def _get_current_cover_labels(db: AsyncSession) -> dict[str, str]:
    val = await get_config_value(db, "manual_services_cover_labels")
    labels = dict(DEFAULT_COVER_LABELS)
    if val:
        try:
            custom = json.loads(val)
            if isinstance(custom, dict):
                labels.update(custom)
        except Exception:
            pass
    return labels


# ─── Director Pricing Oversight ───────────────────────────────────────────────

@router.get("/pricing")
async def get_manual_services_pricing(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Return all manual service categories and their child category prices and cover card labels."""
    price_map = await _get_current_price_map(db)
    cover_labels = await _get_current_cover_labels(db)
    return {"pricing": price_map, "cover_labels": cover_labels}


@router.patch("/pricing")
async def update_manual_services_pricing(
    body: dict[str, Any],
    current_user: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """
    Director updates child category prices and/or cover card alphanumeric labels.
    Accepts:
      { "pricing": { "nin_modification": { "update_name": 500000 } },
        "cover_labels": { "nin_modification": "From ₦7,000" } }
      or direct { "nin_modification": { ... } }
    """
    incoming_pricing = body.get("pricing") if "pricing" in body or "cover_labels" in body else body
    incoming_labels = body.get("cover_labels")

    current_pricing = await _get_current_price_map(db)
    if incoming_pricing and isinstance(incoming_pricing, dict):
        for cat, sub in incoming_pricing.items():
            if isinstance(sub, dict):
                if cat in current_pricing:
                    current_pricing[cat].update(sub)
                else:
                    current_pricing[cat] = sub

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

    current_labels = await _get_current_cover_labels(db)
    if incoming_labels and isinstance(incoming_labels, dict):
        current_labels.update(incoming_labels)
        label_cfg = await db.get(SystemConfig, "manual_services_cover_labels")
        if not label_cfg:
            label_cfg = SystemConfig(
                key="manual_services_cover_labels",
                value=json.dumps(current_labels),
                description="Manual services cover card labels",
                updated_by=current_user.id,
            )
            db.add(label_cfg)
        else:
            label_cfg.value = json.dumps(current_labels)
            label_cfg.updated_at = datetime.now(timezone.utc)
            label_cfg.updated_by = current_user.id

    await db.commit()
    invalidate_config_cache("manual_services_pricing")
    invalidate_config_cache("manual_services_cover_labels")
    return {
        "pricing": current_pricing,
        "cover_labels": current_labels,
        "message": "Pricing tiers and cover card labels updated successfully.",
    }
