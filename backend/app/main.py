"""
MonieKing Contributors — FastAPI Application
"""
from fastapi import FastAPI, Request, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import traceback

from app.core.config import settings
from app.core.database import engine
from app.core.timing import TimingMiddleware, instrument_engine
from app.core.limiter import limiter

# ── Sentry — was installed (sentry-sdk in requirements.txt) but never
# actually initialized anywhere. Gated on SENTRY_DSN being set so a
# blank/dev environment doesn't try to connect anywhere; this is the
# "catch every unhandled exception automatically" layer that
# complements the purpose-built health-monitor checks (health_service.py)
# — Sentry tells you an endpoint is throwing, the health monitor tells
# you the database is slow or a payment provider is unreachable, which
# Sentry alone wouldn't notice.
if settings.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.APP_ENV,
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.1,   # 10% of requests get full performance tracing — enough to spot trends without the overhead/cost of tracing every request
    )

app = FastAPI(
    title="MonieKing Contributors",
    version="0.1.0",
    # Interactive API docs are free reconnaissance for an attacker if left
    # public in production — only served when DEBUG is explicitly on.
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

# ── Rate limiting — was installed, never wired up. Applied per-route
# below (auth, withdrawal-password checks) rather than globally, since a
# single global limit would also throttle high-frequency legitimate
# polling (notifications, instant-message ticker, etc). ──
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Timing instrumentation — remove once debugging is done ────────
instrument_engine(engine)
app.add_middleware(TimingMiddleware)

# ── CORS — explicit allowlist only. The wildcard "*" combined with
# allow_credentials=True is functionally "trust any website with
# credentials" — browsers only allow that combination because Starlette
# reflects the actual Origin header back, defeating the purpose of an
# allowlist entirely. Add real deployed frontend origins here as they're
# known, never re-add "*". ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ── Bank-grade HTTP security headers ──────────────────────────────
# Every response gets these headers. They don't cost a single DB query
# but shut down entire categories of attack (XSS, clickjacking, MIME
# sniffing, referrer leaking, camera/mic/geolocation abuse).
# Starlette doesn't have a built-in security-headers middleware, so
# we add our own thin wrapper.
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: StarletteResponse = await call_next(request)

        # ── Content-Security-Policy ──
        # Restricts which origins can serve scripts, styles, images, fonts,
        # and connections. 'self' = same origin only. data: for inline SVGs
        # and base64 images. 'unsafe-inline' for styles only (many UI
        # libraries inject <style> tags). Scripts are NOT allowed inline —
        # this blocks reflected XSS payloads.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob: https:; "
            "connect-src 'self' https://api.monnify.com https://sandbox.monnify.com; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self';"
        )

        # ── Strict-Transport-Security ──
        # Force HTTPS for 1 year, include subdomains, allow HSTS preload.
        # Once a browser sees this header it will NEVER make a plain HTTP
        # request to this domain — even if the user types http://…
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains; preload"
        )

        # ── X-Content-Type-Options ──
        # Prevents browsers from sniffing a response away from the declared
        # Content-Type. Stops attacks that upload a .jpg containing JS and
        # trick the browser into executing it.
        response.headers["X-Content-Type-Options"] = "nosniff"

        # ── X-Frame-Options ──
        # Prevents the page from being embedded in an <iframe> on another
        # site (clickjacking). DENY is strictest — not even same-origin
        # framing is allowed, which is correct for a financial app.
        response.headers["X-Frame-Options"] = "DENY"

        # ── Referrer-Policy ──
        # Controls what the Referer header leaks when navigating away.
        # strict-origin-when-cross-origin sends only the origin (no path)
        # on cross-origin requests, and full URL on same-origin.
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # ── Permissions-Policy ──
        # Disables browser features the app never uses (camera, mic,
        # geolocation, payment, USB). Even if a XSS payload runs, it
        # can't silently activate the camera or read the GPS.
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), "
            "payment=(), usb=(), magnetometer=(), gyroscope=()"
        )

        # ── Cache-Control for API responses ──
        # Financial data must never be cached by proxies or shared caches.
        # no-store tells the browser not to write the response to disk at
        # all, no-cache forces revalidation every time, private blocks
        # CDN/proxy caching.
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, private, must-revalidate"
            response.headers["Pragma"] = "no-cache"

        return response

app.add_middleware(SecurityHeadersMiddleware)


# ── Import and mount routers AFTER middleware ──────────────────────
from app.api.v1.routes import (
    auth, users, wallets, cards, notifications, admin, withdrawals,
    settings as settings_routes, instant_messages, promo_banners, zones,
    webauthn as webauthn_routes, disputes, identity_services, bill_payments,
    customer_stats, auth_admin, admin_crm, analytics, system_health,
    food_collections,
    food_ledger,
    push,
)
from app.api.v1.routes.webhooks import router as webhook_router
from app.api.v1.routes.worker import router as worker_router
from app.api.v1.routes.manual_services import router as manual_services_router
from app.api.v1.routes.service_templates import router as service_templates_router

PREFIX = "/api/v1"

app.include_router(auth.router,          prefix=PREFIX)
app.include_router(auth_admin.router,    prefix=PREFIX)
app.include_router(users.router,         prefix=PREFIX)
app.include_router(wallets.router,       prefix=PREFIX)
app.include_router(cards.router,         prefix=PREFIX)
app.include_router(settings_routes.router,  prefix=PREFIX)
app.include_router(instant_messages.router, prefix=PREFIX)
app.include_router(promo_banners.router,    prefix=PREFIX)
app.include_router(zones.router,            prefix=PREFIX)
app.include_router(withdrawals.router,   prefix=PREFIX)
app.include_router(notifications.router, prefix=PREFIX)
app.include_router(admin.router,         prefix=PREFIX)
app.include_router(webauthn_routes.router, prefix=PREFIX)
app.include_router(disputes.router,       prefix=PREFIX)
app.include_router(identity_services.router, prefix=PREFIX)
app.include_router(bill_payments.router,     prefix=PREFIX)
app.include_router(customer_stats.router,    prefix=PREFIX)
app.include_router(admin_crm.router,         prefix=PREFIX)
app.include_router(analytics.router,         prefix=PREFIX)
app.include_router(system_health.router,     prefix=PREFIX)
app.include_router(food_collections.router,  prefix=PREFIX)
app.include_router(food_ledger.router,       prefix=PREFIX)
app.include_router(push.router,              prefix=PREFIX)
app.include_router(worker_router,            prefix=PREFIX)
app.include_router(manual_services_router,   prefix=PREFIX)
app.include_router(service_templates_router, prefix=PREFIX)
app.include_router(webhook_router)
app.include_router(webhook_router,           prefix=PREFIX)


# ── Global error handler — full detail logged server-side, only a
# generic message ever goes back to the client. Returning str(exc)
# directly used to leak query fragments, file paths, and library
# internals to anyone probing the API. ──
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()
    # Starlette runs this handler in ServerErrorMiddleware, which sits OUTSIDE
    # CORSMiddleware — so without this, every 500 reaches the browser with no
    # Access-Control-Allow-Origin header and shows up as a misleading CORS
    # error instead of the real "500 Internal Server Error".
    headers: dict[str, str] = {}
    origin = request.headers.get("origin")
    if origin and origin in settings.cors_origins_list:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Vary"] = "Origin"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
        headers=headers,
    )

# ── Health & root ─────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "app": "MonieKing Contributors"}

@app.get(f"{PREFIX}/health")
async def health_versioned():
    # Same as /health above, but under /api/v1 — the frontend's Vite dev
    # proxy (and presumably the production reverse proxy too) only
    # forwards /api/*, not the bare /health path, so the maintenance-page
    # "is the server back yet?" check needs this one specifically.
    return {"status": "ok", "app": "MonieKing Contributors"}

@app.get(f"{PREFIX}/health/auth-config")
async def health_auth_config():
    import httpx
    clean_url = settings.SUPABASE_URL.strip().strip('"').strip("'").rstrip("/")
    clean_key = settings.SUPABASE_SERVICE_ROLE_KEY.strip().strip('"').strip("'")
    status_code = None
    body_snippet = None
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(
                f"{clean_url}/auth/v1/settings",
                headers={"apikey": clean_key, "Authorization": f"Bearer {clean_key}"}
            )
            status_code = resp.status_code
            body_snippet = resp.text[:150]
    except Exception as e:
        body_snippet = f"Error: {e}"

    return {
        "app_env": settings.APP_ENV,
        "cookie_domain": settings.COOKIE_DOMAIN,
        "cookie_secure": settings.cookie_secure,
        "cors_origins": settings.cors_origins_list,
        "supabase_url": clean_url,
        "service_role_key_prefix": clean_key[:12] + "..." + clean_key[-6:] if clean_key else "EMPTY",
        "jwt_secret_prefix": settings.SUPABASE_JWT_SECRET[:8] + "..." if settings.SUPABASE_JWT_SECRET else "EMPTY",
        "supabase_connectivity_status": status_code,
        "supabase_connectivity_response": body_snippet,
    }


@app.get("/")
async def root():
    return {"message": "MonieKing Contributors API is running."}

# ── Debug: list all routes — was public with zero auth, free API
# reconnaissance for anyone. Now Director-only, and only registered at
# all when DEBUG is on. ──
if settings.DEBUG:
    from app.core.dependencies import DirectorOnly

    @app.get("/debug/routes")
    async def list_routes(director: DirectorOnly):
        return [
            {"path": r.path, "methods": list(r.methods)}
            for r in app.routes
        ]