"""CSRF defence for cookie sessions.

The session cookies are SameSite=None (the app and the API live on different sites), so a browser attaches them to a request
made from ANY website. CORS stops other sites READING answers but does not stop a simple cross-site request being SENT.
Browsers always add an `Origin` header to cross-site writes, so: when a write (POST/PUT/PATCH/DELETE) arrives carrying our
session cookie, its Origin must be one of our own front-end origins. Requests with no cookie (bearer-token clients, webhooks)
and requests with no Origin at all (server-to-server, curl, native apps) are not affected, since a browser cannot forge those
for a victim.
"""
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import get_settings
from app.core.cookies import ACCESS_COOKIE, REFRESH_COOKIE

_WRITES = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_ok(origin: str, allowed: set[str]) -> bool:
    return origin.rstrip("/").lower() in allowed


class OriginGuardMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app
        self.allowed = {o.rstrip("/").lower() for o in get_settings().cors_origins_list}

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope["method"] not in _WRITES:
            return await self.app(scope, receive, send)
        headers = {k.lower(): v for k, v in (scope.get("headers") or [])}
        origin = headers.get(b"origin", b"").decode("latin1")
        cookie = headers.get(b"cookie", b"").decode("latin1")
        has_session = (ACCESS_COOKIE + "=") in cookie or (REFRESH_COOKIE + "=") in cookie
        if origin and has_session and not _origin_ok(origin, self.allowed):
            try:
                from app.services.security_signals import record_soon
                record_soon("origin_blocked", "all", threshold=5, window_s=600, severity="warning",
                            title="Requests are being blocked by the Origin guard",
                            detail={"last_origin": origin[:120], "hint": "If real customers are affected, CORS_ORIGINS is missing this origin. Otherwise someone is sending forged requests."})
            except Exception:  # noqa: BLE001
                pass
            resp = JSONResponse({"detail": "This request was blocked because it did not come from the MonieKing app."}, status_code=403)
            return await resp(scope, receive, send)
        await self.app(scope, receive, send)
