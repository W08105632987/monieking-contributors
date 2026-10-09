"""
Give the live templates the placeholder hints the original forms had (Phase 4a).

  python -m scripts.upgrade_template_placeholders --dry-run    # show what would change, write nothing
  python -m scripts.upgrade_template_placeholders              # publish a new version per template that needs it

Safety:
  * Published versions are immutable, so this publishes a NEW version (v2, v3...). History is kept,
    and the director can revert from the builder.
  * Only ADDS a placeholder to a field that has none. Text a director wrote is never touched.
  * Prices are not touched: the price rules are copied as-is, and the publish step refuses (writes
    nothing) if any customer price would differ. Existing orders keep the version they were placed on.
  * Re-running is a no-op once every field has its hint.
  * Nothing here prints connection strings or settings.
"""
import asyncio
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.services import service_template_store as store
from app.services.service_template_placeholders import apply_placeholders

NOTE = "Added the placeholder hints the original form had (e.g. 'e.g. John')"


async def main(dry_run: bool) -> int:
    published = 0
    async with AsyncSessionLocal() as db:
        tpls = (await db.scalars(
            select(ServiceTemplate).where(ServiceTemplate.archived_at.is_(None)).order_by(ServiceTemplate.service_code)
        )).all()
        for tpl in tpls:
            cur = await db.get(ServiceTemplateVersion, tpl.current_version_id) if tpl.current_version_id else None
            if not cur:
                print(f"  skip    {tpl.service_code} (no published version)")
                continue
            new_schema, changed = apply_placeholders(tpl.service_code, cur.schema)
            if not changed:
                print(f"  ok      {tpl.service_code} (already has its hints, nothing to do)")
                continue
            print(f"  {'would publish' if dry_run else 'publish'} {tpl.service_code}: v{cur.version} -> "
                  f"v{cur.version + 1}, adds {len(changed)} placeholder(s)")
            if dry_run:
                continue
            try:
                await store.publish_version(
                    db, tpl, schema=new_schema, price_rules=cur.price_rules, note=NOTE, user_id=None,
                    base_version=cur.version,
                    acknowledge_warnings=True,      # warnings already existed; this script doesn't change prices
                    confirm_price_change=False,     # ...and it refuses if any price would change
                )
                await db.commit()
                published += 1
            except Exception as e:                  # one service failing must not block the rest
                await db.rollback()
                print(f"  FAILED  {tpl.service_code}: {e}")
                return 1
    print("Dry run: nothing was written." if dry_run else f"Done. Published {published} new version(s).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--dry-run" in sys.argv)))
