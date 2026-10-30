"""Private document links: references open nothing, authorised responses get short-lived signed links (D-03)."""
import asyncio
from types import SimpleNamespace

import pytest

from app.utils import private_files as pf

HOST = "https://abc.supabase.co"
REF = f"{HOST}/storage/v1/object/documents/manual_u1_abc.pdf"
PUBLIC = f"{HOST}/storage/v1/object/public/avatars/old.png"


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    monkeypatch.setattr(pf, "_base", lambda: HOST)
    pf._cache.clear()
    calls = []

    async def fake_request(method, path, **kw):
        calls.append((method, path, kw.get("json")))
        return SimpleNamespace(json=lambda: {"signedURL": f"/object/sign/documents/manual_u1_abc.pdf?token=T{len(calls)}"})
    monkeypatch.setattr("app.utils.supabase_admin_client.supabase_admin_request", fake_request)
    return calls


def test_reference_detection():
    assert pf.is_private_ref(REF)
    assert not pf.is_private_ref(PUBLIC)
    assert not pf.is_private_ref("https://evil.example/storage/v1/object/documents/x")
    assert not pf.is_private_ref(None)


@pytest.mark.asyncio
async def test_private_refs_become_signed_links_and_others_are_untouched(_setup):
    job = {"uploaded_files": [REF, PUBLIC, "data:image/png;base64,AAAA"], "worker_result_file_url": REF}
    out = await pf.presign(job)
    assert out["uploaded_files"][0].startswith(f"{HOST}/storage/v1/object/sign/documents/manual_u1_abc.pdf?token=")
    assert out["uploaded_files"][1:] == [PUBLIC, "data:image/png;base64,AAAA"]
    assert out["worker_result_file_url"].startswith(f"{HOST}/storage/v1/object/sign/")
    assert len(_setup) == 1 and _setup[0][2] == {"expiresIn": 3600}   # same file signed once, then cached


@pytest.mark.asyncio
async def test_a_failed_signing_never_leaks_the_bare_reference(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr("app.utils.supabase_admin_client.supabase_admin_request", boom)
    out = await pf.presign([{"uploaded_files": [REF], "worker_result_file_url": REF}])
    assert out[0]["uploaded_files"] == [""] and out[0]["worker_result_file_url"] is None


@pytest.mark.asyncio
async def test_lists_of_jobs_are_signed_together(_setup):
    out = await pf.presign([{"uploaded_files": [REF]}, {"uploaded_files": [REF]}, {"uploaded_files": []}])
    assert all(o["uploaded_files"] == [] or o["uploaded_files"][0].startswith("https://abc") for o in out)
    assert len(_setup) == 1
