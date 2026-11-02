"""Food Collection Center > Food Conversion: the completion deadline, who is behind, and reminders (single or bulk)."""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.card import ContributionCard
from app.models.user import User
from app.services import food_conversion_service as svc
from app.services.settings_service import set_config_value

router = APIRouter(prefix="/food-conversion", tags=["food-conversion"])


@router.get("/summary")
async def get_summary(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    return await svc.summary(db)


@router.get("/customers")
async def customers(director: DirectorOnly, db: AsyncSession = Depends(get_db), q: str | None = Query(default=None, max_length=60),
                    zone_id: uuid.UUID | None = None, max_percent: int | None = Query(default=None, ge=0, le=100),
                    min_percent: int | None = Query(default=None, ge=0, le=100), reminded: str | None = Query(default=None, pattern="^(never|reminded)$"),
                    limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0)):
    r = await svc.list_unfinished(db, q=q, zone_id=zone_id, max_percent=max_percent, min_percent=min_percent, reminded=reminded, limit=limit, offset=offset)
    r.pop("_all_ids")
    return r


class DeadlineIn(BaseModel):
    deadline: date


@router.put("/deadline")
async def set_deadline(body: DeadlineIn, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    if body.deadline < svc.today():
        raise HTTPException(422, "Choose today or a future date. A past date would convert every unfinished Food Card tonight.")
    await set_config_value(db, key=svc.DEADLINE_KEY, value=body.deadline.isoformat(), updated_by=director.id)
    return await svc.summary(db)


class TemplateIn(BaseModel):
    template: str = Field(min_length=10, max_length=800)


@router.put("/template")
async def set_template(body: TemplateIn, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    await set_config_value(db, key=svc.TEMPLATE_KEY, value=body.template.strip(), updated_by=director.id)
    return {"template": body.template.strip()}


class RemindIn(BaseModel):
    message: str = Field(min_length=10, max_length=800)
    customer_ids: list[uuid.UUID] | None = None     # one or a few customers…
    everyone_matching: bool = False                 # …or everyone who matches the filters below
    q: str | None = None
    zone_id: uuid.UUID | None = None
    max_percent: int | None = Field(default=None, ge=0, le=100)
    min_percent: int | None = Field(default=None, ge=0, le=100)
    reminded: str | None = Field(default=None, pattern="^(never|reminded)$")
    dry_run: bool = False
    save_as_default: bool = False


@router.post("/remind")
async def remind(body: RemindIn, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Send the (edited) warning in-app and as a push to the chosen food contributors."""
    if body.everyone_matching:
        r = await svc.list_unfinished(db, q=body.q, zone_id=body.zone_id, max_percent=body.max_percent, min_percent=body.min_percent,
                                      reminded=body.reminded, limit=1, offset=0)
        ids = [uuid.UUID(x) for x in r["_all_ids"]]
    else:
        ids = body.customer_ids or []
    if not ids:
        raise HTTPException(400, "Nobody matches. Choose at least one customer.")
    if body.save_as_default and not body.dry_run:
        await set_config_value(db, key=svc.TEMPLATE_KEY, value=body.message.strip(), updated_by=director.id)
    try:
        return await svc.remind(db, director=director, customer_ids=ids, template=body.message, dry_run=body.dry_run)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/convert-now")
async def convert_now(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Only after the deadline has passed: run the conversion immediately instead of waiting for tonight's job."""
    r = await svc.convert_overdue(db, actor_id=director.id)
    if r.get("reason") == "deadline_not_passed":
        raise HTTPException(409, f"The deadline is {r['deadline']}. Cards can only be converted automatically after it has passed.")
    return r


@router.get("/converted")
async def converted(director: DirectorOnly, db: AsyncSession = Depends(get_db), limit: int = Query(default=100, ge=1, le=300)):
    rows = (await db.execute(select(ContributionCard, User.full_name, User.customer_number).join(User, User.id == ContributionCard.owner_id)
                             .where(ContributionCard.auto_converted_at.is_not(None)).order_by(ContributionCard.auto_converted_at.desc()).limit(limit))).all()
    return [{"card_id": str(c.id), "card_number": c.card_number, "customer": n, "customer_number": num, "days_done": c.total_days_contributed,
             "converted_at": c.auto_converted_at.isoformat()} for c, n, num in rows]
