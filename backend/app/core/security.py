import hashlib
import hmac
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
import jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

# ── JWKS cache (avoid refetching Supabase's public keys on every request) ──
_jwks_cache: dict = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL_SECONDS = 3600  # refresh once an hour

async def _get_jwks() -> dict:
    now = time.monotonic()
    if _jwks_cache["keys"] is None or (now - _jwks_cache["fetched_at"]) > _JWKS_TTL_SECONDS:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json")
            resp.raise_for_status()
            _jwks_cache["keys"] = resp.json()
            _jwks_cache["fetched_at"] = now
    return _jwks_cache["keys"]


# ── Password helpers ──────────────────────────────────────────────
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT verification (Supabase-issued toke# ── JWT verification (Supabase-issued tokens) ─────────────────────
async def verify_supabase_jwt(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)

        # HS256 path — uses SUPABASE_JWT_SECRET directly
        if header.get("alg") == "HS256":
            payload = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=f"{settings.SUPABASE_URL}/auth/v1",
            )
            return payload

        # ES256 path — uses cached JWKS from Supabase (fetched async, not on every call)
        kid = header.get("kid")
        if not kid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token header missing kid",
            )

        jwks = await _get_jwks()

        for key in jwks["keys"]:
            if key["kid"] == kid:
                from jwt.algorithms import ECAlgorithm
                public_key = ECAlgorithm.from_jwk(key)
                payload = jwt.decode(
                    token,
                    public_key,
                    algorithms=["ES256"],
                    audience="authenticated",
                    issuer=f"{settings.SUPABASE_URL}/auth/v1",
                )
                return payload

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No matching key found in JWKS",
        )

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as e:
        print(f"[security] Token validation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
        


# ── Monnify webhook HMAC verification ────────────────────────────
def verify_monnify_signature(payload: bytes, signature: str) -> bool:
    expected = hmac.new(
        settings.MONNIFY_WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha512,
    ).hexdigest()
    return hmac.compare_digest(expected.lower(), signature.lower())


# ── Idempotency key generation ────────────────────────────────────
def generate_reference() -> str:
    return f"MK-{uuid.uuid4().hex[:16].upper()}"


# ── Withdrawal password ───────────────────────────────────────────
def hash_withdrawal_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_withdrawal_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)
