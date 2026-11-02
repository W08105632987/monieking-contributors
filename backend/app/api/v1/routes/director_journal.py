"""Director Journal: a book with one section per director. Open a director's journal to read everything they did on any day."""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.director_activity import DirectorActivity
from app.models.user import User, UserRole

router = APIRouter(prefix="/director-journal", tags=["director-journal"])
LAGOS = ZoneInfo("Africa/Lagos")


def _day_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime.combine(d, time.min, tzinfo=LAGOS)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _today() -> date:
    return datetime.now(LAGOS).date()


def _row(a: DirectorActivity) -> dict:
    return {
        "id": str(a.id), "time": a.created_at.astimezone(LAGOS).strftime("%H:%M:%S"), "at": a.created_at.isoformat(),
        "label": a.label, "category": a.category, "sensitive": a.sensitive, "ok": a.status_code < 400,
        "status_code": a.status_code, "method": a.method, "route": a.route or a.path,
        "target_id": str(a.target_id) if a.target_id else None, "target_name": a.target_name,
        "details": a.details, "ip": a.ip_address,
    }


@router.get("/directors")
async def list_directors(me: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Every director (and admin) with how much they did today: the cover of each book."""
    s, e = _day_bounds(_today())
    people = (await db.execute(select(User).where(User.role.in_([UserRole.DIRECTOR, UserRole.ADMIN]), User.deleted_at.is_(None)).order_by(User.full_name))).scalars().all()
    today = {r[0]: r[1] for r in (await db.execute(
        select(DirectorActivity.actor_id, func.count()).where(DirectorActivity.created_at >= s, DirectorActivity.created_at < e).group_by(DirectorActivity.actor_id))).all()}
    total = {r[0]: r[1] for r in (await db.execute(select(DirectorActivity.actor_id, func.count()).group_by(DirectorActivity.actor_id))).all()}
    last = {r[0]: r[1] for r in (await db.execute(select(DirectorActivity.actor_id, func.max(DirectorActivity.created_at)).group_by(DirectorActivity.actor_id))).all()}
    return {"today": _today().isoformat(), "directors": [{
        "id": str(u.id), "name": u.full_name, "role": u.role.value if hasattr(u.role, "value") else str(u.role), "is_me": u.id == me.id,
        "actions_today": today.get(u.id, 0), "actions_total": total.get(u.id, 0),
        "last_action_at": last[u.id].isoformat() if last.get(u.id) else None,
    } for u in people]}


@router.get("/{director_id}")
async def read_day(director_id: uuid.UUID, me: DirectorOnly, day: date | None = None, category: str | None = None,
                   sensitive_only: bool = False, q: str | None = Query(default=None, max_length=80), db: AsyncSession = Depends(get_db)):
    """One page of the book: everything this director did on `day` (default today), oldest first."""
    who = await db.get(User, director_id)
    if not who or who.role not in (UserRole.DIRECTOR, UserRole.ADMIN):
        raise HTTPException(404, "Director not found")
    d = day or _today()
    s, e = _day_bounds(d)
    conds = [DirectorActivity.actor_id == director_id, DirectorActivity.created_at >= s, DirectorActivity.created_at < e]
    if category:
        conds.append(DirectorActivity.category == category)
    if sensitive_only:
        conds.append(DirectorActivity.sensitive.is_(True))
    if q:
        like = f"%{q.strip()}%"
        conds.append((DirectorActivity.label.ilike(like)) | (DirectorActivity.target_name.ilike(like)))
    rows = (await db.execute(select(DirectorActivity).where(and_(*conds)).order_by(DirectorActivity.created_at.asc()).limit(1000))).scalars().all()
    cats = (await db.execute(select(DirectorActivity.category, func.count()).where(
        DirectorActivity.actor_id == director_id, DirectorActivity.created_at >= s, DirectorActivity.created_at < e).group_by(DirectorActivity.category))).all()
    return {"director": {"id": str(who.id), "name": who.full_name}, "day": d.isoformat(),
            "count": len(rows), "categories": {c: n for c, n in cats}, "entries": [_row(a) for a in rows]}


@router.get("/{director_id}/calendar")
async def calendar(director_id: uuid.UUID, me: DirectorOnly, month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"), db: AsyncSession = Depends(get_db)):
    """How many actions per day in a month, so the book can show which pages have writing on them."""
    t = _today()
    y, m = (int(month[:4]), int(month[5:])) if month else (t.year, t.month)
    first = date(y, m, 1)
    nxt = date(y + (m == 12), (m % 12) + 1, 1)
    s, _ = _day_bounds(first)
    e, _ = _day_bounds(nxt)
    day = func.date(func.timezone("Africa/Lagos", DirectorActivity.created_at))
    rows = (await db.execute(select(day, func.count()).where(DirectorActivity.actor_id == director_id, DirectorActivity.created_at >= s, DirectorActivity.created_at < e).group_by(day))).all()
    return {"month": f"{y:04d}-{m:02d}", "days": {r[0].isoformat(): r[1] for r in rows}}
