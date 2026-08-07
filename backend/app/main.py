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

# ── Import and mount routers AFTER middleware ──────────────────────
from app.api.v1.routes import (
    auth, users, wallets, cards, notifications, admin, withdrawals,
    settings as settings_routes, instant_messages, promo_banners, zones,
    webauthn as webauthn_routes, disputes,
)
from app.api.v1.routes.webhooks import router as webhook_router

PREFIX = "/api/v1"

app.include_router(auth.router,          prefix=PREFIX)
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
app.include_router(webhook_router)

# ── Global error handler — full detail logged server-side, only a
# generic message ever goes back to the client. Returning str(exc)
# directly used to leak query fragments, file paths, and library
# internals to anyone probing the API. ──
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
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