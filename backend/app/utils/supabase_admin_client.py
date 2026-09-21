"""
Shared client for calling the Supabase Admin API (auth/v1/admin/*,
auth/v1/token, storage/v1/object/*).

Why this exists: every call site that used a bare `httpx.AsyncClient()`
had two problems —

1. No explicit timeout, so it fell back to httpx's default (5s connect /
   5s read / 5s write / 5s pool). Any real-world latency spike on
   Supabase's side — a slow cold start, a brief network blip — would
   raise httpx.TimeoutException.
2. Nothing ever caught that exception (or httpx.ConnectError, or a
   malformed/non-JSON error body). It fell through to the global
   exception handler in main.py, which is correct for truly unexpected
   bugs, but for "the auth provider was slow/unreachable" it just
   produces a bare "Internal server error" with no useful signal to the
   user or in the logs — which is exactly what presented as the app
   "randomly breaking".

This wraps every Supabase Admin call in one place: a deliberate timeout
budget, and translation of network-level failures into clean,
predictable HTTPExceptions the frontend can actually show to a user.
"""
import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings

settings = get_settings()

# Connect fast-fails at 5s (if Supabase is unreachable, no point waiting
# longer), but reads get more room — 12s — since admin user-creation /
# password-update endpoints can occasionally be slower than a simple
# GET, and failing a real login attempt at exactly httpx's 5s default
# was a big part of the "times out unnecessarily" symptom.
SUPABASE_TIMEOUT = httpx.Timeout(connect=5.0, read=12.0, write=12.0, pool=5.0)


def _admin_headers(extra: dict | None = None) -> dict:
    key = settings.SUPABASE_SERVICE_ROLE_KEY.strip().strip('"').strip("'")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    if extra:
        headers.update(extra)
    return headers


async def supabase_admin_request(
    method: str,
    path: str,
    *,
    json: dict | None = None,
    content: bytes | None = None,
    extra_headers: dict | None = None,
    ok_statuses: tuple[int, ...] = (200, 201),
    not_found_ok: bool = False,
    failure_detail: str = "Our authentication service is taking too long to respond. Please try again.",
) -> httpx.Response:
    """
    Makes one call to the Supabase Admin/Storage API and turns network-
    level failures into a clean HTTPException instead of an opaque 500.

    `path` is relative to SUPABASE_URL, e.g. "/auth/v1/admin/users".
    `not_found_ok` treats a 404 as success (useful for idempotent
    deletes) without the caller having to special-case it.
    """
    headers = _admin_headers(extra_headers)
    if json is not None:
        headers.setdefault("Content-Type", "application/json")

    base_url = settings.SUPABASE_URL.strip().strip('"').strip("'").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
            resp = await client.request(
                method,
                f"{base_url}{path}",
                headers=headers,
                json=json,
                content=content,
            )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=failure_detail,
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the authentication service. Check your connection and try again.",
        )
    except httpx.HTTPError:
        # Anything else from httpx (protocol errors, etc.) — still not
        # something the caller can act on, so fail the same clean way.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=failure_detail,
        )

    ok = resp.status_code in ok_statuses or (not_found_ok and resp.status_code == 404)
    if not ok:
        print(f"[SUPABASE_ERROR] {method} {base_url}{path} returned {resp.status_code}: {resp.text[:300]}", flush=True)
        try:
            body = resp.json()
            message = body.get("msg") or body.get("message") or body.get("error_description")
        except Exception:
            message = None
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST if resp.status_code < 500 else status.HTTP_502_BAD_GATEWAY,
            detail=message or failure_detail,
        )

    return resp
