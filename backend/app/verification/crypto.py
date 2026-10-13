"""Encryption for stored lookup results (person data, photo, PDFs).

Fernet (AES-128-CBC + HMAC). VERIFICATION_ENCRYPTION_KEY may hold several
comma-separated keys: the FIRST encrypts, all of them decrypt, so a key can be
rotated without losing data still inside its retention window."""
import json

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings


class CryptoNotConfigured(RuntimeError):
    pass


def _fernet(raw: str | None = None) -> MultiFernet:
    raw = settings.VERIFICATION_ENCRYPTION_KEY if raw is None else raw
    keys = [k.strip() for k in (raw or "").split(",") if k.strip()]
    if not keys:
        raise CryptoNotConfigured("VERIFICATION_ENCRYPTION_KEY is not set")
    try:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    except Exception as e:  # malformed key
        raise CryptoNotConfigured("VERIFICATION_ENCRYPTION_KEY is invalid") from e


def is_configured() -> bool:
    try:
        _fernet()
        return True
    except CryptoNotConfigured:
        return False


def encrypt_bytes(data: bytes, *, key: str | None = None) -> bytes:
    return _fernet(key).encrypt(data)


def decrypt_bytes(token: bytes, *, key: str | None = None) -> bytes | None:
    """None when the token cannot be decrypted (wrong/rotated-out key)."""
    try:
        return _fernet(key).decrypt(bytes(token))
    except InvalidToken:
        return None


def encrypt_json(obj, *, key: str | None = None) -> bytes:
    return encrypt_bytes(json.dumps(obj, separators=(",", ":")).encode(), key=key)


def decrypt_json(token: bytes, *, key: str | None = None):
    raw = decrypt_bytes(token, key=key)
    return None if raw is None else json.loads(raw)
