import asyncio

import app.core.cache as cache


class FakeRedis:
    def __init__(self): self.d = {}
    async def get(self, k): return self.d.get(k)
    async def set(self, k, v, nx=False, ex=None):
        if nx and k in self.d: return None
        self.d[k] = v; return True
    async def delete(self, k): self.d.pop(k, None)


def test_single_flight_and_cache(monkeypatch):
    r = FakeRedis(); monkeypatch.setattr(cache, "get_redis", lambda: r)
    calls = {"n": 0}

    @cache.cache_report(ttl=10)
    async def report(start=None):
        calls["n"] += 1
        await asyncio.sleep(0.2)
        return {"total": 5}

    async def go():
        return await asyncio.gather(*[report(start="2026-01-01") for _ in range(8)])

    out = asyncio.run(go())
    assert all(o == {"total": 5} for o in out)
    assert calls["n"] == 1                       # eight concurrent requests, one computation
    assert asyncio.run(report(start="2026-01-01")) == {"total": 5} and calls["n"] == 1
    asyncio.run(report(start="2026-02-01")); assert calls["n"] == 2   # different arguments -> separate entry


def test_fails_open_when_redis_down(monkeypatch):
    class Down:
        async def get(self, k): raise RuntimeError("down")
    monkeypatch.setattr(cache, "get_redis", lambda: Down())

    @cache.cache_report()
    async def report(): return {"ok": True}
    assert asyncio.run(report()) == {"ok": True}
