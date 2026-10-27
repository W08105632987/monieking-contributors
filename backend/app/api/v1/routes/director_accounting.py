"""Accounting Center: director-only. Revenue and costs per service, price book, expenses, cash to hold."""
import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.accounting import AccountingSettings, CostRate, Expense
from app.services import accounting_service as svc
from app.utils.audit import log_action

router = APIRouter(prefix="/director/accounting", tags=["accounting"])

DEFAULT_CATEGORIES = ["Salaries", "Rent", "Internet and hosting", "Marketing", "Transport", "Office", "Taxes and fees", "Other"]


def _period(start: date | None, end: date | None) -> tuple[date, date]:
    today = datetime.now(svc.WAT).date()
    end = end or today
    start = start or end - timedelta(days=29)
    if start > end:
        raise HTTPException(status_code=422, detail="The start date is after the end date.")
    if (end - start).days > 800:
        raise HTTPException(status_code=422, detail="Pick a period of at most 800 days.")
    return start, end


# ── overview ──────────────────────────────────────────────────────────────
@router.get("/report")
async def get_report(director: DirectorOnly, start: date | None = None, end: date | None = None, series: bool = True, db: AsyncSession = Depends(get_db)):
    a, b = _period(start, end)
    return await svc.report(db, a, b, series)


@router.get("/holdings")
async def get_holdings(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    return await svc.holdings(db)


class SettingsBody(BaseModel):
    buffer_days: int = Field(ge=0, le=365)


@router.put("/settings")
async def save_settings(body: SettingsBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    row = await db.get(AccountingSettings, 1)
    if row is None:
        row = AccountingSettings(id=1, buffer_days=body.buffer_days)
        db.add(row)
    old = row.buffer_days
    row.buffer_days = body.buffer_days
    row.updated_at = datetime.now(timezone.utc)
    await log_action(db, actor_id=director.id, action="accounting.settings", entity_type="accounting_settings", entity_id="1", old_value={"buffer_days": old}, new_value={"buffer_days": body.buffer_days})
    await db.commit()
    return await svc.holdings(db)


# ── price book ────────────────────────────────────────────────────────────
def _rate_out(r: CostRate) -> dict:
    return {"id": str(r.id), "mode": r.mode, "value": float(r.value), "cap_kobo": r.cap_kobo, "effective_from": r.effective_from, "note": r.note}


@router.get("/rates")
async def list_rates(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    items = await svc.catalog(db)
    rates = await svc._all_rates(db)
    now = datetime.now(timezone.utc)
    out = []
    for it in items:
        hist = rates.get(it["key"], [])
        cur = [r for r in hist if r.effective_from <= now]
        out.append({**it, "current": _rate_out(cur[-1]) if cur else None, "history": [_rate_out(r) for r in reversed(hist)]})
    return {"rates": out}


class RateBody(BaseModel):
    rate_key: str
    mode: str = "flat"
    value: float = Field(ge=0)
    cap_kobo: int | None = Field(default=None, ge=0)
    effective_from: date | None = None
    note: str | None = Field(default=None, max_length=300)


@router.post("/rates")
async def set_rate(body: RateBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    keys = {i["key"] for i in await svc.catalog(db)}
    if body.rate_key not in keys:
        raise HTTPException(status_code=404, detail="That cost is not in the price book.")
    if body.mode not in ("flat", "percent"):
        raise HTTPException(status_code=422, detail="Choose a flat amount or a percentage.")
    if body.mode == "percent" and body.value > 100:
        raise HTTPException(status_code=422, detail="A percentage cannot be more than 100.")
    when = datetime(body.effective_from.year, body.effective_from.month, body.effective_from.day, tzinfo=svc.WAT) if body.effective_from else datetime.now(timezone.utc)
    row = CostRate(rate_key=body.rate_key, mode=body.mode, value=body.value, cap_kobo=(body.cap_kobo if body.mode == "percent" else None), effective_from=when, note=body.note, created_by=director.id)
    db.add(row)
    await log_action(db, actor_id=director.id, action="accounting.rate_set", entity_type="cost_rate", entity_id=body.rate_key, old_value=None,
                     new_value={"mode": body.mode, "value": body.value, "cap_kobo": row.cap_kobo, "effective_from": when.isoformat()})
    await db.commit()
    return _rate_out(row)


# ── expenses (no month lock: add, edit, delete any time) ──────────────────
class ExpenseBody(BaseModel):
    spent_on: date
    category: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=1, max_length=300)
    amount_naira: float = Field(gt=0)


def _exp_out(x: Expense) -> dict:
    return {"id": str(x.id), "spent_on": x.spent_on.isoformat(), "category": x.category, "description": x.description, "amount_kobo": x.amount_kobo, "created_at": x.created_at}


@router.get("/expenses")
async def list_expenses(director: DirectorOnly, start: date | None = None, end: date | None = None, db: AsyncSession = Depends(get_db)):
    a, b = _period(start, end)
    rows = (await db.execute(select(Expense).where(Expense.spent_on >= a, Expense.spent_on <= b).order_by(Expense.spent_on.desc(), Expense.created_at.desc()))).scalars().all()
    used = [c for (c,) in (await db.execute(select(Expense.category).distinct())).all()]
    cats = sorted(set(DEFAULT_CATEGORIES) | set(used), key=lambda c: (c == "Other", c))
    return {"expenses": [_exp_out(x) for x in rows], "total_kobo": sum(x.amount_kobo for x in rows), "categories": cats}


@router.post("/expenses")
async def add_expense(body: ExpenseBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    x = Expense(spent_on=body.spent_on, category=body.category.strip(), description=body.description.strip(), amount_kobo=round(body.amount_naira * 100), created_by=director.id)
    db.add(x)
    await db.flush()
    await log_action(db, actor_id=director.id, action="accounting.expense_added", entity_type="expense", entity_id=str(x.id), old_value=None, new_value=_exp_out(x) | {"created_at": None})
    await db.commit()
    return _exp_out(x)


@router.put("/expenses/{expense_id}")
async def edit_expense(expense_id: uuid.UUID, body: ExpenseBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    x = await db.get(Expense, expense_id)
    if x is None:
        raise HTTPException(status_code=404, detail="Expense not found.")
    old = _exp_out(x) | {"created_at": None}
    x.spent_on, x.category, x.description = body.spent_on, body.category.strip(), body.description.strip()
    x.amount_kobo = round(body.amount_naira * 100)
    await log_action(db, actor_id=director.id, action="accounting.expense_edited", entity_type="expense", entity_id=str(x.id), old_value=old, new_value=_exp_out(x) | {"created_at": None})
    await db.commit()
    return _exp_out(x)


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    x = await db.get(Expense, expense_id)
    if x is None:
        raise HTTPException(status_code=404, detail="Expense not found.")
    await log_action(db, actor_id=director.id, action="accounting.expense_deleted", entity_type="expense", entity_id=str(x.id), old_value=_exp_out(x) | {"created_at": None}, new_value=None)
    await db.delete(x)
    await db.commit()
    return {"deleted": True}


# ── export ────────────────────────────────────────────────────────────────
def _naira(k: int) -> str:
    return f"{k / 100:.2f}"


@router.get("/export.csv")
async def export_csv(director: DirectorOnly, start: date | None = None, end: date | None = None, db: AsyncSession = Depends(get_db)):
    a, b = _period(start, end)
    rep = await svc.report(db, a, b, series=False)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"MonieKing accounts {a} to {b}"])
    w.writerow(["Service", "Group", "Count", "Revenue (NGN)", "Provider cost (NGN)", "Margin (NGN)", "Cost source", "Events with no price"])
    for r in rep["services"]:
        w.writerow([r["label"], r["group"], r["count"], _naira(r["revenue_kobo"]), _naira(r["cost_kobo"]), _naira(r["margin_kobo"]), r["cost_source"], r["unpriced_events"]])
    t = rep["totals"]
    w.writerow([])
    w.writerow(["Revenue", _naira(t["revenue_kobo"])])
    w.writerow(["Provider costs", _naira(t["provider_cost_kobo"])])
    w.writerow(["Gross profit", _naira(t["gross_profit_kobo"])])
    w.writerow(["Expenses", _naira(t["expenses_kobo"])])
    w.writerow(["Net profit", _naira(t["net_profit_kobo"])])
    w.writerow([])
    w.writerow(["Expense date", "Category", "Description", "Amount (NGN)"])
    rows = (await db.execute(select(Expense).where(Expense.spent_on >= a, Expense.spent_on <= b).order_by(Expense.spent_on))).scalars().all()
    for x in rows:
        w.writerow([x.spent_on.isoformat(), x.category, x.description, _naira(x.amount_kobo)])
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="monieking-accounts-{a}-{b}.csv"'})
