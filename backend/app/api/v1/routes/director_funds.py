"""Company-funds balancing: daily close, transfer log, counted balances. Director-only."""
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.services import company_funds_service as fs
from app.services import settings_service as cfg
from app.utils.audit import log_action

router = APIRouter(prefix="/director/funds", tags=["company-funds"])


def _kobo(naira: float | str) -> int:
    try:
        return int((Decimal(str(naira)) * 100).quantize(Decimal("1")))
    except InvalidOperation:
        raise HTTPException(status_code=422, detail="That is not a valid amount.")


def _period(start: date | None, end: date | None) -> tuple[date, date]:
    today = datetime.now(fs.WAT).date()
    end = end or today
    start = start or end
    if start > end:
        raise HTTPException(status_code=422, detail="The start date is after the end date.")
    if (end - start).days > 400:
        raise HTTPException(status_code=422, detail="Pick a period of at most 400 days.")
    return start, end


async def _do(db: AsyncSession, fn):
    try:
        res = await fn()
        await db.commit()
        return res
    except fs.FundsError as e:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/overview")
async def get_overview(director: DirectorOnly, start: date | None = None, end: date | None = None, include_due_today: bool = False, db: AsyncSession = Depends(get_db)):
    s, e = _period(start, end)
    return await fs.overview(db, s, e, include_due_today)


@router.get("/meta")
async def get_meta(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    return {"accounts": [{"key": k, "label": v["label"], "auto": v["auto"]} for k, v in fs.ACCOUNTS.items()], "kinds": fs.TRANSFER_KINDS,
            "auto_close_enabled": (await cfg.get_config_value(db, fs.AUTO_CLOSE_ENABLED, "false")) == "true",
            "auto_close_time": await cfg.get_config_value(db, fs.AUTO_CLOSE_TIME, "23:55")}


@router.get("/transfers")
async def get_transfers(director: DirectorOnly, start: date | None = None, end: date | None = None, db: AsyncSession = Depends(get_db)):
    today = datetime.now(fs.WAT).date()
    s, e = _period(start or today - timedelta(days=29), end)
    return {"items": await fs.list_transfers(db, s, e)}


class TransferBody(BaseModel):
    occurred_on: date
    kind: str = Field(max_length=12)
    from_account: str | None = Field(None, max_length=20)
    to_account: str | None = Field(None, max_length=20)
    amount_naira: float = Field(gt=0, le=10_000_000_000)
    fee_naira: float = Field(0, ge=0, le=100_000_000)
    reference: str | None = Field(None, max_length=120)
    note: str | None = Field(None, max_length=300)


@router.post("/transfers")
async def add_transfer(body: TransferBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    async def go():
        t = await fs.add_transfer(db, user_id=director.id, occurred_on=body.occurred_on, kind=body.kind, frm=body.from_account, to=body.to_account,
                                  amount_kobo=_kobo(body.amount_naira), fee_kobo=_kobo(body.fee_naira), reference=body.reference, note=body.note)
        await log_action(db, actor_id=director.id, action="funds.transfer", entity_type="fund_transfer", entity_id=str(t.id), new_value=fs.transfer_out(t))
        return fs.transfer_out(t)
    return await _do(db, go)


class VoidBody(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/transfers/{transfer_id}/void")
async def void_transfer(transfer_id: uuid.UUID, body: VoidBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    async def go():
        t = await fs.void_transfer(db, transfer_id, director.id, body.reason)
        await log_action(db, actor_id=director.id, action="funds.transfer_void", entity_type="fund_transfer", entity_id=str(t.id), new_value={"reason": body.reason})
        return fs.transfer_out(t)
    return await _do(db, go)


class CountBody(BaseModel):
    balance_naira: float = Field(ge=0, le=10_000_000_000)


@router.put("/accounts/{account}")
async def count_account(account: str, body: CountBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    async def go():
        await fs.count_account(db, account, _kobo(body.balance_naira), director.id)
        await log_action(db, actor_id=director.id, action="funds.count", entity_type="fund_account", entity_id=account, new_value={"balance_naira": body.balance_naira})
        return {"ok": True}
    return await _do(db, go)


class BaselineBody(BaseModel):
    capital_naira: float = Field(ge=-10_000_000_000, le=10_000_000_000)
    as_of: date


@router.put("/baseline")
async def set_baseline(body: BaselineBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    async def go():
        await fs.set_baseline(db, _kobo(body.capital_naira), body.as_of, director.id)
        await log_action(db, actor_id=director.id, action="funds.baseline", entity_type="system_config", entity_id="cash.opening_capital",
                         new_value={"capital_naira": body.capital_naira, "as_of": body.as_of.isoformat()})
        return {"ok": True}
    return await _do(db, go)


class CloseBody(BaseModel):
    day: date
    note: str | None = Field(None, max_length=300)
    central_naira: float | None = Field(None, ge=0, le=10_000_000_000)
    other_naira: float | None = Field(None, ge=0, le=10_000_000_000)
    include_due_today: bool = False


@router.post("/close")
async def close_day(body: CloseBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    counted = {k: _kobo(v) for k, v in (("central", body.central_naira), ("other", body.other_naira)) if v is not None}
    async def go():
        c = await fs.close_day(db, body.day, director.id, note=body.note, counted=counted, include_due_today=body.include_due_today)
        await log_action(db, actor_id=director.id, action="funds.close_day", entity_type="day_closing", entity_id=body.day.isoformat(), new_value=fs.closing_out(c))
        return fs.closing_out(c)
    return await _do(db, go)


class ReopenBody(BaseModel):
    day: date


@router.post("/reopen")
async def reopen(body: ReopenBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    async def go():
        await fs.reopen_last(db, body.day)
        await log_action(db, actor_id=director.id, action="funds.reopen_day", entity_type="day_closing", entity_id=body.day.isoformat())
        return {"ok": True}
    return await _do(db, go)


class AutoCloseBody(BaseModel):
    enabled: bool
    time: str = Field("23:55", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


@router.put("/auto-close")
async def set_auto_close(body: AutoCloseBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    await cfg.set_config_value(db, key=fs.AUTO_CLOSE_ENABLED, value="true" if body.enabled else "false", updated_by=director.id)
    await cfg.set_config_value(db, key=fs.AUTO_CLOSE_TIME, value=body.time, updated_by=director.id)
    await log_action(db, actor_id=director.id, action="funds.auto_close", entity_type="system_config", entity_id="cash.auto_close", new_value=body.model_dump())
    await db.commit()
    return {"auto_close_enabled": body.enabled, "auto_close_time": body.time}
