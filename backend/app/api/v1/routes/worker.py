"""
Service Worker API Routes
=========================
All endpoints for the Service Worker portal: onboarding profile completion,
job pool listing, claiming jobs, resolving jobs, commission earnings, and
payout requests.
"""
import uuid
from datetime import datetime, timezone
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

router = APIRouter(prefix="/worker", tags=["service-worker"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CompleteProfileRequest(BaseModel):
    full_name:          str = Field(..., min_length=2, max_length=200)
    email:              str | None = None
    bank_name:          str = Field(..., min_length=2, max_length=100)
    account_number:     str = Field(..., min_length=10, max_length=20)
    account_name:       str = Field(..., min_length=2, max_length=200)
    state_of_residence: str = Field(..., min_length=2, max_length=50)


class ResolveJobRequest(BaseModel):
    worker_status:          str = Field(..., pattern="^(successful|failed)$")
    worker_response:        str = Field(..., min_length=1)
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


def _serialize_job(job: ManualServiceRequest, include_customer: bool = True) -> dict:
    customer_name = None
    if include_customer and hasattr(job, "customer") and job.customer:
        customer_name = job.customer.full_name
    return {
        "id": str(job.id),
        "user_id": str(job.user_id),
        "customer_name": customer_name,
        "service_category": job.service_category,
        "service_type": job.service_type,
        "form_data": job.form_data,
        "uploaded_files": job.uploaded_files,
        "price_kobo": job.price_kobo,
        "status": job.status.value if hasattr(job.status, "value") else job.status,
        "claimed_by_id": str(job.claimed_by_id) if job.claimed_by_id else None,
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

    worker = User(
        role=UserRole.SERVICE_WORKER,
        full_name=f"Worker {body.phone_number[-4:]}",  # placeholder until onboarding
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

    await log_action(db, current_user.id, "create_service_worker", {"worker_id": str(worker.id)})

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
    """List all open (pending) jobs in the pool."""
    result = await job_pool_service.list_pool(db, category=category, page=page, page_size=page_size)
    # Load customer relationship
    serialized = []
    for job in result["data"]:
        await db.refresh(job, ["customer"])
        serialized.append(_serialize_job(job))
    return {
        "data": serialized,
        "total": result["total"],
        "page": result["page"],
        "page_size": result["page_size"],
    }


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
        serialized.append(_serialize_job(job))
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
    return {"job": _serialize_job(job)}


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
        raise HTTPException(status_code=404, detail=str(e))

    await db.refresh(job, ["customer"])
    return {"job": _serialize_job(job), "message": "Job claimed successfully. SLA timer started."}


@router.post("/jobs/{job_id}/resolve")
async def resolve_job(
    job_id: uuid.UUID,
    body: ResolveJobRequest,
    current_user: ServiceWorkerOnly,
    db: AsyncSession = Depends(get_db),
):
    """Submit a resolution for your active job."""
    try:
        job = await job_pool_service.resolve_job(
            db,
            job_id,
            current_user.id,
            worker_status=body.worker_status,
            worker_response=body.worker_response,
            worker_remarks=body.worker_remarks,
            worker_additional_info=body.worker_additional_info,
            worker_result_file_url=body.worker_result_file_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "job": _serialize_job(job, include_customer=False),
        "commission_earned_kobo": job.worker_commission_kobo,
        "message": f"Job resolved as {body.worker_status}.",
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
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Director: list all manual service requests with optional filters."""
    from sqlalchemy import func as sqlfunc
    q = select(ManualServiceRequest)
    if job_status:
        q = q.where(ManualServiceRequest.status == job_status)
    if category:
        q = q.where(ManualServiceRequest.service_category == category)
    q = q.order_by(ManualServiceRequest.created_at.desc())

    total_q = select(sqlfunc.count()).select_from(ManualServiceRequest)
    if job_status:
        total_q = total_q.where(ManualServiceRequest.status == job_status)
    if category:
        total_q = total_q.where(ManualServiceRequest.service_category == category)
    total = await db.scalar(total_q) or 0

    offset = (page - 1) * page_size
    rows = (await db.scalars(q.offset(offset).limit(page_size))).all()
    serialized = []
    for job in rows:
        await db.refresh(job, ["customer", "claimed_by"])
        d = _serialize_job(job)
        d["worker_name"] = job.claimed_by.full_name if job.claimed_by else None
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
