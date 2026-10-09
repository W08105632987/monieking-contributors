"""
Database side of publishing a template version (Phase 4a).
Used by the director endpoints and by scripts/upgrade_template_placeholders.py, so there is
exactly one way a new version gets written.

Never edits a published version (a database trigger forbids it). Every publish makes a NEW version,
so "revert" is just publishing an old version's content again: history is never lost.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.services import service_template_publish as pub
from app.utils.audit import log_action


class PublishRejected(Exception):
    """The new version is invalid (or unchanged). `errors` is a list of readable messages."""
    def __init__(self, errors: list[str], analysis: dict | None = None):
        super().__init__("; ".join(errors))
        self.errors = errors
        self.analysis = analysis or {}


class PublishNeedsConfirmation(Exception):
    """Valid, but the director must first confirm price changes and/or acknowledge warnings."""
    def __init__(self, analysis: dict):
        super().__init__("confirmation required")
        self.analysis = analysis


class PublishConflict(Exception):
    """Someone published a newer version since the director opened the builder."""
    def __init__(self, current_version: int):
        super().__init__("stale")
        self.current_version = current_version


async def publish_version(
    db: AsyncSession, tpl: ServiceTemplate, *, schema: dict, price_rules: list, note: str | None,
    user_id: uuid.UUID | None, base_version: int | None = None,
    acknowledge_warnings: bool = False, confirm_price_change: bool = False,
    audit_action: str = "service_template.published",
) -> ServiceTemplateVersion:
    # Lock the template row so two directors publishing at once can't both become "version N+1".
    locked = await db.scalar(select(ServiceTemplate).where(ServiceTemplate.id == tpl.id).with_for_update())
    tpl = locked or tpl
    current = await db.get(ServiceTemplateVersion, tpl.current_version_id) if tpl.current_version_id else None
    if current is None:
        raise PublishRejected(["This service has no published version to build on."])
    if base_version is not None and base_version != current.version:
        raise PublishConflict(current.version)

    analysis = pub.analyse_change(current.schema, current.price_rules, schema, price_rules, kind=tpl.kind)
    if analysis["errors"]:
        raise PublishRejected(analysis["errors"], analysis)
    new_schema = analysis["normalized_schema"]
    if new_schema == current.schema and price_rules == current.price_rules:
        raise PublishRejected(["Nothing has changed since the live version."], analysis)
    if (analysis["warnings"] and not acknowledge_warnings) or (analysis["needs_price_confirmation"] and not confirm_price_change):
        raise PublishNeedsConfirmation(analysis)

    numbers = (await db.scalars(
        select(ServiceTemplateVersion.version).where(ServiceTemplateVersion.template_id == tpl.id)
    )).all()
    ver = ServiceTemplateVersion(
        template_id=tpl.id, version=pub.next_version_number(list(numbers)),
        schema=new_schema, price_rules=price_rules, note=(note or "").strip() or None, created_by=user_id,
    )
    db.add(ver)
    await db.flush()
    previous_id = tpl.current_version_id
    tpl.current_version_id = ver.id
    tpl.updated_by = user_id
    if user_id is not None:
        await log_action(
            db, actor_id=user_id, action=audit_action, entity_type="service_template", entity_id=str(tpl.id),
            old_value={"service_code": tpl.service_code, "version": current.version, "version_id": str(previous_id)},
            new_value={"service_code": tpl.service_code, "version": ver.version, "version_id": str(ver.id),
                       "price_changes": analysis["price_changes_total"], "note": ver.note},
        )
    return ver
