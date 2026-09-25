"""
Service Worker API Routes
=========================
All endpoints for the Service Worker portal: onboarding profile completion,
job pool listing, claiming jobs, resolving jobs, commission earnings, and
payout requests.
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import ServiceWorkerOnly, DirectorOnly, DirectorOrAdmin
from app.core.security import hash_password
from app.models.user import User, UserRole, UserStatus
from app.models.manual_service_request import ManualServiceRequest, ManualServiceStatus
from app.models.service_worker_withdrawal import ServiceWorkerWithdrawal, SWWithdrawalStatus
from app.services import job_pool_service
from app.utils.audit import log_action
from app.utils.supabase_auth import create_supabase_auth_user

router = APIRouter(prefix="/worker", tags=["service-worker"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CompleteProfileRequest(BaseModel):
    full_name:          str = Field(..., min_length=2, max_length=200)
    email:              str | None = None
    bank_name:          str = Field(..., min_length=2, max_length=100)
    account_number:     str = Field(..., min_length=10, max_length=20)
    account_name:       str = Field(..., min_length=2, max_length=200)
    state_of_residence: str = Field(..., min_length=2, max_length=50)
    new_password:       str | None = None


class ResolveJobRequest(BaseModel):
    worker_status:          str = Field(..., pattern="^(successful|failed|completed|rejected)$")
    worker_response:        str | None = None
    worker_remarks:         str | None = None
    worker_additional_info: str | None = None
    worker_result_file_url: str | None = None


class PayoutRequest(BaseModel):
    amount_kobo:    int = Field(..., gt=0)
    account_number: str = Field(..., min_length=10, max_length=20)
    account_name:   str = Field(..., min_length=2, max_length=200)
    bank_name:      str = Field(..., min_length=2, max_length=100)


class CreateWorkerRequest(BaseModel):
    phone_number: str = Field(..., min_length=10, max_length=20)


def mask_name(name: str | None) -> str | None:
    if not name:
        return None
    parts = name.strip().split()
    masked_parts = []
    for p in parts:
        if len(p) <= 2:
            masked_parts.append(p[0] + "*")
        else:
            masked_parts.append(p[:2] + "*" * (len(p) - 2))
    return " ".join(masked_parts)


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    p = phone.strip()
    if len(p) <= 4:
        return "****"
    return p[:4] + "***" + p[-3:]


def mask_form_data(form_data: dict | None) -> dict:
    if not form_data:
        return {}
    masked = {}
    for k, v in form_data.items():
        k_lower = k.lower()
        v_str = str(v)
        if any(sens in k_lower for sens in ("nin", "bvn", "account_number")):
            masked[k] = ("*" * max(4, len(v_str) - 4)) + v_str[-4:] if len(v_str) >= 4 else "****"
        elif any(sens in k_lower for sens in ("phone", "mobile", "tel")):
            masked[k] = mask_phone(v_str)
        elif "email" in k_lower and "@" in v_str:
            parts = v_str.split("@", 1)
            name_part = parts[0]
            domain = parts[1] if len(parts) > 1 else ""
            masked[k] = (name_part[:2] + "***@" + domain) if len(name_part) > 2 else "*@" + domain
        elif any(sens in k_lower for sens in ("dob", "birth")):
            masked[k] = "****-**-**"
        else:
            masked[k] = v
    return masked


def _serialize_job(
    job: ManualServiceRequest,
    include_customer: bool = True,
    mask_sensitive: bool = False,
) -> dict:
    customer_name = None
    customer_phone = None
    if include_customer and hasattr(job, "customer") and job.customer:
        customer_name = job.customer.full_name
        customer_phone = job.customer.phone_number

    if mask_sensitive:
        customer_name = mask_name(customer_name)
        customer_phone = mask_phone(customer_phone)
        display_form_data = mask_form_data(job.form_data)
    else:
        display_form_data = job.form_data or {}

    return {
        "id": str(job.id),
        "user_id": str(job.user_id),
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "service_category": job.service_category,
        "service_type": job.service_type,
        "form_data": display_form_data,
        "uploaded_files": job.uploaded_files or [],
        "price_kobo": job.price_kobo,
        "status": job.status.value if hasattr(job.status, "value") else job.status,
        "claimed_by_id": str(job.claimed_by_id) if job.claimed_by_id else None,
        "referred_worker_id": str(job.referred_worker_id) if job.referred_worker_id else None,
        "claimed_at": job.claimed_at.isoformat() if job.claimed_at else None,
        "expires_at": job.expires_at.isoformat() if job.expires_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "worker_status": job.worker_status,
        "worker_response": job.worker_response,
        "worker_remarks": job.worker_remarks,
        "worker_additional_info": job.worker_additional_info,
        "worker_result_file_url": job.worker_result_file_url,
        "worker_commission_kobo": job.worker_commission_kobo,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }


def _serialize_payout(p: ServiceWorkerWithdrawal) -> dict:
    return {
        "id": str(p.id),
        "worker_id": str(p.worker_id),
        "amount_kobo": p.amount_kobo,
        "account_number": p.account_number,
        "account_name": p.account_name,
        "bank_name": p.bank_name,
        "status": p.status.value if hasattr(p.status, "value") else p.status,
        "rejection_reason": p.rejection_reason,
        "created_at": p.created_at.isoformat(),
        "reviewed_at": p.reviewed_at.isoformat() if p.reviewed_at else None,
    }


# ─── Director: Create Service Worker ──────────────────────────────────────────

@router.post("/create", status_code=status.HTTP_201_CREATED)
async def create_service_worker(
    body: CreateWorkerRequest,
    current_user: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Director creates a new Service Worker with default password = {phone}MK."""
    # Check for duplicate phone
    existing = await db.scalar(select(User).where(User.phone_number == body.phone_number))
    if existing:
        raise HTTPException(status_code=409, detail="A user with this phone number already exists.")

    default_password = f"{body.phone_number}MK"
    import secrets
    import string

    # Generate a unique referral code
    chars = string.ascii_uppercase + string.digits
    referral_code = "SW-" + "".join(secrets.choice(chars) for _ in range(6))
    # Ensure uniqueness
    while await db.scalar(select(User).where(User.referral_code == referral_code)):
        referral_code = "SW-" + "".join(secrets.choice(chars) for _ in range(6))

    placeholder_name = f"Worker {body.phone_number[-4:]}"

    # Create real Supabase Auth user first so public.users.id matches auth.users.id
    # and the worker can authenticate via /auth/login
    worker_id = await create_supabase_auth_user(
        email=f"{body.phone_number}@monieking.app",
        password=default_password,
        full_name=placeholder_name,
        phone=body.phone_number,
    )

    worker = User(
        id=worker_id,
        role=UserRole.SERVICE_WORKER,
        full_name=placeholder_name,  # placeholder until onboarding
        phone_number=body.phone_number,
        login_password_hash=hash_password(default_password),
        status=UserStatus.ACTIVE,
        onboarding_completed=False,
        referral_code=referral_code,
    )
    db.add(worker)
    await db.commit()
    await db.refresh(worker)

    # Build WhatsApp invite message
    whatsapp_text = (
        f"Hello! You've been added as a Service Worker on MonieKing.\n\n"
        f"📱 *Login Details:*\n"
        f"Phone: {body.phone_number}\n"
        f"Password: {default_password}\n\n"
        f"🔗 Login at: https://app.monieking.com\n\n"
        f"Please complete your profile on first login.\n"
        f"Your referral code is: *{referral_code}*"
    )

    await log_action(
        db,
        actor_id=current_user.id,
        action="create_service_worker",
        entity_type="user",
        entity_id=str(worker.id),
        new_value={"worker_id": str(worker.id), "phone": worker.phone_number, "role": "service_worker"},
    )
    await db.commit()

    return {
        "worker": {
            "id": str(worker.id),
            "phone_number": worker.phone_number,
            "referral_code": worker.referral_code,
            "role": "service_worker",
        },
        "whatsapp_invite_text": whatsapp_text,
        "default_password": default_password,
    }


# ─── Worker: Complete Profile (Onboarding) ─────────────────────────────────────

@router.post("/complete-profile")
@router.post("/profile/complete")
async def complete_profile(
    body: CompleteProfileRequest,
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """First-time profile completion for a new Service Worker."""
    worker = await db.get(User, current_user.id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found.")

    worker.full_name          = body.full_name
    worker.bank_name          = body.bank_name
    worker.account_number     = body.account_number
    worker.account_name       = body.account_name
    worker.state_of_residence = body.state_of_residence
    worker.onboarding_completed = True

    supabase_payload: dict[str, Any] = {"user_metadata": {"full_name": body.full_name}}

    if body.new_password and len(body.new_password.strip()) >= 6:
        new_pwd = body.new_password.strip()
        worker.login_password_hash = hash_password(new_pwd)
        supabase_payload["password"] = new_pwd

    try:
        from app.utils.supabase_admin_client import supabase_admin_request
        await supabase_admin_request(
            "PUT",
            f"/auth/v1/admin/users/{worker.id}",
            json=supabase_payload,
            failure_detail="Could not update account credentials. Please try again.",
        )
    except Exception as e:
        print(f"[WORKER] Supabase auth update error (non-fatal): {e}")

    await db.commit()
    await db.refresh(worker)

    from app.services.user_service import build_user_response
    return await build_user_response(db, worker)


# ─── Worker: Job Pool ─────────────────────────────────────────────────────────

@router.get("/jobs/pool")
async def get_job_pool(
    current_user: ServiceWorkerOnly,
    category: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """List all open (pending) jobs in the pool, with customer privacy masking."""
    result = await job_pool_service.list_pool(db, category=category, page=page, page_size=page_size)
    # Load customer relationship
    serialized = []
    for job in result["data"]:
        await db.refresh(job, ["customer"])
        serialized.append(_serialize_job(job, include_customer=True, mask_sensitive=True))
    return {
        "data": serialized,
        "total": result["total"],
        "page": result["page"],
        "page_size": result["page_size"],
    }


@router.get("/jobs/referred")
async def get_referred_jobs(
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """List all pending jobs specifically referred to this worker and still inside hold window."""
    items = await job_pool_service.list_referred_jobs(db, current_user.id)
    serialized = []
    for item in items:
        job = item["job"]
        await db.refresh(job, ["customer"])
        d = _serialize_job(job, include_customer=True, mask_sensitive=False)
        d["referral_expires_at"] = item["referral_expires_at"]
        serialized.append(d)
    return {"data": serialized}


@router.get("/jobs/mine")
async def get_my_jobs(
    current_user: ServiceWorkerOnly,
    job_status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """List all jobs this worker has ever claimed."""
    result = await job_pool_service.list_worker_jobs(
        db, current_user.id, status=job_status, page=page, page_size=page_size
    )
    serialized = []
    for job in result["data"]:
        await db.refresh(job, ["customer"])
        serialized.append(_serialize_job(job, include_customer=True, mask_sensitive=False))
    return {"data": serialized, "total": result["total"], "page": result["page"], "page_size": result["page_size"]}


@router.get("/jobs/active")
async def get_active_job(
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """Return the current active (processing) job for this worker, if any."""
    job = await db.scalar(
        select(ManualServiceRequest).where(
            ManualServiceRequest.claimed_by_id == current_user.id,
            ManualServiceRequest.status == ManualServiceStatus.PROCESSING,
        )
    )
    if not job:
        return {"job": None}
    await db.refresh(job, ["customer"])
    return {"job": _serialize_job(job, include_customer=True, mask_sensitive=False)}


@router.post("/jobs/{job_id}/claim")
async def claim_job(
    job_id: uuid.UUID,
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """Claim an open job from the pool."""
    # Worker can only hold one job at a time
    active = await db.scalar(
        select(ManualServiceRequest).where(
            ManualServiceRequest.claimed_by_id == current_user.id,
            ManualServiceRequest.status == ManualServiceStatus.PROCESSING,
        )
    )
    if active:
        raise HTTPException(
            status_code=409,
            detail="You already have an active job. Complete it before claiming another."
        )

    try:
        job = await job_pool_service.claim_job(db, job_id, current_user.id)
    except ValueError as e:
        err_msg = str(e)
        if "reserved for a referred" in err_msg.lower():
            raise HTTPException(status_code=403, detail=err_msg)
        if "already claimed" in err_msg.lower():
            raise HTTPException(status_code=409, detail=err_msg)
        raise HTTPException(status_code=400, detail=err_msg)

    await db.refresh(job, ["customer"])
    return {"job": _serialize_job(job, include_customer=True, mask_sensitive=False), "message": "Job claimed successfully. SLA timer started."}


@router.post("/jobs/{job_id}/resolve")
async def resolve_job(
    job_id: uuid.UUID,
    body: ResolveJobRequest,
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """Submit a resolution for your active job."""
    response_text = body.worker_response or body.worker_remarks or "Resolved by service worker"
    try:
        job = await job_pool_service.resolve_job(
            db,
            job_id,
            current_user.id,
            worker_status=body.worker_status,
            worker_response=response_text,
            worker_remarks=body.worker_remarks,
            worker_additional_info=body.worker_additional_info,
            worker_result_file_url=body.worker_result_file_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "job": _serialize_job(job, include_customer=False, mask_sensitive=False),
        "commission_earned_kobo": job.worker_commission_kobo,
        "message": f"Job resolved as {job.status.value}.",
    }


# ─── Worker: Earnings & Payouts ───────────────────────────────────────────────

@router.get("/earnings/summary")
async def get_earnings_summary(
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """Commission balance and lifetime earnings summary."""
    from sqlalchemy import func as sqlfunc
    worker = await db.get(User, current_user.id)

    # Lifetime commission from completed jobs
    lifetime = await db.scalar(
        select(sqlfunc.coalesce(sqlfunc.sum(ManualServiceRequest.worker_commission_kobo), 0))
        .where(
            ManualServiceRequest.claimed_by_id == current_user.id,
            ManualServiceRequest.status == ManualServiceStatus.SUCCESSFUL,
        )
    ) or 0

    # Paid out
    paid_out = await db.scalar(
        select(sqlfunc.coalesce(sqlfunc.sum(ServiceWorkerWithdrawal.amount_kobo), 0))
        .where(
            ServiceWorkerWithdrawal.worker_id == current_user.id,
            ServiceWorkerWithdrawal.status == SWWithdrawalStatus.PAID,
        )
    ) or 0

    # Jobs completed
    completed_count = await db.scalar(
        select(sqlfunc.count()).select_from(ManualServiceRequest).where(
            ManualServiceRequest.claimed_by_id == current_user.id,
            ManualServiceRequest.status == ManualServiceStatus.SUCCESSFUL,
        )
    ) or 0

    return {
        "commission_balance_kobo": worker.commission_balance_kobo if worker else 0,
        "lifetime_earned_kobo": lifetime,
        "paid_out_kobo": paid_out,
        "jobs_completed": completed_count,
        "account_number": worker.account_number if worker else None,
        "account_name": worker.account_name if worker else None,
        "bank_name": worker.bank_name if worker else None,
    }


@router.get("/earnings/history")
async def get_earnings_history(
    current_user: ServiceWorkerOnly,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Commission history — all completed jobs."""
    from sqlalchemy import func as sqlfunc
    offset = (page - 1) * page_size
    q = (
        select(ManualServiceRequest)
        .where(
            ManualServiceRequest.claimed_by_id == current_user.id,
            ManualServiceRequest.status.in_([ManualServiceStatus.SUCCESSFUL, ManualServiceStatus.FAILED]),
        )
        .order_by(ManualServiceRequest.completed_at.desc())
    )
    total = await db.scalar(
        select(sqlfunc.count()).select_from(ManualServiceRequest).where(
            ManualServiceRequest.claimed_by_id == current_user.id,
            ManualServiceRequest.status.in_([ManualServiceStatus.SUCCESSFUL, ManualServiceStatus.FAILED]),
        )
    ) or 0
    rows = (await db.scalars(q.offset(offset).limit(page_size))).all()
    return {
        "data": [_serialize_job(j, include_customer=False) for j in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/earnings/payout-request")
async def request_payout(
    body: PayoutRequest,
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """Request a commission payout (Director approval required)."""
    try:
        payout = await job_pool_service.request_payout(
            db,
            current_user.id,
            body.amount_kobo,
            body.account_number,
            body.account_name,
            body.bank_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"payout": _serialize_payout(payout), "message": "Payout request submitted for Director approval."}


@router.get("/earnings/payouts")
async def list_my_payouts(
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """List this worker's payout requests."""
    rows = (
        await db.scalars(
            select(ServiceWorkerWithdrawal)
            .where(ServiceWorkerWithdrawal.worker_id == current_user.id)
            .order_by(ServiceWorkerWithdrawal.created_at.desc())
        )
    ).all()
    return {"data": [_serialize_payout(p) for p in rows]}


# ─── Director: Oversight ──────────────────────────────────────────────────────

@router.get("/stats", dependencies=[])
async def get_worker_stats(
    current_user: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Live director overview: free/busy workers, job pool depth, daily stats."""
    return await job_pool_service.get_worker_stats(db)


@router.get("/list")
async def list_all_workers(
    current_user: DirectorOrAdmin,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List all service workers with their live status for the Director."""
    from sqlalchemy import func as sqlfunc
    offset = (page - 1) * page_size
    workers = (
        await db.scalars(
            select(User)
            .where(User.role == UserRole.SERVICE_WORKER)
            .order_by(User.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
    ).all()
    total = await db.scalar(
        select(sqlfunc.count()).select_from(User).where(User.role == UserRole.SERVICE_WORKER)
    ) or 0

    hold_mins = await job_pool_service._get_referral_hold_minutes(db)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=hold_mins)

    result = []
    for w in workers:
        # Check if this worker has an active job
        active_job = await db.scalar(
            select(ManualServiceRequest).where(
                ManualServiceRequest.claimed_by_id == w.id,
                ManualServiceRequest.status == ManualServiceStatus.PROCESSING,
            )
        )
        completed = await db.scalar(
            select(sqlfunc.count()).select_from(ManualServiceRequest).where(
                ManualServiceRequest.claimed_by_id == w.id,
                ManualServiceRequest.status == ManualServiceStatus.SUCCESSFUL,
            )
        ) or 0
        pending_referred = await db.scalar(
            select(sqlfunc.count()).select_from(ManualServiceRequest).where(
                ManualServiceRequest.referred_worker_id == w.id,
                ManualServiceRequest.status == ManualServiceStatus.PENDING,
                ManualServiceRequest.created_at > cutoff,
            )
        ) or 0
        result.append({
            "id": str(w.id),
            "full_name": w.full_name,
            "phone_number": w.phone_number,
            "referral_code": w.referral_code,
            "status": w.status.value if hasattr(w.status, "value") else w.status,
            "state_of_residence": w.state_of_residence,
            "commission_balance_kobo": w.commission_balance_kobo,
            "onboarding_completed": w.onboarding_completed,
            "is_busy": active_job is not None,
            "active_job_id": str(active_job.id) if active_job else None,
            "active_job_expires_at": active_job.expires_at.isoformat() if active_job and active_job.expires_at else None,
            "jobs_completed": completed,
            "pending_referred_count": pending_referred,
            "created_at": w.created_at.isoformat(),
        })
    return {"data": result, "total": total, "page": page, "page_size": page_size}


# ─── Director: Payout Approvals ───────────────────────────────────────────────

@router.get("/payouts/pending")
async def list_pending_payouts(
    current_user: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """List all pending worker payout requests."""
    rows = (
        await db.scalars(
            select(ServiceWorkerWithdrawal)
            .where(ServiceWorkerWithdrawal.status == SWWithdrawalStatus.PENDING)
            .order_by(ServiceWorkerWithdrawal.created_at.asc())
        )
    ).all()
    # Load worker names
    result = []
    for p in rows:
        worker = await db.get(User, p.worker_id)
        d = _serialize_payout(p)
        d["worker_name"] = worker.full_name if worker else "Unknown"
        d["worker_phone"] = worker.phone_number if worker else None
        result.append(d)
    return {"data": result}


@router.post("/payouts/{payout_id}/approve")
async def approve_payout(
    payout_id: uuid.UUID,
    current_user: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    payout = await db.get(ServiceWorkerWithdrawal, payout_id)
    if not payout or payout.status != SWWithdrawalStatus.PENDING:
        raise HTTPException(status_code=404, detail="Pending payout not found.")
    payout.status      = SWWithdrawalStatus.PAID
    payout.reviewed_by = current_user.id
    payout.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Payout approved and marked as paid."}


@router.post("/payouts/{payout_id}/reject")
async def reject_payout(
    payout_id: uuid.UUID,
    body: dict,
    current_user: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    payout = await db.get(ServiceWorkerWithdrawal, payout_id)
    if not payout or payout.status != SWWithdrawalStatus.PENDING:
        raise HTTPException(status_code=404, detail="Pending payout not found.")
    # Refund to worker balance
    worker = await db.get(User, payout.worker_id)
    if worker:
        worker.commission_balance_kobo = (worker.commission_balance_kobo or 0) + payout.amount_kobo
    payout.status           = SWWithdrawalStatus.REJECTED
    payout.reviewed_by      = current_user.id
    payout.reviewed_at      = datetime.now(timezone.utc)
    payout.rejection_reason = body.get("reason", "No reason given.")
    await db.commit()
    return {"message": "Payout rejected and amount returned to worker balance."}


# ─── Director: All Manual Service Requests ────────────────────────────────────

@router.get("/jobs/all")
async def list_all_jobs(
    current_user: DirectorOrAdmin,
    job_status: str | None = None,
    category: str | None = None,
    pool_type: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Director: list all manual service requests with optional filters."""
    from sqlalchemy import func as sqlfunc
    q = select(ManualServiceRequest)
    status_filter = None
    if job_status and job_status.lower() != "all":
        status_map = {
            "pending": ManualServiceStatus.PENDING,
            "in_progress": ManualServiceStatus.PROCESSING,
            "processing": ManualServiceStatus.PROCESSING,
            "completed": ManualServiceStatus.SUCCESSFUL,
            "successful": ManualServiceStatus.SUCCESSFUL,
            "failed": ManualServiceStatus.FAILED,
            "disputed": ManualServiceStatus.FAILED,
            "rejected": ManualServiceStatus.FAILED,
        }
        status_filter = status_map.get(job_status.lower())

    if status_filter:
        q = q.where(ManualServiceRequest.status == status_filter)
    if category and category.lower() != "all":
        q = q.where(ManualServiceRequest.service_category == category)
    if pool_type == "referred":
        q = q.where(ManualServiceRequest.referred_worker_id.isnot(None))
    elif pool_type == "open":
        q = q.where(ManualServiceRequest.referred_worker_id.is_(None))

    q = q.order_by(ManualServiceRequest.created_at.desc())

    total_q = select(sqlfunc.count()).select_from(ManualServiceRequest)
    if status_filter:
        total_q = total_q.where(ManualServiceRequest.status == status_filter)
    if category and category.lower() != "all":
        total_q = total_q.where(ManualServiceRequest.service_category == category)
    if pool_type == "referred":
        total_q = total_q.where(ManualServiceRequest.referred_worker_id.isnot(None))
    elif pool_type == "open":
        total_q = total_q.where(ManualServiceRequest.referred_worker_id.is_(None))

    total = await db.scalar(total_q) or 0

    offset = (page - 1) * page_size
    rows = (await db.scalars(q.offset(offset).limit(page_size))).all()
    serialized = []
    for job in rows:
        await db.refresh(job, ["customer", "claimed_by", "referred_worker"])
        d = _serialize_job(job)
        d["worker_name"] = job.claimed_by.full_name if job.claimed_by else None
        d["referred_worker_name"] = job.referred_worker.full_name if job.referred_worker else None
        serialized.append(d)
    return {"data": serialized, "total": total, "page": page, "page_size": page_size}


# ─── SLA Reclaim (internal, call from background task / cron) ─────────────────

@router.post("/jobs/reclaim-expired", include_in_schema=False)
async def reclaim_expired(
    current_user: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger SLA reclamation (Director only). Also runs in background."""
    reclaimed = await job_pool_service.reclaim_expired_jobs(db)
    return {"reclaimed": reclaimed}
