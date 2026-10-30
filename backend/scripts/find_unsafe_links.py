"""List stored file links that the new validation would refuse (e.g. javascript: links planted before the fix).

    python -m scripts.find_unsafe_links            # report only
    python -m scripts.find_unsafe_links --clear    # blank the unsafe links (the rest of the record is kept)
"""
import asyncio
import json
import sys

from fastapi import HTTPException
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.utils.upload_guard import validate_file_url


def _bad(v) -> bool:
    try:
        validate_file_url(v, max_data_bytes=64 * 1024 * 1024)
        return False
    except HTTPException:
        return True


async def main(clear: bool) -> None:
    async with AsyncSessionLocal() as db:
        found = 0
        for rid, files, result in (await db.execute(text("SELECT id, uploaded_files, worker_result_file_url FROM manual_service_requests"))).all():
            files = files or []
            bad_files = [f for f in files if _bad(f)]
            bad_result = bool(result) and _bad(result)
            if bad_files or bad_result:
                found += 1
                print(f"manual_service_requests {rid}: {len(bad_files)} bad file link(s){', bad result link' if bad_result else ''}")
                if clear:
                    await db.execute(text("UPDATE manual_service_requests SET uploaded_files = CAST(:f AS jsonb), worker_result_file_url = :r WHERE id = :i"),
                                     {"f": json.dumps([f for f in files if not _bad(f)]), "r": None if bad_result else result, "i": str(rid)})
        for mid, url in (await db.execute(text("SELECT id, attachment_url FROM dispute_messages WHERE attachment_url IS NOT NULL"))).all():
            if _bad(url):
                found += 1
                print(f"dispute_messages {mid}: bad attachment link")
                if clear:
                    await db.execute(text("UPDATE dispute_messages SET attachment_url = NULL WHERE id = :i"), {"i": str(mid)})
        if clear:
            await db.commit()
        print(f"{found} record(s) with unsafe links." + ("  Cleared." if clear else "  (report only; add --clear to blank them)"))


if __name__ == "__main__":
    asyncio.run(main("--clear" in sys.argv))
