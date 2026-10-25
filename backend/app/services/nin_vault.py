"""Encrypted NIN on file. The raw NIN is never written to the database: only a Fernet token (AES + HMAC).
Key: NIN_ENCRYPTION_KEY, or VERIFICATION_ENCRYPTION_KEY if that is the one already configured.
Anyone with database access alone sees unreadable text; reading it needs the key from the server environment."""
import logging

from app.core.config import settings
from app.verification import crypto

logger = logging.getLogger(__name__)


def _key() -> str:
    return settings.NIN_ENCRYPTION_KEY or settings.VERIFICATION_ENCRYPTION_KEY


def seal(nin: str) -> str | None:
    """Encrypted token for this NIN, or None when no key is configured (never falls back to plain text)."""
    try:
        return crypto.encrypt_bytes(nin.encode(), key=_key()).decode()
    except crypto.CryptoNotConfigured:
        logger.error("[nin-vault] no encryption key configured (NIN_ENCRYPTION_KEY / VERIFICATION_ENCRYPTION_KEY): NIN not stored")
        return None


def unseal(token: str | None) -> str | None:
    if not token:
        return None
    try:
        out = crypto.decrypt_bytes(token.encode(), key=_key())
    except crypto.CryptoNotConfigured:
        return None
    return out.decode() if out else None
