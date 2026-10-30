"""Move OLD uploaded documents from the public bucket to the private one.   (finding D-03)

Run AFTER you have deployed the patch, set PRIVATE_DOCUMENTS=true and confirmed new uploads + viewing work.

    python -m scripts.move_documents_private            # DRY RUN: lists what would move
    python -m scripts.move_documents_private --apply    # copy to private, repoint the records, delete the public copy

Only files named manual_* (customer service documents) are moved. Profile pictures stay public on purpose.
Safe to run again: files already moved are skipped.
"""
import asyncio
import json
import re
import sys

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.utils import private_files as pf
from app.utils.supabase_admin_client import supabase_admin_request

_PUBLIC = re.compile(r"https://[^\s\"']+/storage/v1/object/public/avatars/(manual_[^\s\"'?]+)")


async def _move(name: str) -> bool:
    await supabase_admin_request(
        "POST", "/storage/v1/object/copy",
        json={"bucketId": "avatars", "sourceKey": name, "destinationBucket": pf.PRIVATE_BUCKET, "destinationKey": name},
        ok_statuses=(200, 201), failure_detail="copy failed",
    )
    return True


async def main(apply: bool) -> None:
    await pf.ensure_bucket() if apply else None
    moved, failed = 0, 0
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT id, uploaded_files::text, worker_result_file_url FROM manual_service_requests "
            "WHERE uploaded_files::text LIKE '%/object/public/avatars/manual_%' OR worker_result_file_url LIKE '%/object/public/avatars/manual_%'"))).all()
        print(f"{len(rows)} requests have documents in the public bucket.")
        for rid, files_txt, result_url in rows:
            names = set(_PUBLIC.findall(files_txt or "")) | set(_PUBLIC.findall(result_url or ""))
            ok_all = True
            for n in names:
                if not apply:
                    print(f"  would move {n}")
                    continue
                try:
                    await _move(n)
                except Exception as e:  # noqa: BLE001
                    ok_all = False
                    failed += 1
                    print(f"  FAILED {n}: {e}")
            if apply and ok_all and names:
                new_files = _PUBLIC.sub(lambda m: pf.reference_for(m.group(1)), files_txt or "[]")
                new_result = _PUBLIC.sub(lambda m: pf.reference_for(m.group(1)), result_url or "") or None
                await db.execute(text("UPDATE manual_service_requests SET uploaded_files = CAST(:f AS jsonb), worker_result_file_url = :r WHERE id = :i"),
                                 {"f": new_files, "r": new_result, "i": str(rid)})
                await db.commit()
                # only now remove the public copies
                await supabase_admin_request("DELETE", "/storage/v1/object/avatars", json={"prefixes": sorted(names)},
                                             ok_statuses=(200, 204), not_found_ok=True, failure_detail="delete failed")
                moved += len(names)
    print(f"Done. moved={moved} failed={failed}" + ("" if apply else "  (dry run - nothing changed)"))


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
