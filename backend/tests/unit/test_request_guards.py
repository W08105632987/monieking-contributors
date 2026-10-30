"""Real-IP handling and request-size cap (findings S-07, S-08)."""
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.body_limit import BodySizeLimitMiddleware
from app.core.client_ip import TrustedProxyMiddleware, rightmost_forwarded_ip


def test_rightmost_entry_is_the_trusted_one():
    # attacker typed "1.1.1.1"; the proxy appended the address it really saw
    assert rightmost_forwarded_ip("1.1.1.1, 203.0.113.7") == "203.0.113.7"
    assert rightmost_forwarded_ip("203.0.113.7") == "203.0.113.7"
    assert rightmost_forwarded_ip("") is None and rightmost_forwarded_ip(None) is None


def _ip_app(enabled: bool):
    app = FastAPI()

    @app.get("/ip")
    async def ip(request: Request):
        return {"ip": request.client.host if request.client else None}

    mw = TrustedProxyMiddleware(app)
    mw.enabled = enabled
    return mw


def test_spoofed_left_entry_is_ignored_when_trusted():
    c = TestClient(_ip_app(True))
    assert c.get("/ip", headers={"X-Forwarded-For": "6.6.6.6, 198.51.100.9"}).json()["ip"] == "198.51.100.9"


def test_header_ignored_when_proxy_not_trusted():
    c = TestClient(_ip_app(False))
    assert c.get("/ip", headers={"X-Forwarded-For": "6.6.6.6"}).json()["ip"] != "6.6.6.6"


def _size_app(limit):
    app = FastAPI()

    @app.post("/up")
    async def up(request: Request):
        return {"n": len(await request.body())}

    return BodySizeLimitMiddleware(app, max_bytes=limit)


def test_small_body_passes_and_big_body_is_refused():
    c = TestClient(_size_app(1000))
    assert c.post("/up", content=b"x" * 500).status_code == 200
    r = c.post("/up", content=b"x" * 5000)
    assert r.status_code == 413
