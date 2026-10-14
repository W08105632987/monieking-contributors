"""HTTP API for Techhub NIN/BVN verification. Mounted at /api/v1/verifications."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, CustomerOrOfficer, DirectorOnly
from app.utils.audit import log_action
from app.verification import constants as C
from app.verification import service as svc

router = APIRouter(prefix="/verifications", tags=["verifications"])


class LookupCreate(BaseModel):
    method: str
    fields: dict = Field(default_factory=dict)
    consent: bool = False
    client_request_id: str


class SlipBuy(BaseModel):
    tier: str


class SettingsPatch(BaseModel):
    enabled: bool | None = None
    retention_hours: int | None = None
    nin_auth_url: str | None = None
    lookup_tier: dict[str, str] | None = None
    fees: dict[str, int] | None = None
    slips: dict[str, int] | None = None


def _settings_view(cfg) -> dict:
    return {
        "enabled": cfg.enabled, "retention_hours": cfg.retention_hours, "nin_auth_url": cfg.nin_auth_url,
        "lookup_tier": cfg.lookup_tier, "fees": cfg.fees,
        "slips": {f"{k}.{t}": v for (k, t), v in cfg.slips.items()},
        "missing_fees": cfg.missing_fees(),
    }


def _public_settings(cfg) -> dict:
    """What customers/officers need to render the screens. Only prices that are
    actually set are listed, so an unpriced slip never shows a button."""
    return {
        "enabled": cfg.enabled, "retention_hours": cfg.retention_hours,
        "nin_auth_url": cfg.nin_auth_url or None,
        "fees": {m: v for m, v in cfg.fees.items() if v > 0},
        "slips": {f"{k}.{t}": v for (k, t), v in cfg.slips.items() if v > 0},
    }


@router.get("/status")
async def status(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    cfg = await svc.load_settings(db)
    return {**_public_settings(cfg), "services": await svc.service_status(db, cfg)}


@router.post("/lookups")
async def create_lookup(
    body: LookupCreate, user: CustomerOrOfficer,
    customer_id: uuid.UUID | None = Query(None, description="Required when an officer runs this for a customer"),
    db: AsyncSession = Depends(get_db),
):
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role == "officer":
        if not customer_id:
            raise HTTPException(status_code=400, detail="customer_id is required when an officer runs this on a customer's behalf.")
        target = customer_id
    else:
        target = user.id
    return await svc.create_lookup(db, actor=user, customer_id=target, method=body.method, fields=body.fields,
                                   consent=body.consent, client_request_id=body.client_request_id)


@router.get("/lookups")
async def list_lookups(user: CustomerOrOfficer, customer_id: uuid.UUID | None = Query(None),
                       kind: str | None = Query(None), limit: int = Query(30, ge=1, le=100),
                       db: AsyncSession = Depends(get_db)):
    return await svc.list_lookups(db, actor=user, customer_id=customer_id, limit=limit, kind=kind)


@router.get("/lookups/{lookup_id}")
async def get_lookup(lookup_id: uuid.UUID, user: CustomerOrOfficer, db: AsyncSession = Depends(get_db)):
    row = await svc.get_lookup_for(db, user, lookup_id)
    return await svc.lookup_full_view(db, row)


@router.get("/lookups/{lookup_id}/sheet.pdf")
async def sheet(lookup_id: uuid.UUID, user: CustomerOrOfficer, reveal: bool = Query(False), db: AsyncSession = Depends(get_db)):
    pdf = await svc.sheet_pdf(db, actor=user, lookup_id=lookup_id, reveal=reveal)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="monieking-verification-sheet.pdf"', "Cache-Control": "no-store"})


@router.post("/lookups/{lookup_id}/slips")
async def buy_slip(lookup_id: uuid.UUID, body: SlipBuy, user: CustomerOrOfficer, db: AsyncSession = Depends(get_db)):
    return await svc.buy_slip(db, actor=user, lookup_id=lookup_id, tier=body.tier)


@router.get("/lookups/{lookup_id}/slips/{tier}/pdf")
async def slip_pdf(lookup_id: uuid.UUID, tier: str, user: CustomerOrOfficer, db: AsyncSession = Depends(get_db)):
    pdf = await svc.slip_pdf(db, actor=user, lookup_id=lookup_id, tier=tier)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="monieking-{tier}-slip.pdf"', "Cache-Control": "no-store"})


# ── director ──────────────────────────────────────────────────────────────
@router.get("/admin/settings")
async def admin_get(user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    from app.core.config import settings as env
    from app.verification import crypto
    cfg = await svc.load_settings(db)
    return {**_settings_view(cfg), "services": await svc.service_status(db, cfg),
            "server": {"techhub_key_set": bool(env.TECHHUB_API_KEY), "encryption_key_set": crypto.is_configured()}}


@router.put("/admin/settings")
async def admin_put(body: SettingsPatch, user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    cfg = await svc.save_settings(db, director=user, patch=body.model_dump(exclude_none=True))
    return {**_settings_view(cfg), "services": await svc.service_status(db, cfg)}


@router.post("/admin/health/{kind}/reset")
async def admin_reset(kind: str, user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    if kind not in C.KINDS:
        raise HTTPException(status_code=404, detail="Unknown service.")
    await svc.record_outcome(db, kind, ok=True)
    await log_action(db, actor_id=user.id, action="verification.breaker_reset", entity_type="verification_service", entity_id=kind)
    return {"ok": True}
