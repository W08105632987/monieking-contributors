"""Director: bring offline customers into the app, by zone. Single add, Excel bulk add, waiting list, undo."""
import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.offline_import import OfflineImportBatch, PendingOfflineCustomer
from app.models.zone import Zone
from app.services import offline_import as svc
from app.utils.audit import log_action

router = APIRouter(prefix="/zonal-customers", tags=["zonal-customers"])


@router.get("/template.xlsx")
async def template(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    names = [z.name for z in (await db.execute(select(Zone).order_by(Zone.name))).scalars().all()]
    return StreamingResponse(io.BytesIO(svc.build_template(names)),
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="MonieKing-Offline-Customers-Template.xlsx"'})


@router.post("/import/preview")
async def import_preview(director: DirectorOnly, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    try:
        pv = await svc.preview(db, await file.read())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    pv["rows"] = [svc._public(r) for r in pv["rows"]]
    return pv


@router.post("/import/commit")
async def import_commit(director: DirectorOnly, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    try:
        out = await svc.commit(db, data=await file.read(), filename=file.filename, director_id=director.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await log_action(db, actor_id=director.id, action="offline_import.committed", entity_type="offline_import_batch",
                     entity_id=out["batch_id"], new_value=dict(out))
    phones = {r.phone_number for r in (await db.execute(select(PendingOfflineCustomer).where(
        PendingOfflineCustomer.batch_id == uuid.UUID(out["batch_id"]), PendingOfflineCustomer.handled_by == "officer",
        PendingOfflineCustomer.claimed_at.is_(None)))).scalars().all()}
    if phones:
        out = await _finish_officer_accounts(db, director, out, phones)
    await db.commit()
    return out


class CardIn(BaseModel):
    card_type: str = "regular"
    rate_naira: int = Field(gt=0)
    days_contributed: int = Field(0, ge=0, le=372)
    days_withdrawn: int = Field(0, ge=0, le=372)
    start_date: str | None = None
    notes: str | None = None


class SingleBody(BaseModel):
    """One person with one OR MANY cards (`cards`). The old one-card fields still work."""
    full_name: str = Field(min_length=2, max_length=200)
    phone_number: str
    zone_id: uuid.UUID
    handled_by: str = "self"
    cards: list[CardIn] | None = Field(None, min_length=1, max_length=10)
    card_type: str = "regular"
    rate_naira: int | None = Field(None, gt=0)
    days_contributed: int = Field(0, ge=0, le=372)
    days_withdrawn: int = Field(0, ge=0, le=372)
    notes: str | None = None


async def _finish_officer_accounts(db: AsyncSession, director, out: dict, phones: set[str]) -> dict:
    """Officer-handled people get a real account in their zone straight away (see offline_import.create_officer_customers)."""
    acc = await svc.create_officer_customers(db, director_id=director.id, phones=phones)
    out["created_accounts"] = acc["created"]
    out["failed_accounts"] = acc["failed"]
    out["attached"] = bool(out.get("linked_now")) or bool(acc["created"])
    if acc["created"] or acc["failed"]:
        await log_action(db, actor_id=director.id, action="offline_import.officer_accounts", entity_type="offline_import_batch",
                         entity_id=out["batch_id"], new_value={"created": len(acc["created"]), "failed": len(acc["failed"])})
    return out


@router.post("/single")
async def add_single(body: SingleBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    cards = body.cards or ([CardIn(card_type=body.card_type, rate_naira=body.rate_naira, days_contributed=body.days_contributed,
                                   days_withdrawn=body.days_withdrawn, notes=body.notes)] if body.rate_naira else [])
    if not cards:
        raise HTTPException(status_code=400, detail="Add at least one card with its daily amount")
    zone = await db.get(Zone, body.zone_id)
    zones = await svc.zone_map(db)
    rows, problems = [], []
    for i, c in enumerate(cards, 1):
        raw = {"Full name": body.full_name, "Phone number": body.phone_number, "Zone": zone.name if zone else "",
               "Card type": c.card_type, "Daily rate (₦)": c.rate_naira, "Days contributed so far": c.days_contributed,
               "Days already withdrawn": c.days_withdrawn, "Card start date": c.start_date, "Handled by": body.handled_by, "Notes": c.notes}
        v = svc.validate_row(raw, zones)
        if not v["errors"] and await svc.waiting_duplicate(db, v):
            v["errors"].append("An identical card is already waiting for this person. If it is a real second identical card, write 'Card 2' in Notes")
        prefix = f"Card {i}: " if len(cards) > 1 else ""
        problems += [prefix + e for e in v["errors"]]
        rows.append(v)
    if problems:
        raise HTTPException(status_code=400, detail="; ".join(problems))
    out = await svc.stage_rows(db, rows=rows, source="single", filename=None, director_id=director.id)
    await log_action(db, actor_id=director.id, action="offline_import.single", entity_type="offline_import_batch", entity_id=out["batch_id"],
                     new_value={"phone": rows[0]["phone_number"], "cards": len(rows)})
    if body.handled_by == "officer":
        out = await _finish_officer_accounts(db, director, out, {rows[0]["phone_number"]})
    out["cards"] = len(rows)
    await db.commit()
    return out


@router.post("/officer-accounts")
async def create_officer_accounts(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Catch-up for officer-handled people added before this existed: give each a real account under their zone's officer."""
    acc = await svc.create_officer_customers(db, director_id=director.id, phones=None)
    await log_action(db, actor_id=director.id, action="offline_import.officer_accounts_backfill", entity_type="offline_import_batch",
                     entity_id="backfill", new_value={"created": len(acc["created"]), "failed": len(acc["failed"])})
    await db.commit()
    return {"created_accounts": acc["created"], "failed_accounts": acc["failed"]}


@router.get("/waiting")
async def waiting(director: DirectorOnly, zone_id: uuid.UUID | None = None, q: str | None = None,
                  claimed: bool | None = None, db: AsyncSession = Depends(get_db)):
    stmt = select(PendingOfflineCustomer, Zone.name).join(Zone, Zone.id == PendingOfflineCustomer.zone_id).order_by(PendingOfflineCustomer.created_at.desc()).limit(500)
    if zone_id:
        stmt = stmt.where(PendingOfflineCustomer.zone_id == zone_id)
    if claimed is True:
        stmt = stmt.where(PendingOfflineCustomer.claimed_at.is_not(None))
    elif claimed is False:
        stmt = stmt.where(PendingOfflineCustomer.claimed_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(PendingOfflineCustomer.full_name.ilike(like) | PendingOfflineCustomer.phone_number.ilike(like))
    rows = (await db.execute(stmt)).all()
    return [{
        "id": str(p.id), "full_name": p.full_name, "phone_number": p.phone_number, "zone": zn, "card_type": p.card_type,
        "rate_kobo": p.rate_kobo, "days_contributed": p.days_contributed, "days_withdrawn": p.days_withdrawn,
        "handled_by": p.handled_by, "claimed": p.claimed_at is not None, "batch_id": str(p.batch_id) if p.batch_id else None,
        "created_at": p.created_at.isoformat(),
    } for p, zn in rows]


@router.delete("/waiting/{pending_id}")
async def remove_waiting(pending_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    p = await db.get(PendingOfflineCustomer, pending_id)
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    if p.claimed_at:
        raise HTTPException(status_code=400, detail="This person already signed up — their card is on their account.")
    await db.delete(p)
    await db.commit()
    return {"removed": True}


@router.get("/zones")
async def zone_overview(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(text("""
        SELECT z.id::text, z.name,
               (SELECT count(*) FROM users u WHERE u.zone_id = z.id AND u.role = 'customer') AS customers,
               (SELECT count(*) FROM pending_offline_customers p WHERE p.zone_id = z.id AND p.claimed_at IS NULL) AS waiting
          FROM zones z ORDER BY z.name"""))).all()
    return [{"id": r[0], "name": r[1], "customers": r[2], "waiting": r[3]} for r in rows]


@router.get("/batches")
async def batches(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(OfflineImportBatch).order_by(OfflineImportBatch.created_at.desc()).limit(50))).scalars().all()
    return [{"id": str(b.id), "source": b.source, "filename": b.filename, "row_count": b.row_count,
             "created_at": b.created_at.isoformat(), "undone": b.undone_at is not None} for b in rows]


@router.post("/batches/{batch_id}/undo")
async def undo(batch_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    try:
        out = await svc.undo_batch(db, batch_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await log_action(db, actor_id=director.id, action="offline_import.undone", entity_type="offline_import_batch", entity_id=str(batch_id), new_value=out)
    await db.commit()
    return out
