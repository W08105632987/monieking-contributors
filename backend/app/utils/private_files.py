"""Private storage for ID documents and service files (finding D-03).   OFF by default: PRIVATE_DOCUMENTS=true

THE PROBLEM
-----------
Uploaded ID documents (NIN slips, BVN letters, CAC certificates, affidavits, photos) were saved in the PUBLIC `avatars`
bucket. Anyone who ever sees or guesses a file link can open the document, with no login, forever.

THE FIX
-------
With PRIVATE_DOCUMENTS=true new uploads go to a PRIVATE bucket called `documents`. The database stores a plain reference
(https://<project>.supabase.co/storage/v1/object/documents/<name>) which opens nothing by itself. Whenever the API sends a
request or job to an authorised person (the owner, the assigned worker, a director) the reference is swapped for a
short-lived signed link (valid 1 hour). A copied link stops working after that.
Old files stay where they are until you run `python -m scripts.move_documents_private`.
"""
import asyncio
import logging
import time
from urllib.parse import urlparse

from app.core.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

PRIVATE_BUCKET = "documents"
SIGNED_LINK_SECONDS = 3600
_PREFIX = "/storage/v1/object/documents/"
_cache: dict[str, tuple[float, str]] = {}      # reference -> (signed-until, signed link). Bounded below.
_bucket_ready = False


def _base() -> str:
    return (settings.SUPABASE_URL or "").strip().strip('"').strip("'").rstrip("/")


def private_enabled() -> bool:
    return bool(getattr(settings, "PRIVATE_DOCUMENTS", False))


def reference_for(object_name: str) -> str:
    return f"{_base()}{_PREFIX}{object_name}"


def is_private_ref(url) -> bool:
    if not isinstance(url, str):
        return False
    u = urlparse(url)
    return u.path.startswith(_PREFIX) and (u.hostname or "").lower() == (urlparse(_base()).hostname or "").lower()


async def ensure_bucket() -> None:
    """Create the private bucket once (a 'already exists' answer is fine)."""
    global _bucket_ready
    if _bucket_ready:
        return
    from app.utils.supabase_admin_client import supabase_admin_request
    await supabase_admin_request(
        "POST", "/storage/v1/bucket", json={"id": PRIVATE_BUCKET, "name": PRIVATE_BUCKET, "public": False},
        ok_statuses=(200, 201, 400, 409), failure_detail="Could not prepare document storage",
    )
    _bucket_ready = True


async def sign(ref: str) -> str | None:
    """Short-lived link for one private file; None if it cannot be signed (never leaks the bare reference)."""
    now = time.time()
    hit = _cache.get(ref)
    if hit and hit[0] > now + 300:
        return hit[1]
    from app.utils.supabase_admin_client import supabase_admin_request
    path = urlparse(ref).path[len(_PREFIX):]
    try:
        resp = await supabase_admin_request(
            "POST", f"/storage/v1/object/sign/{PRIVATE_BUCKET}/{path}", json={"expiresIn": SIGNED_LINK_SECONDS},
            failure_detail="Could not open the document",
        )
        rel = (resp.json() or {}).get("signedURL") or (resp.json() or {}).get("signedUrl")
    except Exception:  # noqa: BLE001
        log.warning("could not sign private file", exc_info=True)
        return None
    if not rel:
        return None
    link = rel if rel.startswith("http") else f"{_base()}/storage/v1{rel if rel.startswith('/') else '/' + rel}"
    if len(_cache) > 2000:
        _cache.clear()
    _cache[ref] = (now + SIGNED_LINK_SECONDS, link)
    return link


async def presign(payload):
    """Swap private references for signed links inside a job/request dict, or a list of them. Legacy public links and
    data links are left exactly as they are. Safe to call when the feature is off (it only touches private refs)."""
    items = payload if isinstance(payload, list) else [payload]
    wanted: dict[str, str | None] = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        for u in (it.get("uploaded_files") or []):
            if is_private_ref(u):
                wanted[u] = None
        if is_private_ref(it.get("worker_result_file_url")):
            wanted[it["worker_result_file_url"]] = None
    if not wanted:
        return payload
    sem = asyncio.Semaphore(8)

    async def one(ref):
        async with sem:
            wanted[ref] = await sign(ref)
    await asyncio.gather(*(one(r) for r in wanted))
    for it in items:
        if not isinstance(it, dict):
            continue
        if it.get("uploaded_files"):
            it["uploaded_files"] = [(wanted.get(u) or "") if is_private_ref(u) else u for u in it["uploaded_files"]]
        if is_private_ref(it.get("worker_result_file_url")):
            it["worker_result_file_url"] = wanted.get(it["worker_result_file_url"]) or None
    return payload
