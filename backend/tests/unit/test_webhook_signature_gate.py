"""A forged payment notice must never be accepted in production (finding S-06)."""
from types import SimpleNamespace

from app.api.v1.routes import webhooks


def test_signature_never_skipped_in_production(monkeypatch):
    monkeypatch.setattr(webhooks, "_settings", SimpleNamespace(APP_ENV="production"))
    assert webhooks._may_skip_signature(SimpleNamespace(is_sandbox=True)) is False   # even if the URL still says sandbox
    assert webhooks._may_skip_signature(SimpleNamespace(is_sandbox=False)) is False


def test_signature_may_be_skipped_only_for_sandbox_outside_production(monkeypatch):
    monkeypatch.setattr(webhooks, "_settings", SimpleNamespace(APP_ENV="development"))
    assert webhooks._may_skip_signature(SimpleNamespace(is_sandbox=True)) is True
    assert webhooks._may_skip_signature(SimpleNamespace(is_sandbox=False)) is False
