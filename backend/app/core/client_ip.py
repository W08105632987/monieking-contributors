"""Real client IP behind Railway's proxy, without letting attackers fake it (finding S-07 / P-01).

Railway (like any reverse proxy) puts the real visitor in `X-Forwarded-For`. Uvicorn is not told to trust it, so
every request looked like it came from the proxy's own address. Two consequences:
  * every customer shared ONE rate-limit bucket ("10 logins/minute" for the whole country - at launch scale
    that locks everybody out), and
  * the per-IP protections protected nothing against an attacker.
Simply trusting the header is also wrong: the LEFT-most entry is whatever the caller typed, so an attacker could
claim a new IP on every request and dodge every limit. A proxy APPENDS the address it actually saw, so the
RIGHT-most entry is the only one that can be trusted. This middleware rewrites the client address with that one.
Only enabled in production (or when TRUST_PROXY_HEADERS=true) because a server reachable directly from the
internet must not trust the header at all.
"""
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import get_settings


def rightmost_forwarded_ip(header_value: str | None) -> str | None:
    if not header_value:
        return None
    parts = [p.strip() for p in header_value.split(",") if p.strip()]
    return parts[-1] if parts else None


class TrustedProxyMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app
        s = get_settings()
        self.enabled = s.APP_ENV == "production" or s.TRUST_PROXY_HEADERS

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if self.enabled and scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers") or [])
            ip = rightmost_forwarded_ip(headers.get(b"x-forwarded-for", b"").decode("latin1"))
            if ip:
                scope["client"] = (ip, 0)
        await self.app(scope, receive, send)
