import asyncio

from app.core.origin_guard import OriginGuardMiddleware


def _run(method, headers):
    called = {}

    async def app(scope, receive, send):
        called["ok"] = True
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    mw = OriginGuardMiddleware(app)
    mw.allowed = {"https://app.monieking.com"}
    sent = []

    async def send(m):
        sent.append(m)

    async def receive():
        return {"type": "http.request", "body": b""}

    scope = {"type": "http", "method": method, "headers": [(k.encode(), v.encode()) for k, v in headers.items()]}
    asyncio.run(mw(scope, receive, send))
    return called.get("ok", False), sent[0]["status"]


def test_blocks_foreign_origin_with_session_cookie():
    assert _run("POST", {"origin": "https://evil.example", "cookie": "mk_access=abc"}) == (False, 403)


def test_allows_own_origin():
    assert _run("POST", {"origin": "https://app.monieking.com", "cookie": "mk_access=abc"})[0] is True


def test_allows_no_origin_and_no_cookie_and_gets():
    assert _run("POST", {"cookie": "mk_access=abc"})[0] is True
    assert _run("POST", {"origin": "https://evil.example"})[0] is True
    assert _run("GET", {"origin": "https://evil.example", "cookie": "mk_access=abc"})[0] is True
