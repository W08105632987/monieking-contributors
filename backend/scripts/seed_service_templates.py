"""
Seed the ten live manual services as starting templates (Phase 2).

  python -m scripts.seed_service_templates --dry-run     # show what would be created, change nothing
  python -m scripts.seed_service_templates               # create missing templates

Rules this script follows (so it can never hurt a live service):
  * Prices are read from the LIVE saved table (system_config 'manual_services_pricing'),
    merged over the built-in defaults exactly like the charge does. Not the code defaults.
  * It NEVER overwrites a template that already exists (director edits are safe). Re-running is a no-op.
  * Before writing anything it checks every seeded template against the existing charge
    function for every option; on any mismatch it stops and writes nothing.
  * Nothing reads these tables until Phase 3, so seeding changes nothing for customers.
"""
import asyncio
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.identity_service import IdentityService
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.models.settings import SystemConfig
from app.services import manual_pricing as mp
from app.services import service_template_engine as eng
from app.services.service_template_parity import parity_report
from app.services.service_template_seeds import build_seed_templates, initial_enabled


async def main(dry_run: bool) -> int:
    async with AsyncSessionLocal() as db:
        cfg = await db.get(SystemConfig, "manual_services_pricing")
        price_map = mp.merge_price_map(cfg.value if cfg else None)
        print(f"Live saved price table: {'found' if cfg else 'NOT found (using built-in defaults)'}")

        rows = (await db.execute(select(IdentityService.code, IdentityService.is_active))).all()
        active_by_code = {code: bool(active) for code, active in rows}

        seeds = build_seed_templates(price_map)

        # 1. every template must be valid and must charge exactly like today's charge function
        problems = 0
        for s in seeds:
            errs = eng.validate_schema(s.schema)
            rerrs, warns = eng.validate_price_rules(s.price_rules, s.schema)
            for e in errs + rerrs:
                print(f"  ERROR   {s.service_code}: {e}")
                problems += 1
            for w in warns:
                print(f"  WARNING {s.service_code}: {w}")
        report = parity_report({s.service_code: (s.schema, s.price_rules) for s in seeds}, price_map)
        print(f"Price parity: {report['checked']} option combinations checked, {len(report['mismatches'])} mismatches")
        for m in report["mismatches"][:20]:
            print("  MISMATCH", m)
        if problems or report["mismatches"]:
            print("Stopping: nothing was written.")
            return 1

        # 2. create only what is missing
        existing = set((await db.scalars(select(ServiceTemplate.service_code))).all())
        created = 0
        for s in seeds:
            if s.service_code in existing:
                print(f"  skip    {s.service_code} (already exists, left untouched)")
                continue
            enabled = initial_enabled(s, active_by_code)
            print(f"  {'would create' if dry_run else 'create '} {s.service_code}  enabled={enabled}  "
                  f"{len(s.schema['fields'])} fields, {len(s.price_rules)} price rules")
            if dry_run:
                continue
            tpl = ServiceTemplate(service_code=s.service_code, kind="manual", title=s.title,
                                  description=s.description, is_enabled=enabled)
            db.add(tpl)
            await db.flush()
            ver = ServiceTemplateVersion(template_id=tpl.id, version=1, schema=s.schema,
                                         price_rules=s.price_rules,
                                         note="Initial version seeded from the live saved prices")
            db.add(ver)
            await db.flush()
            tpl.current_version_id = ver.id
            created += 1
        if dry_run:
            print("Dry run: nothing was written.")
        else:
            await db.commit()
            print(f"Done. Created {created} template(s).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--dry-run" in sys.argv)))
