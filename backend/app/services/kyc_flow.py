"""Identity check for virtual accounts: look the person up with Techhub, show them the verified name,
and only after they confirm with their PIN create the Monnify virtual account in that name.

The BVN/NIN is never stored. Between "preview" and "confirm" the server hands the app a short-lived signed
proof (who, which ID, a one-way hash of the number, the verified name, an expiry). Confirm needs the proof AND the
same number, so a proof can't be reused for a different ID or by a different person."""
import base64
import hashlib
import hmac
import json
import re
import time

from fastapi import HTTPException

from app.core.config import settings

PROOF_TTL_SECONDS = 15 * 60


def _secret() -> bytes:
    key = settings.SUPABASE_JWT_SECRET or settings.MONNIFY_SECRET_KEY
    if not key:
        raise HTTPException(status_code=503, detail="Identity verification is not available right now. Please try again later.")
    return ("kyc-proof:" + key).encode()


def id_hash(user_id: str, kind: str, number: str) -> str:
    return hashlib.sha256(f"{user_id}:{kind}:{number}".encode()).hexdigest()


def make_proof(*, user_id: str, kind: str, number: str, name: str, name_ok: bool, now: float | None = None) -> str:
    body = {"u": str(user_id), "k": kind, "h": id_hash(str(user_id), kind, number), "n": name, "ok": bool(name_ok),
            "exp": int((now if now is not None else time.time()) + PROOF_TTL_SECONDS)}
    raw = base64.urlsafe_b64encode(json.dumps(body, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_secret(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def read_proof(proof: str, *, user_id: str, kind: str, number: str, now: float | None = None) -> dict:
    bad = HTTPException(status_code=400, detail="This verification has expired. Please check your details again.")
    try:
        raw, sig = (proof or "").split(".", 1)
        expected = hmac.new(_secret(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise bad
        body = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except HTTPException:
        raise
    except Exception:
        raise bad
    if body.get("exp", 0) < (now if now is not None else time.time()):
        raise bad
    if body.get("u") != str(user_id) or body.get("k") != kind or body.get("h") != id_hash(str(user_id), kind, number):
        raise bad
    return body


_TOKEN = re.compile(r"[A-Za-z]+")


def _tokens(name: str) -> set[str]:
    return {t.upper() for t in _TOKEN.findall(name or "") if len(t) > 1}


def names_match(registered: str, verified: str) -> bool:
    """Same person if at least two name parts agree (or the only name there is agrees). Order, case and
    middle names don't matter: 'OKAFOR Ada Chioma' matches 'Ada Okafor'."""
    a, b = _tokens(registered), _tokens(verified)
    if not a or not b:
        return False
    need = 2 if min(len(a), len(b)) >= 2 else 1
    return len(a & b) >= need
