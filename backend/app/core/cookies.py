"""Shared helpers for setting/clearing the httpOnly session cookies.
Used by /auth/login, /auth/refresh, /auth/logout, and the WebAuthn
passwordless login route — every place that hands someone a session."""
from fastapi import Response, Request

from app.core.config import get_settings

settings = get_settings()

ACCESS_COOKIE = "mk_access"
REFRESH_COOKIE = "mk_refresh"


def set_session_cookies(response: Response, access_token: str, refresh_token: str | None) -> None:
    cookie_kwargs = dict(
        httponly=True,
        secure=settings.cookie_secure,
        samesite="none" if settings.cookie_secure else "lax",
        path="/",
    )
    if settings.COOKIE_DOMAIN:
        cookie_kwargs["domain"] = settings.COOKIE_DOMAIN

    response.set_cookie(ACCESS_COOKIE, access_token, max_age=settings.ACCESS_TOKEN_COOKIE_MAX_AGE, **cookie_kwargs)
    if refresh_token:
        response.set_cookie(REFRESH_COOKIE, refresh_token, max_age=settings.REFRESH_TOKEN_COOKIE_MAX_AGE, **cookie_kwargs)


def clear_session_cookies(response: Response) -> None:
    cookie_kwargs = dict(
        path="/",
        secure=settings.cookie_secure,
        samesite="none" if settings.cookie_secure else "lax",
    )
    if settings.COOKIE_DOMAIN:
        cookie_kwargs["domain"] = settings.COOKIE_DOMAIN
    response.delete_cookie(ACCESS_COOKIE, **cookie_kwargs)
    response.delete_cookie(REFRESH_COOKIE, **cookie_kwargs)


def get_access_cookie(request: Request) -> str | None:
    return request.cookies.get(ACCESS_COOKIE)


def get_refresh_cookie(request: Request) -> str | None:
    return request.cookies.get(REFRESH_COOKIE)
