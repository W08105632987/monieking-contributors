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
