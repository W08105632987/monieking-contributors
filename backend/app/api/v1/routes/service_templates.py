"""
Service Templates (Phase 2): READ-ONLY.
=======================================
Nothing in the customer app uses these yet; Phase 3 switches services over one
at a time. Publishing/editing endpoints arrive with the director builder (Phase 4).
"""
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOrAdmin
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.services import manual_pricing as mp
from app.services import service_template_engine as eng
from app.services.service_template_parity import parity_report
from app.services.settings_service import get_config_value, invalidate_config_cache, set_config_value
from app.utils.audit import log_action

router = APIRouter(prefix="/service-templates", tags=["service-templates"])

LIVE_KEY = "service_templates_live"


async def _live_codes(db: AsyncSession) -> list[str]:
    raw = await get_config_value(db, LIVE_KEY)
    try:
        data = json.loads(raw) if raw else []
    except Exception:
        return []
    return sorted({str(c) for c in data}) if isinstance(data, list) else []


class LiveBody(BaseModel):
    codes: list[str]


class EnabledBody(BaseModel):
    is_enabled: bool


async def _load(db: AsyncSession, code: str) -> tuple[ServiceTemplate, ServiceTemplateVersion]:
    service_code = mp.resolve_category(code)
    tpl = await db.scalar(select(ServiceTemplate).where(ServiceTemplate.service_code == service_code))
    if not tpl or tpl.archived_at is not None or not tpl.current_version_id:
        raise HTTPException(status_code=404, detail="This service isn't available.")
    ver = await db.get(ServiceTemplateVersion, tpl.current_version_id)
    if not ver:
        raise HTTPException(status_code=404, detail="This service isn't available.")
    return tpl, ver


def tpl_price_matrix(ver: ServiceTemplateVersion) -> list:
    return eng.price_matrix(ver.schema, ver.price_rules)


def _public_schema(schema: dict) -> dict:
    """Everything a form needs to render. (No price rules: customers get a quote from the backend.)"""
    return {k: v for k, v in schema.items() if k in {
        "schema_version", "selectors", "fields", "legacy_extras", "uploaded_file_fields",
        "quantity_from", "fixed_service_type", "legacy_key_aliases",
    }}


# NOTE: "admin/..." routes are declared before "/{code}" so they are not read as a service code.
@router.get("/admin/live")
async def get_live_services(current_user: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    """Which services currently use the template flow (everything else still uses the original forms)."""
    return {"codes": await _live_codes(db)}


@router.patch("/admin/live")
async def set_live_services(body: LiveBody, current_user: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    """
    Switch services between the original forms and the template flow. This is the rollback switch:
    remove a code to send that service straight back to its original form. Takes effect within ~90 seconds
    across servers (settings are cached briefly), immediately on the server that handled this call.
    """
    wanted = sorted({mp.resolve_category(c) for c in body.codes})
    existing = set((await db.scalars(select(ServiceTemplate.service_code))).all())
    unknown = [c for c in wanted if c not in existing]
    if unknown:
        raise HTTPException(status_code=422, detail=f"No template exists for: {', '.join(unknown)}")
    before = await _live_codes(db)
    await set_config_value(db, key=LIVE_KEY, value=json.dumps(wanted), updated_by=current_user.id)
    await db.commit()
    invalidate_config_cache(LIVE_KEY)
    return {"codes": wanted, "previous": before}


@router.patch("/{code}/enabled")
async def set_template_enabled(
    code: str, body: EnabledBody, current_user: DirectorOrAdmin, db: AsyncSession = Depends(get_db),
):
    """The director's on/off switch for a service. Takes effect immediately for new orders."""
    service_code = mp.resolve_category(code)
    tpl = await db.scalar(select(ServiceTemplate).where(ServiceTemplate.service_code == service_code))
    if not tpl or tpl.archived_at is not None:
        raise HTTPException(status_code=404, detail="This service isn't available.")
    old = tpl.is_enabled
    tpl.is_enabled = body.is_enabled
    tpl.updated_by = current_user.id
    await log_action(
        db, actor_id=current_user.id, action="service_template.enabled_changed",
        entity_type="service_template", entity_id=str(tpl.id),
        old_value={"is_enabled": old, "service_code": service_code},
        new_value={"is_enabled": body.is_enabled, "service_code": service_code},
    )
    await db.commit()
    return {"service_code": service_code, "is_enabled": tpl.is_enabled}



@router.get("/admin/parity")
async def template_price_parity(current_user: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    """
    Read-only safety check for the director/Antigravity: for every option of every
    template, is the template engine's price identical to what the current charge
    function charges? `mismatches` must be empty.
    """
    price_map = mp.merge_price_map(await get_config_value(db, "manual_services_pricing"))
    tpls = (await db.scalars(select(ServiceTemplate).where(ServiceTemplate.archived_at.is_(None)))).all()
    templates: dict = {}
    for t in tpls:
        if t.current_version_id:
            v = await db.get(ServiceTemplateVersion, t.current_version_id)
            if v:
                templates[t.service_code] = (v.schema, v.price_rules)
    report = parity_report(templates, price_map)
    return {"templates": sorted(templates), **report}


@router.get("")
async def list_templates(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    tpls = (await db.scalars(
        select(ServiceTemplate).where(ServiceTemplate.archived_at.is_(None)).order_by(ServiceTemplate.title)
    )).all()
    live = set(await _live_codes(db))
    return [
        {"service_code": t.service_code, "title": t.title, "description": t.description,
         "kind": t.kind, "is_enabled": t.is_enabled, "live": t.service_code in live}
        for t in tpls
    ]


@router.get("/{code}")
async def get_template(code: str, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    tpl, ver = await _load(db, code)
    live = tpl.service_code in set(await _live_codes(db))
    return {
        "service_code": tpl.service_code, "title": tpl.title, "description": tpl.description,
        "kind": tpl.kind, "is_enabled": tpl.is_enabled, "live": live,
        "version_id": str(ver.id), "version": ver.version,
        "schema": _public_schema(ver.schema),
        # Unit price of every combination of options, computed by the same engine that charges.
        # Only sent for live services, so a screen never shows a price the charge doesn't use.
        "price_matrix": tpl_price_matrix(ver) if live else [],
    }


@router.get("/{code}/admin")
async def get_template_admin(code: str, current_user: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    """Director view: also returns price rules, validation warnings and the version history."""
    tpl, ver = await _load(db, code)
    errors, warnings = eng.validate_price_rules(ver.price_rules, ver.schema)
    versions = (await db.scalars(
        select(ServiceTemplateVersion).where(ServiceTemplateVersion.template_id == tpl.id)
        .order_by(ServiceTemplateVersion.version.desc())
    )).all()
    return {
        "service_code": tpl.service_code, "title": tpl.title, "is_enabled": tpl.is_enabled,
        "version_id": str(ver.id), "version": ver.version,
        "schema": ver.schema, "price_rules": ver.price_rules,
        "schema_errors": eng.validate_schema(ver.schema),
        "price_errors": errors, "price_warnings": warnings,
        "versions": [{"id": str(v.id), "version": v.version, "note": v.note,
                      "created_at": v.created_at.isoformat() if v.created_at else None} for v in versions],
    }
