"""BVN/NIN identity verification + KYC route helpers — no network or database."""
import asyncio
import os

import httpx
import pytest
from fastapi import HTTPException

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")

from app.integrations import monnify as mn   # noqa: E402
from app.api.v1.routes import wallets as wl  # noqa: E402


REAL_CLIENT = httpx.AsyncClient   # captured once: monkeypatch replaces httpx.AsyncClient


def run(coro):
    return asyncio.run(coro)


def _provider(monkeypatch, handler, *, live=True):
    p = mn.MonnifyProvider()
    p.base_url = "https://api.monnify.com" if live else "https://sandbox.monnify.com"

    async def headers():
        return {"Authorization": "Bearer t"}
    p._headers = headers
    real = REAL_CLIENT
    seen = []

    def factory(*a, **kw):
        kw.pop("timeout", None)

        def wrapped(request):
            seen.append(str(request.url.path))
            return handler(request)
        return real(transport=httpx.MockTransport(wrapped), **kw)
    monkeypatch.setattr(mn.httpx, "AsyncClient", factory)
    return p, seen


OK = lambda body: httpx.Response(200, json={"requestSuccessful": True, "responseBody": body})


def test_sandbox_skips_live_only_verification_without_any_call(monkeypatch):
    p, seen = _provider(monkeypatch, lambda r: httpx.Response(500), live=False)
    assert run(p.verify_bvn(bvn="22222222222", name="A B", date_of_birth="03-Oct-1993", mobile_no="0803")) is True
    assert run(p.verify_nin(nin="22222222222")) is True
    assert seen == []


def test_bvn_boolean_shape(monkeypatch):
    p, _ = _provider(monkeypatch, lambda r: OK({"bvnInformationMatch": True}))
    assert run(p.verify_bvn(bvn="1", name="n", date_of_birth="03-Oct-1993", mobile_no="1")) is True
    p, _ = _provider(monkeypatch, lambda r: OK({"bvnInformationMatch": False}))
    assert run(p.verify_bvn(bvn="1", name="n", date_of_birth="03-Oct-1993", mobile_no="1")) is False


def test_bvn_granular_shape_needs_name_and_one_exact_match(monkeypatch):
    body = {"name": {"matchStatus": "PARTIAL_MATCH"}, "dateOfBirth": "NO_MATCH", "mobileNo": "FULL_MATCH"}
    p, _ = _provider(monkeypatch, lambda r: OK(body))
    assert run(p.verify_bvn(bvn="1", name="n", date_of_birth="x", mobile_no="1")) is True
    body = {"name": {"matchStatus": "FULL_MATCH"}, "dateOfBirth": "NO_MATCH", "mobileNo": "NO_MATCH"}
    p, _ = _provider(monkeypatch, lambda r: OK(body))
    assert run(p.verify_bvn(bvn="1", name="n", date_of_birth="x", mobile_no="1")) is False


def test_nin_uses_nin_details_first_and_accepts_a_found_record(monkeypatch):
    p, seen = _provider(monkeypatch, lambda r: OK({"firstName": "ADA", "lastName": "OBI"}))
    assert run(p.verify_nin(nin="12345678901")) is True
    assert seen == ["/api/v1/vas/nin-details"]


def test_nin_falls_back_to_old_path_on_404(monkeypatch):
    def handler(r):
        if r.url.path.endswith("/nin-details"):
            return httpx.Response(404, json={"status": 404, "error": "Not Found"})
        return OK({"ninInformationMatch": True})
    p, seen = _provider(monkeypatch, handler)
    assert run(p.verify_nin(nin="12345678901")) is True
    assert seen == ["/api/v1/vas/nin-details", "/api/v1/vas/nin-details-match"]


def test_nin_not_found_by_monnify_is_a_422_with_its_message(monkeypatch):
    p, _ = _provider(monkeypatch, lambda r: httpx.Response(
        400, json={"requestSuccessful": False, "responseMessage": "Invalid NIN", "responseCode": "99"}))
    with pytest.raises(HTTPException) as ei:
        run(p.verify_nin(nin="12345678901"))
    assert ei.value.status_code == 422 and "not a valid NIN" in ei.value.detail


@pytest.mark.parametrize("status", [401, 403, 404, 500, 503])
def test_service_side_failures_are_a_502_not_blamed_on_the_customer(monkeypatch, status):
    p, _ = _provider(monkeypatch, lambda r: httpx.Response(status, json={"error": "x"}))
    with pytest.raises(HTTPException) as ei:
        run(p.verify_bvn(bvn="1", name="n", date_of_birth="03-Oct-1993", mobile_no="1"))
    assert ei.value.status_code == 502 and "unavailable" in ei.value.detail.lower()


def test_unknown_bvn_shape_fails_closed(monkeypatch):
    p, _ = _provider(monkeypatch, lambda r: OK({"something": "else"}))
    with pytest.raises(HTTPException) as ei:
        run(p.verify_bvn(bvn="1", name="n", date_of_birth="03-Oct-1993", mobile_no="1"))
    assert ei.value.status_code == 502


def test_timeout_and_connect_errors(monkeypatch):
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)
    p, _ = _provider(monkeypatch, slow)
    with pytest.raises(HTTPException) as ei:
        run(p.verify_nin(nin="1"))
    assert ei.value.status_code == 504


def test_dob_is_locale_proof_and_zero_padded():
    assert wl._monnify_dob("1993-10-03") == "03-Oct-1993"
    assert wl._monnify_dob("2001-01-31") == "31-Jan-2001"
    assert wl._monnify_dob("1999-12-05") == "05-Dec-1999"
    with pytest.raises(ValueError):
        wl._monnify_dob("03/10/1993")


def test_monnify_reason_extracts_the_provider_message():
    req = httpx.Request("PUT", "https://x")
    resp = httpx.Response(400, json={"responseMessage": "BVN already linked"}, request=req)
    err = httpx.HTTPStatusError("400", request=req, response=resp)
    assert wl._monnify_reason(err) == "BVN already linked"
    assert wl._monnify_reason(HTTPException(status_code=502, detail="down")) == "down"
    assert wl._monnify_reason(RuntimeError("x")) == ""


def test_generic_code_99_is_our_side_not_the_customers_fault():
    import asyncio
    import pytest
    from fastapi import HTTPException
    from unittest.mock import patch, AsyncMock, MagicMock
    from app.integrations import monnify as m

    def fake_resp(body, status=400):
        r = MagicMock(); r.status_code = status; r.json.return_value = body; r.text = str(body)
        return r

    async def run(body):
        p = m.MonnifyProvider.__new__(m.MonnifyProvider)
        p.base_url = "https://api.monnify.com"
        p._headers = AsyncMock(return_value={})
        type(p).is_sandbox = property(lambda self: False)
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client); client.__aexit__ = AsyncMock(return_value=False)
        client.post = AsyncMock(return_value=fake_resp(body))
        with patch.object(m.httpx, "AsyncClient", return_value=client):
            return await p._run_verification("/api/v1/vas/bvn-details-match", {"bvn": "1"}, bool_field="bvnInformationMatch")

    with pytest.raises(HTTPException) as e:
        asyncio.run(run({"requestSuccessful": False, "responseMessage": "There was an error processing the request, Please try again later...", "responseCode": "99"}))
    assert e.value.status_code == 502 and "unavailable" in e.value.detail
    with pytest.raises(HTTPException) as e:
        asyncio.run(run({"requestSuccessful": False, "responseMessage": "Unable to process request. Invalid BVN provided", "responseCode": "99"}))
    assert e.value.status_code == 422 and "not a valid BVN" in e.value.detail
