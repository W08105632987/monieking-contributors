"""Director control of the wallet funding fee: on/off, price ranges, what we lose when it's off, funding statistics."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.funding_fee import FundingRecord
from app.services.funding_fees import DEFAULT_TIERS, get_settings, validate_tiers
from app.utils.audit import log_action

router = APIRouter(prefix="/director/funding-fees", tags=["funding-fees"])


class SettingsBody(BaseModel):
    charge_customers: bool
    pass_monnify_fee: bool = False
    tiers: list[dict]


def _out(row) -> dict:
    return {"charge_customers": row.charge_customers, "pass_monnify_fee": row.pass_monnify_fee, "tiers": row.tiers, "defaults": DEFAULT_TIERS, "updated_at": row.updated_at}


@router.get("")
async def read_settings(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    row = await get_settings(db)
    await db.commit()
    return _out(row)


@router.post("/validate")
async def validate(body: SettingsBody, director: DirectorOnly):
    return {"problems": validate_tiers(body.tiers)}


@router.put("")
async def save_settings(body: SettingsBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    problems = validate_tiers(body.tiers) if (body.charge_customers and not body.pass_monnify_fee) else []
    if problems:
        raise HTTPException(status_code=422, detail=problems[0] + (f" (+{len(problems) - 1} more)" if len(problems) > 1 else ""))
    row = await get_settings(db)
    old = {"charge_customers": row.charge_customers, "pass_monnify_fee": row.pass_monnify_fee, "tiers": row.tiers}
    row.charge_customers = body.charge_customers
    row.pass_monnify_fee = body.pass_monnify_fee
    row.tiers = [{"from": int(t["from"]), "to": (None if t.get("to") in (None, "") else int(t["to"])), "fee": float(t["fee"])} for t in body.tiers]
    row.updated_by = director.id
    row.updated_at = datetime.now(timezone.utc)
    await log_action(db, actor_id=director.id, action="funding_fee.updated", entity_type="funding_fee_settings", entity_id="1",
                     old_value=old, new_value={"charge_customers": row.charge_customers, "pass_monnify_fee": row.pass_monnify_fee, "tiers": row.tiers})
    await db.commit()
    return _out(row)


def _window(start: datetime | None, end: datetime | None):
    end = end or datetime.now(timezone.utc)
    start = start or end - timedelta(days=30)
    return start, end


@router.get("/summary")
async def summary(director: DirectorOnly, db: AsyncSession = Depends(get_db), start: datetime | None = None, end: datetime | None = None):
    """What fundings cost us in a period: fees we absorbed (charging off), fees collected, and the per-fee breakdown."""
    start, end = _window(start, end)
    R = FundingRecord
    where = and_(R.created_at >= start, R.created_at <= end)
    tot = (await db.execute(select(func.count(), func.coalesce(func.sum(R.gross_kobo), 0), func.coalesce(func.sum(R.customer_fee_kobo), 0),
                                   func.coalesce(func.sum(R.monnify_fee_kobo), 0)).where(where))).one()
    absorbed = (await db.execute(select(func.count(), func.coalesce(func.sum(R.monnify_fee_kobo), 0))
                                 .where(where, R.customer_fee_kobo == 0, R.monnify_fee_kobo.is_not(None)))).one()
    charged = (await db.execute(select(func.count(), func.coalesce(func.sum(R.customer_fee_kobo), 0), func.coalesce(func.sum(R.monnify_fee_kobo), 0))
                                .where(where, R.customer_fee_kobo > 0))).one()
    unknown = (await db.execute(select(func.count()).where(where, R.monnify_fee_kobo.is_(None)))).scalar_one()
    by_fee = (await db.execute(select(R.monnify_fee_kobo, func.count(), func.sum(R.monnify_fee_kobo))
                               .where(where, R.customer_fee_kobo == 0, R.monnify_fee_kobo.is_not(None), R.monnify_fee_kobo > 0)
                               .group_by(R.monnify_fee_kobo).order_by(R.monnify_fee_kobo))).all()
    return {
        "start": start, "end": end,
        "fundings": tot[0], "total_funded_kobo": int(tot[1]),
        "monnify_fees_kobo": int(tot[3]),
        "absorbed": {"count": absorbed[0], "lost_kobo": int(absorbed[1])},
        "charged": {"count": charged[0], "collected_kobo": int(charged[1]), "monnify_fee_kobo": int(charged[2]),
                    "profit_kobo": int(charged[1]) - int(charged[2])},
        "fee_unknown_count": unknown,
        "by_monnify_fee": [{"monnify_fee_kobo": int(f), "count": int(c), "lost_kobo": int(t)} for f, c, t in by_fee],
    }


@router.get("/stats")
async def stats(director: DirectorOnly, db: AsyncSession = Depends(get_db), months: int = Query(3, ge=1, le=12)):
    """How customers fund: monthly totals/averages, size distribution, overall averages for the last N months."""
    since = datetime.now(timezone.utc) - timedelta(days=30 * months)
    R = FundingRecord
    month = func.date_trunc("month", R.created_at)
    rows = (await db.execute(select(month, func.count(), func.sum(R.gross_kobo), func.avg(R.gross_kobo), func.count(func.distinct(R.user_id)))
                             .where(R.created_at >= since).group_by(month).order_by(month))).all()
    overall = (await db.execute(select(func.count(), func.coalesce(func.sum(R.gross_kobo), 0), func.coalesce(func.avg(R.gross_kobo), 0),
                                       func.coalesce(func.max(R.gross_kobo), 0), func.count(func.distinct(R.user_id)),
                                       func.coalesce(func.percentile_cont(0.5).within_group(R.gross_kobo), 0)).where(R.created_at >= since))).one()
    edges = [(0, 100000, "Under ₦1,000"), (100000, 500000, "₦1,000 – ₦5,000"), (500000, 1000000, "₦5,001 – ₦10,000"),
             (1000000, 2000000, "₦10,001 – ₦20,000"), (2000000, None, "Above ₦20,000")]
    dist = []
    for lo, hi, label in edges:
        cond = [R.created_at >= since, R.gross_kobo >= lo] + ([R.gross_kobo < hi] if hi else [])
        n = (await db.execute(select(func.count()).where(*cond))).scalar_one()
        dist.append({"label": label, "count": n})
    return {
        "months": months,
        "monthly": [{"month": m.strftime("%b %Y"), "fundings": int(c), "total_kobo": int(t or 0), "average_kobo": int(a or 0), "customers": int(u)} for m, c, t, a, u in rows],
        "overall": {"fundings": int(overall[0]), "total_kobo": int(overall[1]), "average_kobo": int(overall[2]), "largest_kobo": int(overall[3]),
                    "customers": int(overall[4]), "median_kobo": int(overall[5]),
                    "avg_per_customer_kobo": int(overall[1] / overall[4]) if overall[4] else 0},
        "distribution": dist,
    }
