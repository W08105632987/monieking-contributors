import hashlib
import hmac
import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")

from app.core.config import settings  # noqa: E402
from app.integrations.monnify import MonnifyProvider  # noqa: E402
from app.services import monnify_readiness as mr  # noqa: E402


def _sig(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()


def test_webhook_falls_back_to_secret_key(monkeypatch):
    monkeypatch.setattr(settings, "MONNIFY_WEBHOOK_SECRET", "")
    monkeypatch.setattr(settings, "MONNIFY_SECRET_KEY", "sk_live_x")
    body = b'{"eventType":"SUCCESSFUL_TRANSACTION"}'
    assert MonnifyProvider().verify_webhook_signature(body, _sig("sk_live_x", body))
    assert not MonnifyProvider().verify_webhook_signature(body, _sig("other", body))


def test_readiness_flags_sandbox_wallet_on_live(monkeypatch):
    monkeypatch.setattr(settings, "MONNIFY_BASE_URL", "https://api.monnify.com")
    monkeypatch.setattr(settings, "MONNIFY_API_KEY", "k")
    monkeypatch.setattr(settings, "MONNIFY_SECRET_KEY", "s")
    monkeypatch.setattr(settings, "MONNIFY_CONTRACT_CODE", "c")
    monkeypatch.setattr(settings, "MONNIFY_WEBHOOK_SECRET", "different")
    monkeypatch.setattr(settings, "MONNIFY_SOURCE_ACCOUNT_NUMBER", "5856364342")
    by = {c["key"]: c["status"] for c in mr.static_checks()}
    assert by["mode"] == "ok" and by["source_account"] == "fail" and by["webhook_secret"] == "warn"
    monkeypatch.setattr(settings, "MONNIFY_BASE_URL", "https://sandbox.monnify.com")
    assert {c["key"]: c["status"] for c in mr.static_checks()}["mode"] == "warn"
