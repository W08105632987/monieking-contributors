from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────────
    APP_ENV: str = "development"
    APP_NAME: str = "MonieKing Contributors"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # ── Database ──────────────────────────────────────────────────
    DATABASE_URL: str = ""
    DATABASE_URL_SYNC: str = ""

    # ── Supabase ──────────────────────────────────────────────────
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""

    # ── CORS ──────────────────────────────────────────────────────
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    @property
    def webauthn_origin_list(self) -> List[str]:
        # Comma-separated, same pattern as CORS_ORIGINS — lets biometric
        # login/enrollment work correctly from BOTH localhost and a
        # Cloudflare Tunnel domain (or any other origin you're testing
        # from) at the same time, without needing to restart the backend
        # with different settings to switch between them.
        return [o.strip() for o in self.WEBAUTHN_ORIGIN.split(",")]

    # ── Monnify ───────────────────────────────────────────────────
    MONNIFY_BASE_URL: str = "https://sandbox.monnify.com"
    MONNIFY_API_KEY: str = ""
    MONNIFY_SECRET_KEY: str = ""
    MONNIFY_CONTRACT_CODE: str = ""
    MONNIFY_WEBHOOK_SECRET: str = ""
    MONNIFY_SOURCE_ACCOUNT_NUMBER: str = "5856364342"  

    # ── Redis ─────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── WebAuthn ──────────────────────────────────────────────────
    WEBAUTHN_RP_ID: str = "localhost"
    WEBAUTHN_RP_NAME: str = "MonieKing Contributors"
    WEBAUTHN_ORIGIN: str = "http://localhost:3000"

    # ── Sentry ───────────────────────────────────────────────────
    SENTRY_DSN: str = ""

    # ── SMS ───────────────────────────────────────────────────────
    TERMII_API_KEY: str = ""
    TERMII_SENDER_ID: str = "MonieKing"

    # ── Financial constants ───────────────────────────────────────
    CARD_TOTAL_MONTHS: int = 12
    CARD_DAYS_PER_MONTH: int = 31
    CARD_TOTAL_DAYS: int = 372          # 12 × 31
    WITHDRAWAL_SLA_HOURS: int = 24
    MAX_FOOD_CARDS_PER_CUSTOMER: int = 2
    MIN_REGULAR_CARD_RATE_KOBO: int = 50000   # ₦500
    MAX_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_MINUTES: int = 15    # withdrawal-password lockout duration — see withdrawal_auth_service.py
    LOGIN_LOCKOUT_INITIAL_HOURS: float = 1.0
    LOGIN_LOCKOUT_ESCALATED_HOURS: float = 3.0

    # ── Session cookies ───────────────────────────────────────────
    # COOKIE_SECURE must be True in production (cookies only sent over
    # HTTPS) — kept False by default only so local http://localhost dev
    # still works; APP_ENV=production forces it True regardless (see
    # cookie_secure property below) so a forgotten .env flag can't
    # accidentally ship an insecure cookie.
    COOKIE_SECURE: bool = False
    COOKIE_DOMAIN: str = ""   # e.g. ".monieking.app" in production; blank = host-only in dev
    ACCESS_TOKEN_COOKIE_MAX_AGE: int = 3600        # 1 hour, matches Supabase's default access token lifetime
    REFRESH_TOKEN_COOKIE_MAX_AGE: int = 60 * 60 * 24 * 30  # 30 days

    @property
    def cookie_secure(self) -> bool:
        return True if self.APP_ENV == "production" else self.COOKIE_SECURE


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
