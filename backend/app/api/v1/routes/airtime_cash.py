"""Airtime to Cash endpoints. Customer flow: quote -> start -> verify -> submit. Director: settings live in Bills Control; unclear requests are decided here."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CustomerOnly, DirectorOnly
from app.core.limiter import limiter
from app.models.airtime_cash import AirtimeCashRequest
from app.models.user import User
from app.services import airtime_cash_service as svc
from app.services import bill_config
from app.services.pin_service import check_pin

router = APIRouter(prefix="/airtime-cash", tags=["airtime-cash"])


def _not_in_play(request: Request) -> None:
    """Airtime to Cash is a web-only service: the Play Store build never offers it (the app also hides it)."""
    if request.headers.get("x-monieking-client", "").lower() == "play":
        raise HTTPException(status_code=403, detail="This service is not available in the app.")


def _row(r: AirtimeCashRequest, *, admin: bool = False) -> dict:
    out = {"id": str(r.id), "network": r.network, "phone": r.phone, "amount_kobo": r.amount_kobo, "payout_kobo": r.payout_kobo,
           "status": r.status, "created_at": r.created_at.isoformat(), "completed_at": r.completed_at.isoformat() if r.completed_at else None}
    if admin:
        out.update(provider_credit_kobo=r.provider_credit_kobo, fee_kobo=r.fee_kobo, failure_reason=r.failure_reason,
                   provider_reference=r.provider_reference, customer_id=str(r.customer_id))
    return out


def _bad(e: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


@router.get("/config")
async def a2c_config(request: Request, user: CustomerOnly, db: AsyncSession = Depends(get_db)):
    _not_in_play(request)
    cfg = await bill_config.get_bills_config(db)
    return {"enabled": bool(cfg["a2c_enabled"]) and svc.get_vtu_provider().configured, "min_naira": cfg["a2c_min_naira"], "max_naira": cfg["a2c_max_naira"],
            "daily_max_naira": cfg["a2c_daily_max_naira"], "networks": ["MTN", "Airtel", "Glo", "9mobile"]}


class QuoteBody(BaseModel):
    network: str
    amount_naira: int = Field(ge=50, le=1_000_000)


@router.post("/quote")
@limiter.limit("30/minute")
async def a2c_quote(request: Request, body: QuoteBody, user: CustomerOnly, db: AsyncSession = Depends(get_db)):
    _not_in_play(request)
    try:
        q = await svc.quote(db, body.network, body.amount_naira)
    except ValueError as e:
        raise _bad(e)
    return {"network": q["network"], "amount_kobo": q["amount_kobo"], "payout_kobo": q["payout_kobo"]}     # our margin and the supplier's rate stay private


class StartBody(QuoteBody):
    phone: str = Field(min_length=10, max_length=15)


@router.post("/start")
@limiter.limit("5/minute")
async def a2c_start(request: Request, body: StartBody, user: CustomerOnly, db: AsyncSession = Depends(get_db)):
    _not_in_play(request)
    customer = await db.get(User, user.id)
    try:
        req = await svc.start(db, customer, body.network, body.phone, body.amount_naira)
    except ValueError as e:
        raise _bad(e)
    return _row(req)


class VerifyBody(BaseModel):
    otp: str = Field(min_length=3, max_length=10)


@router.post("/{request_id}/verify")
@limiter.limit("10/minute")
async def a2c_verify(request: Request, request_id: uuid.UUID, body: VerifyBody, user: CustomerOnly, db: AsyncSession = Depends(get_db)):
    _not_in_play(request)
    try:
        return _row(await svc.verify(db, await db.get(User, user.id), request_id, body.otp))
    except ValueError as e:
        raise _bad(e)


class SubmitBody(BaseModel):
    simpin: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$", repr=False)     # the line's SIM transfer PIN: never stored or logged
    pin: str                                                                            # the customer's own MonieKing PIN


@router.post("/{request_id}/submit")
@limiter.limit("5/minute")
async def a2c_submit(request: Request, request_id: uuid.UUID, body: SubmitBody, user: CustomerOnly, db: AsyncSession = Depends(get_db)):
    _not_in_play(request)
    customer = await db.get(User, user.id)
    await check_pin(db, customer, body.pin)               # the customer proves it is them before their line is touched
    try:
        return _row(await svc.submit(db, customer, request_id, body.simpin))
    except ValueError as e:
        raise _bad(e)


@router.get("/mine")
async def a2c_mine(request: Request, user: CustomerOnly, db: AsyncSession = Depends(get_db)):
    _not_in_play(request)
    rows = (await db.execute(select(AirtimeCashRequest).where(AirtimeCashRequest.customer_id == user.id, AirtimeCashRequest.status != "started")
                             .order_by(AirtimeCashRequest.created_at.desc()).limit(30))).scalars().all()
    return [_row(r) for r in rows]


# ── Director: requests the supplier left unclear ─────────────────────────────
@router.get("/admin/list")
async def a2c_admin_list(director: DirectorOnly, status: str = "pending_review", db: AsyncSession = Depends(get_db)):
    q = select(AirtimeCashRequest).order_by(AirtimeCashRequest.created_at.desc()).limit(100)
    if status != "all":
        q = q.where(AirtimeCashRequest.status == status)
    rows = (await db.execute(q)).scalars().all()
    names = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_({r.customer_id for r in rows})))).scalars().all()} if rows else {}
    return [{**_row(r, admin=True), "customer_name": names.get(r.customer_id)} for r in rows]


class DecideBody(BaseModel):
    note: str | None = Field(None, max_length=200)
    pin: str


@router.post("/admin/{request_id}/approve")
async def a2c_admin_approve(request_id: uuid.UUID, body: DecideBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    await check_pin(db, director, body.pin)
    try:
        return _row(await svc.director_decide(db, director, request_id, True, body.note), admin=True)
    except ValueError as e:
        raise _bad(e)


@router.post("/admin/{request_id}/reject")
async def a2c_admin_reject(request_id: uuid.UUID, body: DecideBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    await check_pin(db, director, body.pin)
    try:
        return _row(await svc.director_decide(db, director, request_id, False, body.note), admin=True)
    except ValueError as e:
        raise _bad(e)
