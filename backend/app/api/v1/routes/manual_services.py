"""
Manual Services Routes
======================
Customer-facing endpoints for submitting manual service requests
(NIN modification, BVN, TIN, CAC, Attestation, etc.)
that enter the Service Worker job pool.
"""
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import CurrentUser, CustomerOrOfficer
from app.core.security import generate_reference
from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus
from app.models.wallet import TxCategory
from app.models.user import User, UserRole
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


def _get_price(
    category: str,
    service_type: str,
    enrollment_bank: str | None = None,
    bulk_count: int = 1,
) -> int:
    category_map = PRICE_MAP.get(category, {})

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

    # Validate Transaction PIN / withdrawal password if set
    user_row = await db.get(User, current_user.id)
    if user_row and user_row.has_withdrawal_password():
        if not body.transaction_pin:
            raise HTTPException(status_code=400, detail="Transaction PIN is required.")
        await check_withdrawal_password(db, user_row, body.transaction_pin)

    price_kobo = _get_price(
        body.service_category,
        body.service_type,
        enrollment_bank=body.enrollment_bank,
        bulk_count=body.bulk_count,
    )

    # Wallet balance verification & atomic debit
    if price_kobo > 0:
        wallet = await get_or_create_wallet(db, current_user.id)
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
        )

    # Resolve referred worker
    referred_worker_id: uuid.UUID | None = None
    if body.referred_worker_id:
        worker = await db.scalar(
            select(User).where(
                User.referral_code == body.referred_worker_id,
                User.role == UserRole.SERVICE_WORKER,
            )
        )
        if not worker:
            try:
                wid = uuid.UUID(body.referred_worker_id)
                worker = await db.scalar(
                    select(User).where(User.id == wid, User.role == UserRole.SERVICE_WORKER)
                )
            except ValueError:
                pass
        if worker:
            referred_worker_id = worker.id

    req = ManualServiceRequest(
        user_id=current_user.id,
        service_category=body.service_category,
        service_type=body.service_type,
        form_data=body.form_data,
        uploaded_files=body.uploaded_files,
        price_kobo=price_kobo,
        consent_given=body.consent_given,
        referred_worker_id=referred_worker_id,
        status=ManualServiceStatus.PENDING,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

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
            ManualServiceRequest.id == request_id,
            ManualServiceRequest.user_id == current_user.id,
        )
    )
    if not req:
        raise HTTPException(status_code=404, detail="Service request not found.")
    return _serialize(req)


@router.get("/validate-referral/{code}")
async def validate_referral_code(
    code: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Validate a referral code and return the worker's name if valid."""
    worker = await db.scalar(
        select(User).where(
            User.referral_code == code,
            User.role == UserRole.SERVICE_WORKER,
        )
    )
    if not worker:
        raise HTTPException(status_code=404, detail="Invalid referral code.")
    return {"valid": True, "worker_name": worker.full_name, "worker_id": str(worker.id)}
