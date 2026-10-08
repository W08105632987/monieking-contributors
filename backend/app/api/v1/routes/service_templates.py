"""
Service Templates (Phase 2): READ-ONLY.
=======================================
Nothing in the customer app uses these yet; Phase 3 switches services over one
at a time. Publishing/editing endpoints arrive with the director builder (Phase 4).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOrAdmin
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.services import manual_pricing as mp
from app.services import service_template_engine as eng
from app.services.service_template_parity import parity_report
from app.services.settings_service import get_config_value

router = APIRouter(prefix="/service-templates", tags=["service-templates"])


async def _load(db: AsyncSession, code: str) -> tuple[ServiceTemplate, ServiceTemplateVersion]:
    service_code = mp.resolve_category(code)
    tpl = await db.scalar(select(ServiceTemplate).where(ServiceTemplate.service_code == service_code))
    if not tpl or tpl.archived_at is not None or not tpl.current_version_id:
        raise HTTPException(status_code=404, detail="This service isn't available.")
    ver = await db.get(ServiceTemplateVersion, tpl.current_version_id)
    if not ver:
        raise HTTPException(status_code=404, detail="This service isn't available.")
    return tpl, ver


def _public_schema(schema: dict) -> dict:
    """Everything a form needs to render. (No price rules: customers get a quote from the backend.)"""
    return {k: v for k, v in schema.items() if k in {
        "schema_version", "selectors", "fields", "legacy_extras", "uploaded_file_fields",
        "quantity_from", "fixed_service_type", "legacy_key_aliases",
    }}


# NOTE: declared before "/{code}" so "admin/parity" is not read as a service code.
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
    return [
        {"service_code": t.service_code, "title": t.title, "description": t.description,
         "kind": t.kind, "is_enabled": t.is_enabled}
        for t in tpls
    ]


@router.get("/{code}")
async def get_template(code: str, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    tpl, ver = await _load(db, code)
    return {
        "service_code": tpl.service_code, "title": tpl.title, "description": tpl.description,
        "kind": tpl.kind, "is_enabled": tpl.is_enabled,
        "version_id": str(ver.id), "version": ver.version,
        "schema": _public_schema(ver.schema),
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
