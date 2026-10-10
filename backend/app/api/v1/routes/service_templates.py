"""
Service Templates (Phase 2): READ-ONLY.
=======================================
Nothing in the customer app uses these yet; Phase 3 switches services over one
at a time. Publishing/editing endpoints arrive with the director builder (Phase 4).
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly, DirectorOrAdmin
from app.models.identity_service import IdentityService, IdentityServiceCategory
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.services import manual_pricing as mp
from app.services import service_template_create as create
from app.services import service_template_engine as eng
from app.services import service_template_publish as pub
from app.services import service_template_store as store
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


class PublishBody(BaseModel):
    form_schema: dict                        # the whole form (selectors + fields). Not named "schema": pydantic reserves that.
    price_rules: list[dict]
    note: str | None = None
    base_version: int | None = None          # the version the director started from (stale-edit guard)
    acknowledge_warnings: bool = False
    confirm_price_change: bool = False


class RevertBody(BaseModel):
    version: int
    note: str | None = None
    base_version: int | None = None
    acknowledge_warnings: bool = False
    confirm_price_change: bool = False


def _has_original_form(code: str) -> bool:
    """Built-in services still have their original hardcoded form to go back to; builder-made ones never do."""
    return code in mp.PRICE_MAP


async def _version_of(db: AsyncSession, tpl: ServiceTemplate) -> ServiceTemplateVersion | None:
    return await db.get(ServiceTemplateVersion, tpl.current_version_id) if tpl.current_version_id else None


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


@router.get("/admin/all")
async def list_all_templates(current_user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Director list for the builder: every service including archived ones."""
    tpls = (await db.scalars(select(ServiceTemplate).order_by(ServiceTemplate.title))).all()
    live = set(await _live_codes(db))
    out = []
    for t in tpls:
        ver = await db.get(ServiceTemplateVersion, t.current_version_id) if t.current_version_id else None
        out.append({
            "service_code": t.service_code, "title": t.title, "kind": t.kind, "is_enabled": t.is_enabled,
            "live": t.service_code in live, "archived": t.archived_at is not None,
            "version": ver.version if ver else None,
            "has_original_form": _has_original_form(t.service_code),
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        })
    return out


class CreateBody(BaseModel):
    title: str
    description: str | None = None
    category: str                      # which section of the customer app: nimc | bvn | tin | attestation | cac
    price_kobo: int
    code: str | None = None            # optional; otherwise made from the title


@router.post("/admin/create")
async def create_service(body: CreateBody, current_user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """
    Create a brand-new manual service from the builder. It is created SWITCHED OFF and hidden from customers;
    the director edits the form, previews it, then switches it on. Nothing existing is touched.
    """
    taken = set((await db.scalars(select(ServiceTemplate.service_code))).all())
    taken |= set((await db.scalars(select(IdentityService.code))).all())
    taken |= set(mp.PRICE_MAP) | set(mp.CATEGORY_ALIASES)
    built = create.build_new_service(body.title, body.description, body.category, body.price_kobo, taken, body.code)
    if built["errors"]:
        raise HTTPException(status_code=422, detail={"message": built["errors"][0], "errors": built["errors"]})
    code = built["code"]
    title = body.title.strip()
    try:
        tpl = ServiceTemplate(service_code=code, kind="manual", title=title, description=(body.description or None),
                              is_enabled=False, updated_by=current_user.id)
        db.add(tpl)
        await db.flush()
        ver = ServiceTemplateVersion(template_id=tpl.id, version=1, schema=built["schema"], price_rules=built["rules"],
                                     note="Created in the Service Builder", created_by=current_user.id)
        db.add(ver)
        await db.flush()
        tpl.current_version_id = ver.id
        # the catalog card (inactive on purpose: the template's on/off switch is what customers see)
        db.add(IdentityService(
            category=IdentityServiceCategory(body.category), code=code, name=title, description=(body.description or None),
            provider="manual", price_kobo=body.price_kobo, is_active=False, required_fields=[], updated_by=current_user.id,
        ))
        # no original form exists, so it always runs on the template flow
        live = set(await _live_codes(db)) | {code}
        await set_config_value(db, key=LIVE_KEY, value=json.dumps(sorted(live)), updated_by=current_user.id)
        await log_action(
            db, actor_id=current_user.id, action="service_template.created", entity_type="service_template",
            entity_id=str(tpl.id), old_value=None,
            new_value={"service_code": code, "title": title, "category": body.category, "price_kobo": body.price_kobo},
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A service with that id was just created. Please try again.")
    invalidate_config_cache(LIVE_KEY)
    return {"service_code": code, "version": 1, "is_enabled": False}


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
    stranded = [c for c in before if c not in wanted and not _has_original_form(c)]
    if stranded:
        raise HTTPException(
            status_code=422,
            detail=f"{', '.join(stranded)} was built in the Service Builder and has no original form to go back to. Switch it off instead.",
        )
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
    out = []
    for t in tpls:
        ver = await _version_of(db, t)
        out.append({
            "service_code": t.service_code, "title": t.title, "description": t.description,
            "kind": t.kind, "is_enabled": t.is_enabled, "live": t.service_code in live,
            "has_original_form": _has_original_form(t.service_code),
            # "From ₦X" for the service card: only for services running on the template, so it is the real charge
            "from_price_kobo": create.from_price_kobo(ver.schema, ver.price_rules) if ver and t.service_code in live else None,
        })
    return out


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
        "service_code": tpl.service_code, "title": tpl.title, "kind": tpl.kind, "is_enabled": tpl.is_enabled,
        "version_id": str(ver.id), "version": ver.version,
        "schema": ver.schema, "price_rules": ver.price_rules,
        "schema_errors": eng.validate_schema(ver.schema),
        "price_errors": errors, "price_warnings": warnings,
        "versions": [{"id": str(v.id), "version": v.version, "note": v.note,
                      "created_at": v.created_at.isoformat() if v.created_at else None} for v in versions],
    }


def _analysis_payload(a: dict) -> dict:
    return {k: a.get(k) for k in (
        "errors", "warnings", "price_changes", "price_changes_total",
        "added_fields", "removed_fields", "needs_price_confirmation",
    )}


async def _tpl_for_edit(db: AsyncSession, code: str) -> ServiceTemplate:
    tpl = await db.scalar(select(ServiceTemplate).where(ServiceTemplate.service_code == mp.resolve_category(code)))
    if not tpl or tpl.archived_at is not None or not tpl.current_version_id:
        raise HTTPException(status_code=404, detail="This service isn't available.")
    return tpl


async def _run_publish(db: AsyncSession, tpl: ServiceTemplate, user_id, **kw) -> dict:
    """Map the store's outcomes to clear HTTP answers. Nothing is saved unless this returns normally."""
    try:
        ver = await store.publish_version(db, tpl, user_id=user_id, **kw)
    except store.PublishRejected as e:
        await db.rollback()
        raise HTTPException(status_code=422, detail={
            "code": "invalid", "message": e.errors[0] if e.errors else "Invalid.", **_analysis_payload({"errors": e.errors, **{k: v for k, v in e.analysis.items() if k != "errors"}}),
        })
    except store.PublishNeedsConfirmation as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "confirm_required",
            "message": "Please review and confirm the price changes / warnings before publishing.",
            **_analysis_payload(e.analysis),
        })
    except store.PublishConflict as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "stale_version", "current_version": e.current_version,
            "message": "Someone else published a newer version. Reload the builder and redo your change.",
        })
    await db.commit()
    return {"service_code": tpl.service_code, "version": ver.version, "version_id": str(ver.id)}


@router.post("/{code}/admin/preview")
async def preview_change(code: str, body: PublishBody, current_user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Dry run: what would publishing this do? Saves nothing."""
    tpl = await _tpl_for_edit(db, code)
    cur = await db.get(ServiceTemplateVersion, tpl.current_version_id)
    a = pub.analyse_change(cur.schema, cur.price_rules, body.form_schema, body.price_rules, kind=tpl.kind)
    matrix = []
    if not a["errors"]:                       # same engine that charges; only meaningful for a valid draft
        matrix = eng.price_matrix(a["normalized_schema"], body.price_rules)
    return {"current_version": cur.version, "draft_price_matrix": matrix, **_analysis_payload(a)}


@router.post("/{code}/admin/publish")
async def publish_template(code: str, body: PublishBody, current_user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Publish a new version. Live for new orders immediately; existing orders keep the version they were placed on."""
    tpl = await _tpl_for_edit(db, code)
    return await _run_publish(
        db, tpl, current_user.id, schema=body.form_schema, price_rules=body.price_rules, note=body.note,
        base_version=body.base_version, acknowledge_warnings=body.acknowledge_warnings,
        confirm_price_change=body.confirm_price_change,
    )


@router.post("/{code}/admin/revert")
async def revert_template(code: str, body: RevertBody, current_user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Go back to an earlier version by publishing its content as a NEW version (history is never rewritten)."""
    tpl = await _tpl_for_edit(db, code)
    old = await db.scalar(select(ServiceTemplateVersion).where(
        ServiceTemplateVersion.template_id == tpl.id, ServiceTemplateVersion.version == body.version))
    if not old:
        raise HTTPException(status_code=404, detail="That version doesn't exist.")
    return await _run_publish(
        db, tpl, current_user.id, schema=old.schema, price_rules=old.price_rules,
        note=(body.note or f"Reverted to version {old.version}"), base_version=body.base_version,
        acknowledge_warnings=body.acknowledge_warnings, confirm_price_change=body.confirm_price_change,
        audit_action="service_template.reverted",
    )


class ArchiveBody(BaseModel):
    archived: bool


@router.post("/{code}/admin/archive")
async def archive_template(code: str, body: ArchiveBody, current_user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Archive (hide) or restore a service. Services are never deleted; orders and history stay."""
    service_code = mp.resolve_category(code)
    tpl = await db.scalar(select(ServiceTemplate).where(ServiceTemplate.service_code == service_code))
    if not tpl:
        raise HTTPException(status_code=404, detail="This service doesn't exist.")
    if body.archived:
        if tpl.is_enabled:
            raise HTTPException(status_code=409, detail="Switch the service off first, then archive it.")
        # built-in services must go back to their original form first; builder-made ones have none (always on the template flow)
        if _has_original_form(service_code) and service_code in set(await _live_codes(db)):
            raise HTTPException(status_code=409, detail="Switch this service back to its original form first, then archive it.")
        if tpl.archived_at is not None:
            return {"service_code": service_code, "archived": True}
        tpl.archived_at = datetime.now(timezone.utc)
    else:
        if tpl.archived_at is None:
            return {"service_code": service_code, "archived": False}
        tpl.archived_at = None
    tpl.updated_by = current_user.id
    await log_action(
        db, actor_id=current_user.id, action="service_template.archived" if body.archived else "service_template.restored",
        entity_type="service_template", entity_id=str(tpl.id),
        old_value={"service_code": service_code, "archived": not body.archived},
        new_value={"service_code": service_code, "archived": body.archived},
    )
    await db.commit()
    return {"service_code": service_code, "archived": body.archived}
