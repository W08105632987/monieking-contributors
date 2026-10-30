"""One-off clean-up of customers that were deleted BEFORE the complete-erasure fix.

Old deletes only blanked a few columns, so the person's phone number, name, bank details and more are still sitting in
other tables. This finds every previously deleted/archived person (the audit log remembers who they were), then runs the
same complete erasure used by the Delete button and re-checks the whole database.

    python -m scripts.erase_leftovers            # DRY RUN: only reports what is still left (changes nothing)
    python -m scripts.erase_leftovers --apply    # erase it, verify, and save

Safe to run more than once.
"""
import asyncio
import re
import sys
import uuid

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.services import erasure_service as es


async def _identities(db):
    rows = (await db.execute(text(
        "SELECT entity_id, old_value FROM audit_logs "
        "WHERE action IN ('customer.archived', 'customer.deleted', 'user.deleted') AND old_value IS NOT NULL"))).all()
    out = []
    for entity_id, old in rows:
        try:
            uid = uuid.UUID(str(entity_id))
        except ValueError:
            continue
        phone = (old or {}).get("phone_number")
        name = (old or {}).get("full_name")
        if not phone and not name:
            continue   # already scrubbed
        compact = re.sub(r"\s", "", str(phone)) if phone else ""
        emails = [compact + "@monieking.app"] if phone else []
        out.append(es.Identity(uid, es.phone_variants(phone), emails, name, []))
    return out


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        people = await _identities(db)
        print(f"{len(people)} previously deleted people found in the audit log.")
        dirty = 0
        for ident in people:
            rep = es.Report()
            if apply:
                try:
                    rep, _ = await es.erase_personal_data(db, ident.user_id, identity=ident, tombstone_user=False)
                except es.ErasureError as e:
                    await db.rollback()
                    print(f"  {ident.user_id}: FAILED, left untouched ({e})")
                    continue
            await es.verify_clean(db, ident, rep)
            state = "clean" if rep.verified_clean else f"STILL MENTIONED IN: {rep.leftovers}"
            if not rep.verified_clean:
                dirty += 1
            print(f"  {ident.user_id}: {state}")
            if apply:
                await db.commit()
        print(f"Done. {len(people) - dirty} clean, {dirty} need attention." + ("" if apply else "  (dry run - nothing was changed)"))


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
