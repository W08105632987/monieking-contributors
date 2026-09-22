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

from app.core.database import get_db
from app.core.dependencies import CurrentUser, CustomerOrOfficer
from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus
from app.models.user import User, UserRole

router = APIRouter(prefix="/manual-services", tags=["manual-services"])


# ─── Pricing constants (in kobo) ──────────────────────────────────────────────
PRICE_MAP: dict[str, dict[str, int]] = {
    "nin_modification": {
        "update_name":     500_00,
        "update_dob":      500_00,
        "update_address":  500_00,
        "update_phone":    500_00,
        "combined":        100_000,
    },
    "nin_validation": {
        "single":          150_00,
        "bulk":            100_00,  # per NIN, computed on form
    },
    "bvn_modification": {
        # bank-specific pricing
        "agency_bank":     600_000,
        "access_bank":     950_000,
        "boa_bank":        700_000,
        "first_bank":      750_000,
        "gtbank":          800_000,
        "heritage_bank":   700_000,
        "jaiz_bank":       1_000_000,
        "keystone_bank":   700_000,
        "default":         700_000,
    },
    "bvn_retrieval": {
        "phone_number":    70_000,
        "crm_investigation": 200_000,
    },
    "bvn_license":         {"default": 0},
    "nin_delinking":       {"default": 0},
    "self_service_modification": {"default": 0},
    "modification_after_delinking": {"default": 0},
    "tin_registration": {
        "individual":      150_000,
        "company":         450_000,
    },
    "nin_attestation":     {"default": 1_500_000},
    "cac_registration": {
        "business_name":   0,
        "company":         0,
    },
}


def _get_price(category: str, service_type: str) -> int:
    category_map = PRICE_MAP.get(category, {})
    return category_map.get(service_type, category_map.get("default", 0))


# ─── Schemas ──────────────────────────────────────────────────────────────────

class SubmitServiceRequest(BaseModel):
    service_category:  str = Field(..., description="e.g. nin_modification, bvn_retrieval")
    service_type:      str = Field(..., description="e.g. update_name, phone_number")
    form_data:         dict = Field(default_factory=dict, description="All form fields")
    uploaded_files:    list = Field(default_factory=list, description="Supabase storage URLs")
    consent_given:     bool = Field(..., description="Explicit user consent required")
    referred_worker_id: str | None = Field(None, description="Optional Service Worker referral code or ID")


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
        "claimed_at":      req.claimed_at.isoformat() if req.claimed_at else None,
        "expires_at":      req.expires_at.isoformat() if req.expires_at else None,
        "completed_at":    req.completed_at.isoformat() if req.completed_at else None,
        "created_at":      req.created_at.isoformat(),
        "updated_at":      req.updated_at.isoformat() if req.updated_at else None,
    }


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def submit_service_request(
    body: SubmitServiceRequest,
    current_user: CustomerOrOfficer,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit a new manual service request. The request enters the job pool
    immediately as 'pending' and can be claimed by a Service Worker.
    """
    if not body.consent_given:
        raise HTTPException(
            status_code=400,
            detail="You must give explicit consent before submitting this service request."
        )

    price_kobo = _get_price(body.service_category, body.service_type)

    # Resolve referred worker
    referred_worker_id: uuid.UUID | None = None
    if body.referred_worker_id:
        # Try as referral code first, then as UUID
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
