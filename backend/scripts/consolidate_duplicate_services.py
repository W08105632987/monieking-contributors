"""Find services listed twice (same name, different code or spelling) and tidy them up.

    python -m scripts.consolidate_duplicate_services            # report only, changes nothing
    python -m scripts.consolidate_duplicate_services --apply    # tidy up

For every group of duplicates one row is kept: the one that has a template, a Techhub setting, requests, is switched on,
or was created first. The others are removed from the catalog if nobody ever used them; if they have requests they are
kept (history must never be lost) but switched off. Duplicate templates are switched off and archived.
Prints counts and codes only (no customer data)."""
import asyncio
import json
import sys
from datetime import datetime, timezone

from sqlalchemy import delete, func, select

from app.core.database import AsyncSessionLocal
from app.models.identity_service import IdentityService, IdentityServiceNotifyRequest, IdentityServiceRequest
from app.models.service_template import ServiceTemplate
from app.provider.models import ProviderServiceConfig
from app.services.manual_pricing import resolve_category
from app.services.service_dedupe import group_duplicates, pick_keeper
from app.services.settings_service import get_config_value, invalidate_config_cache, set_config_value

LIVE_KEY = "service_templates_live"


async def main(apply: bool) -> int:
    async with AsyncSessionLocal() as db:
        tpl_codes = {t.service_code for t in (await db.scalars(select(ServiceTemplate).where(ServiceTemplate.archived_at.is_(None)))).all()}
        prov_codes = set((await db.scalars(select(ProviderServiceConfig.service_code))).all())
        counts = dict((await db.execute(select(IdentityServiceRequest.service_id, func.count()).group_by(IdentityServiceRequest.service_id))).all())
        rows = (await db.scalars(select(IdentityService))).all()
        by_id = {str(r.id): r for r in rows}
        info = [{"id": str(r.id), "code": r.code, "name": r.name, "is_active": r.is_active,
                 "has_template": resolve_category(r.code) in tpl_codes, "has_provider_config": resolve_category(r.code) in prov_codes,
                 "requests": counts.get(r.id, 0), "created_ts": int(r.created_at.timestamp()) if r.created_at else 0} for r in rows]
        groups = group_duplicates(info)
        if not groups:
            print("No duplicate catalog entries found.")
        removed = switched_off = 0
        for g in groups:
            keep = pick_keeper(g)
            print(f"duplicate group: keep {keep['code']!r}; extra: {[r['code'] for r in g if r is not keep]}")
            for r in g:
                if r is keep:
                    continue
                row = by_id[r["id"]]
                if r["requests"] == 0:
                    print(f"  {'remove' if apply else 'would remove'} {r['code']} (never used)")
                    if apply:
                        await db.execute(delete(IdentityServiceNotifyRequest).where(IdentityServiceNotifyRequest.service_id == row.id))
                        await db.delete(row)
                        removed += 1
                else:
                    print(f"  {'switch off' if apply else 'would switch off'} {r['code']} ({r['requests']} past requests are kept)")
                    if apply:
                        row.is_active = False
                        switched_off += 1
                # a duplicate template (if any) is switched off and archived
                dup_tpl = await db.scalar(select(ServiceTemplate).where(ServiceTemplate.service_code == r["code"], ServiceTemplate.archived_at.is_(None)))
                if dup_tpl and resolve_category(r["code"]) != resolve_category(keep["code"]):
                    print(f"  {'archive' if apply else 'would archive'} template {r['code']}")
                    if apply:
                        dup_tpl.is_enabled = False
                        dup_tpl.archived_at = datetime.now(timezone.utc)
                        live = set(json.loads(await get_config_value(db, LIVE_KEY) or "[]"))
                        if r["code"] in live:
                            live.discard(r["code"])
                            await set_config_value(db, key=LIVE_KEY, value=json.dumps(sorted(live)), updated_by=None)
        if apply:
            await db.commit()
            invalidate_config_cache(LIVE_KEY)
            print(f"Done. Removed {removed}, switched off {switched_off}.")
        else:
            print("Dry run: nothing was changed. Run again with --apply to tidy up.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--apply" in sys.argv)))
