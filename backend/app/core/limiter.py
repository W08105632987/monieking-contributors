"""
Rate limiter — backed by Redis, but deliberately not DEPENDENT on it.

Redis here is a shared counter store, nothing more — the same "how many
requests has this IP made in the last minute" data just needs to be
visible across all your backend worker processes (this was previously
in-memory-only, which meant `5/minute` on 4 workers was actually
`20/minute` in practice, and every worker restart quietly reset
everyone's counters).

If Redis goes down or becomes unreachable, THIS chooses to keep the app
working over strict rate limiting: it automatically falls back to
per-worker in-memory limiting (in_memory_fallback_enabled) — meaning
your login/withdrawal endpoints briefly enforce limits per-worker only
instead of globally, rather than customers being unable to log in or
withdraw during a Redis outage. swallow_errors is the last line of
defense — if the storage layer throws anything unexpected, the request
proceeds rather than 500ing.

This is the ONLY thing Redis is used for on the auth/security side of
this app. Session state lives in httpOnly cookies + Postgres (see
core/cookies.py, login_service.py) — Redis is never the source of truth
for who's logged in, account balances, or lockout state; those all stay
in Postgres, which is durable and transactional. Redis losing data here
costs you a temporarily looser rate limit, never a security bypass or a
wrong balance.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings

settings = get_settings()

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.REDIS_URL,
    in_memory_fallback_enabled=True,
    swallow_errors=True,
)
