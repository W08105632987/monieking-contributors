"""Celery must not hold a connection pool; the API must keep its small reusable one."""
import importlib
import os
import sys

BASE_ENV = {
    "DATABASE_URL": "postgresql+asyncpg://u:p@localhost/db", "DATABASE_URL_SYNC": "postgresql://u:p@localhost/db",
    "SUPABASE_URL": "http://x", "SUPABASE_SERVICE_ROLE_KEY": "x", "SUPABASE_ANON_KEY": "x", "SUPABASE_JWT_SECRET": "x", "SECRET_KEY": "x",
}


def _engine_pool(monkeypatch, null_pool: bool):
    for k, v in BASE_ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("DB_USE_NULL_POOL", "1" if null_pool else "0")
    for m in ("app.core.config", "app.core.database"):
        sys.modules.pop(m, None)
    db = importlib.import_module("app.core.database")
    return type(db.engine.pool).__name__


def test_api_keeps_a_small_pool(monkeypatch):
    assert _engine_pool(monkeypatch, False) == "AsyncAdaptedQueuePool"


def test_celery_uses_no_pool(monkeypatch):
    assert _engine_pool(monkeypatch, True) == "NullPool"


def test_celery_app_turns_null_pool_on():
    src = open(os.path.join(os.path.dirname(__file__), "..", "..", "app", "celery_app.py")).read()
    assert src.index('os.environ.setdefault("DB_USE_NULL_POOL", "1")') < src.index("from app.core.config import")
