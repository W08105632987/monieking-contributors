"""Safe handling of base64 file uploads (finding S-09).

The old code decided a file's type from text the CLIENT typed in the data-URL header, never looked at the
actual bytes, decoded the whole thing before checking its size, and - if storage failed - saved the entire
base64 file into the database row instead. This helper:
  * checks the size BEFORE decoding,
  * decodes strictly,
  * works out the real type from the file's own first bytes (JPEG / PNG / WebP / PDF only),
  * returns the type to store - never the one the client claimed.
"""
import base64
import binascii

from fastapi import HTTPException

IMAGE_ONLY = ("jpeg", "png", "webp")
IMAGES_AND_PDF = ("jpeg", "png", "webp", "pdf")

_EXT = {"jpeg": "jpg", "png": "png", "webp": "webp", "pdf": "pdf"}
_MIME = {"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "pdf": "application/pdf"}


def sniff_kind(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:5] == b"%PDF-":
        return "pdf"
    return None


def decode_upload(data_url: str, *, max_bytes: int, allowed: tuple[str, ...] = IMAGE_ONLY) -> tuple[bytes, str, str]:
    """Returns (bytes, content_type, extension) or raises a clear 400."""
    if not isinstance(data_url, str) or "base64," not in data_url:
        raise HTTPException(status_code=400, detail="No file provided")
    encoded = data_url.split("base64,", 1)[1]
    # base64 is ~4/3 the size of the file; reject before spending memory on decoding.
    if len(encoded) > (max_bytes * 4) // 3 + 8:
        raise HTTPException(status_code=400, detail=f"File too large (max {max_bytes // (1024 * 1024)}MB)")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="That file could not be read")
    if not raw or len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File too large (max {max_bytes // (1024 * 1024)}MB)")
    kind = sniff_kind(raw)
    if kind is None or kind not in allowed:
        allowed_txt = ", ".join(a.upper() if a == "pdf" else a.upper() for a in allowed)
        raise HTTPException(status_code=400, detail=f"Unsupported file. Allowed: {allowed_txt}")
    return raw, _MIME[kind], _EXT[kind]


# ───────────────────────── links to stored files (finding S-13) ─────────────────────────
# Customers, workers and dispute messages hand the server a "file link" that staff later click or display. It was
# stored without any check, so a link such as `javascript:...` or a page on an attacker's site could run in a
# director's or worker's logged-in session. Only two kinds of link are legitimate:
#   1. a file in OUR storage  (https://<our-supabase-host>/storage/v1/object/...)
#   2. a small file embedded as a data link of a harmless type (images, PDF, plain documents) - never HTML/SVG/script.
import re as _re
from urllib.parse import urlparse as _urlparse

SAFE_DATA_MIMES = {
    "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv",
    "application/msword", "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
_DATA_RE = _re.compile(r"^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$", _re.IGNORECASE)


def _storage_host() -> str:
    from app.core.config import get_settings
    return (_urlparse((get_settings().SUPABASE_URL or "").strip().strip("\"'")).hostname or "").lower()


def validate_file_url(value, *, allow_data: bool = True, max_data_bytes: int = 8 * 1024 * 1024) -> str:
    """Return the link unchanged if it is safe, otherwise raise a clear 400."""
    if not isinstance(value, str) or not value.strip() or len(value) > 16 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Invalid file link")
    v = value.strip()
    m = _DATA_RE.match(v)
    if m:
        if not allow_data:
            raise HTTPException(status_code=400, detail="Please upload the file instead of embedding it")
        mime = m.group(1).lower()
        if mime not in SAFE_DATA_MIMES:
            raise HTTPException(status_code=400, detail="That file type is not allowed")
        if (len(m.group(2)) * 3) // 4 > max_data_bytes:
            raise HTTPException(status_code=400, detail=f"File too large (max {max_data_bytes // (1024 * 1024)}MB)")
        if mime in ("image/png", "image/jpeg", "image/webp", "application/pdf"):
            try:
                head = base64.b64decode(m.group(2)[:64] + "=" * (-len(m.group(2)[:64]) % 4))
            except (binascii.Error, ValueError):
                raise HTTPException(status_code=400, detail="That file could not be read")
            if sniff_kind(head) is None:
                raise HTTPException(status_code=400, detail="That file does not look like its declared type")
        return v
    u = _urlparse(v)
    host = _storage_host()
    if u.scheme == "https" and host and (u.hostname or "").lower() == host and u.path.startswith("/storage/v1/object/") and not u.username:
        return v
    raise HTTPException(status_code=400, detail="Invalid file link")


def validate_file_urls(values, *, max_items: int = 10, **kw) -> list[str]:
    if values is None:
        return []
    if not isinstance(values, (list, tuple)) or len(values) > max_items:
        raise HTTPException(status_code=400, detail="Too many or invalid attachments")
    return [validate_file_url(v, **kw) for v in values]
