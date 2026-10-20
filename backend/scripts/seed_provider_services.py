"""Create the three Techhub-backed services that did not exist yet (NIN Personalization, IPE Clearance,
BVN CRM) and the starting provider settings for all six.

  python -m scripts.seed_provider_services --dry-run     # show what would be created, change nothing
  python -m scripts.seed_provider_services               # create what is missing

Safe to re-run: it never overwrites an existing template or settings row, so director edits stay.
New services are created SWITCHED OFF with a placeholder price: a director sets the real price in the
Service Builder, checks the form, and switches them on. Techhub sending also starts switched off."""
import asyncio
import json
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.identity_service import IdentityService, IdentityServiceCategory
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.models.user import User, UserRole
from app.provider import defaults
from app.provider.models import ProviderServiceConfig
from app.provider import rules as R
from app.services import service_template_engine as eng
from app.services.settings_service import get_config_value, invalidate_config_cache, set_config_value

LIVE_KEY = "service_templates_live"


async def main(dry: bool) -> int:
    problems = 0
    for code, s in defaults.NEW_SERVICES.items():
        errs = eng.validate_schema(s["schema"])
        rules = [{"when": {}, "price_kobo": s["price_kobo"], "per": "flat"}]
        rerrs, _ = eng.validate_price_rules(rules, s["schema"])
        for e in errs + rerrs:
            print(f"  ERROR {code}: {e}")
            problems += 1
    for code, cfg in defaults.DEFAULT_CONFIGS.items():
        errs = R.validate_config_patch({"endpoint": cfg["endpoint"], "field_map": cfg.get("field_map", {}),
                                        "file_params": cfg.get("file_params", {})})
        for e in errs:
            print(f"  ERROR {code}: {e}")
            problems += 1
    if problems:
        print("Stopping: nothing was written.")
        return 1

    async with AsyncSessionLocal() as db:
        director = (await db.scalars(select(User).where(User.role == UserRole.DIRECTOR).limit(1))).first()
        if director is None:
            print("No director account found; cannot record who created these. Stopping.")
            return 1
        have_t = set((await db.scalars(select(ServiceTemplate.service_code))).all())
        have_ids = set((await db.scalars(select(IdentityService.code))).all())
        have_c = set((await db.scalars(select(ProviderServiceConfig.service_code))).all())
        live = set(json.loads(await get_config_value(db, LIVE_KEY) or "[]"))
        for code, s in defaults.NEW_SERVICES.items():
            if code in have_t:
                print(f"  skip    template {code} (exists, untouched)")
                continue
            print(f"  {'would create' if dry else 'create '} template {code} (switched off, placeholder price)")
            if dry:
                continue
            tpl = ServiceTemplate(service_code=code, kind="manual", title=s["title"], description=s["description"],
                                  is_enabled=False, updated_by=director.id)
            db.add(tpl)
            await db.flush()
            ver = ServiceTemplateVersion(template_id=tpl.id, version=1, schema=s["schema"],
                                         price_rules=[{"when": {}, "price_kobo": s["price_kobo"], "per": "flat"}],
                                         note="Created for Techhub-backed processing", created_by=director.id)
            db.add(ver)
            await db.flush()
            tpl.current_version_id = ver.id
            if code not in have_ids:
                db.add(IdentityService(category=IdentityServiceCategory(s["category"]), code=code, name=s["title"],
                                       description=s["description"], provider="manual", price_kobo=s["price_kobo"],
                                       is_active=False, required_fields=[], updated_by=director.id))
            live.add(code)
        for code, cfg in defaults.DEFAULT_CONFIGS.items():
            if code in have_c:
                print(f"  skip    settings {code} (exists, untouched)")
                continue
            print(f"  {'would create' if dry else 'create '} settings {code} (sending off, refund ON, alert 5 days)")
            if dry:
                continue
            db.add(ProviderServiceConfig(service_code=code, enabled=False, endpoint=cfg["endpoint"],
                                         field_map=cfg.get("field_map", {}), value_maps=cfg.get("value_maps", {}),
                                         static_params=cfg.get("static_params", {}), file_params=cfg.get("file_params", {}),
                                         applies_when=cfg.get("applies_when", {}), status_param=cfg.get("status_param", "ticket_id"),
                                         refund_on_failure=True, alert_after_days=5, poll_minutes=30, updated_by=director.id))
        if dry:
            print("Dry run: nothing was written.")
        else:
            await set_config_value(db, key=LIVE_KEY, value=json.dumps(sorted(live)), updated_by=director.id)
            await db.commit()
            invalidate_config_cache(LIVE_KEY)
            print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--dry-run" in sys.argv)))
