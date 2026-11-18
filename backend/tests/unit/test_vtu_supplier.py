"""GYKDATASUB supplier layer: client behaviour against a mocked HTTP server, failover safety, pricing, Airtime-to-Cash maths."""
import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")

from app.core.config import settings                                  # noqa: E402
from app.integrations import gyk                                      # noqa: E402
from app.models.bill_payment import BillerCategory                    # noqa: E402
from app.services import airtime_cash_service as a2c                  # noqa: E402
from app.services import bill_payment_service as svc                  # noqa: E402
from app.services import bill_pricing as bp                           # noqa: E402
from app.services import provider_router as router                    # noqa: E402


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setattr(settings, "GYK_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GYK_BASE_URL", "https://gyk.test")
    monkeypatch.setattr(settings, "GYK_TRANSACTION_PIN", "")


def client(handler):
    return gyk.GykProvider(transport=httpx.MockTransport(handler))


def run(coro):
    return asyncio.run(coro)


# ── Plans ────────────────────────────────────────────────────────────────
def test_plan_list_is_parsed_and_unknown_networks_and_bad_prices_are_skipped():
    def handler(req):
        assert req.method == "POST" and req.url.path == settings.GYK_PLANS_PATH and json.loads(req.content) == {"action": "allplans"}
        assert req.headers["authorization"] == "Bearer test-key"
        return httpx.Response(200, json={"status": "success", "data": [
            {"plan_id": 11, "network": 1, "plan_name": "1.5GB SME", "validity": "30 days", "price": "320"},
            {"id": 7, "network": "4", "name": "2GB", "validity": "", "amount": 600},
            {"plan_id": 5, "network": 9, "plan_name": "mystery", "price": 100},       # unknown network
            {"plan_id": 6, "network": 2, "plan_name": "bad", "price": "free"},        # unreadable price
            {"plan_id": 8, "network": 3, "plan_name": "zero", "price": 0}]})
    plans = run(client(handler).get_all_plans())
    assert [(p["variation_code"], p["network"], p["amount_naira"], p["name"]) for p in plans] == [("11", "1", 320.0, "1.5GB SME 30 days"), ("7", "4", 600.0, "2GB")]
    assert [p["variation_code"] for p in run(client(handler).get_data_plans("4"))] == ["7"]


# ── Purchases: definite vs ambiguous ──────────────────────────────────────
def test_data_purchase_sends_both_spellings_and_reads_success():
    seen = {}
    def handler(req):
        seen.update(json.loads(req.content)); seen["path"] = req.url.path
        return httpx.Response(200, json={"status": "success", "message": "done", "reference": "R1", "wallet_balance": 900})
    r = run(client(handler).buy_data(network="1", phone="08012345678", variation_code="11", idempotency_key="abc"))
    assert seen["path"] == settings.GYK_DATA_PATH and seen["plan"] == 11 and seen["plan_id"] == 11 and seen["mobile_number"] == seen["phone"] == "08012345678" and seen["network"] == 1
    assert r["vendStatus"] == "SUCCESS" and r["transactionReference"] == "R1" and "_error" not in r


def test_the_account_pin_is_only_sent_when_configured(monkeypatch):
    bodies = []
    def handler(req):
        bodies.append(json.loads(req.content)); return httpx.Response(200, json={"status": "success"})
    run(client(handler).buy_airtime(network="1", phone="0801", amount_naira=100, idempotency_key="k"))
    monkeypatch.setattr(settings, "GYK_TRANSACTION_PIN", "1234")
    run(client(handler).buy_airtime(network="1", phone="0801", amount_naira=100, idempotency_key="k"))
    assert "pin" not in bodies[0] and bodies[1]["pin"] == "1234"


@pytest.mark.parametrize("status,body,ambiguous,kind", [
    (200, {"status": "error", "message": "Insufficient wallet balance"}, False, "provider"),
    (200, {"status": "error", "message": "Invalid phone number"}, False, "customer"),
    (401, {"message": "Unauthorized"}, False, "provider"),
    (200, {"status": "error", "message": "Something odd happened"}, True, "provider"),    # unclassifiable => hold, never refund
])
def test_error_replies_are_classified_so_money_is_never_guessed(status, body, ambiguous, kind):
    r = run(client(lambda req: httpx.Response(status, json=body)).buy_airtime(network="1", phone="0801", amount_naira=100, idempotency_key="k")) if status == 200 else None
    if status == 200:
        err = r["_error"]
    else:
        with pytest.raises(gyk.VtuError) as ei:
            run(client(lambda req: httpx.Response(status, json=body)).buy_airtime(network="1", phone="0801", amount_naira=100, idempotency_key="k"))
        err = ei.value
    assert (err.ambiguous, err.kind) == (ambiguous, kind)


def test_a_timeout_after_sending_is_ambiguous_but_a_refused_connection_is_not():
    def boom_read(req): raise httpx.ReadTimeout("slow")
    def boom_connect(req): raise httpx.ConnectError("no route")
    with pytest.raises(gyk.VtuError) as a:
        run(client(boom_read).buy_data(network="1", phone="0801", variation_code="1", idempotency_key="k"))
    with pytest.raises(gyk.VtuError) as b:
        run(client(boom_connect).buy_data(network="1", phone="0801", variation_code="1", idempotency_key="k"))
    assert a.value.ambiguous is True and b.value.ambiguous is False
    with pytest.raises(gyk.VtuError) as c:
        run(client(lambda req: httpx.Response(502, text="<html>bad gateway</html>")).buy_data(network="1", phone="0801", variation_code="1", idempotency_key="k"))
    assert c.value.ambiguous is True


def test_definite_provider_failure_decides_when_another_supplier_may_be_tried():
    f = svc._definite_provider_failure
    assert f("vtu", {}, gyk.VtuError("x", kind="provider")) is True
    assert f("vtu", {}, gyk.VtuError("x", kind="customer")) is False            # bad number: another supplier will not help
    assert f("vtu", {}, gyk.VtuError("x", kind="provider", ambiguous=True)) is False   # may have been delivered: NEVER retry elsewhere
    assert f("monnify", {"vendStatus": "FAILED", "responseMessage": "Insufficient wallet balance"}, None) is True
    assert f("monnify", {"vendStatus": "FAILED", "responseMessage": "Invalid phone number"}, None) is False
    assert f("monnify", {"vendStatus": "SUCCESS"}, None) is False


# ── Reconciliation from wallet history ────────────────────────────────────
def history(rows):
    return client(lambda req: httpx.Response(200, json={"status": "success", "data": rows}))


def test_history_matching_settles_exactly_one_clear_match_and_refuses_to_guess():
    now = datetime.now(timezone(timedelta(hours=1)))
    row = lambda status, minutes=0: {"mobile_number": "08012345678", "status": status, "date_time": (now + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S"), "reference": "H1"}
    since = datetime.now(timezone.utc) - timedelta(minutes=5)
    assert run(history([row("success")]).find_purchase(phone="+2348012345678", since=since))["vendStatus"] == "SUCCESS"
    assert run(history([row("failed")]).find_purchase(phone="08012345678", since=since))["vendStatus"] == "FAILED"
    assert run(history([row("success"), row("success", 1)]).find_purchase(phone="08012345678", since=since)) is None      # two look-alikes: cannot tell
    assert run(history([]).find_purchase(phone="08012345678", since=since)) == {"vendStatus": "NOT_FOUND"}
    old = {"mobile_number": "08012345678", "status": "success", "date_time": (now - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S")}
    assert run(history([old]).find_purchase(phone="08012345678", since=since)) == {"vendStatus": "NOT_FOUND"}              # an older purchase is not ours
    assert run(client(lambda r: httpx.Response(500, text="x")).find_purchase(phone="0801", since=since)) is None            # unreadable history: unknown


# ── Routing ───────────────────────────────────────────────────────────────
def airtime_biller(provider="monnify", name="MTN"):
    return SimpleNamespace(id=uuid.uuid4(), provider=provider, category=BillerCategory.AIRTIME, name=name, product_name=f"{name} Top up")


def test_routing_default_backup_and_manual_switch(monkeypatch):
    async def fake_down(name): return False
    monkeypatch.setattr(router, "is_down", fake_down)
    b = airtime_biller()
    assert run(router.providers_for(b, {"airtime_provider": "monnify", "provider_auto_failover": True})) == ["monnify", "vtu"]
    assert run(router.providers_for(b, {"airtime_provider": "monnify", "provider_auto_failover": False})) == ["monnify"]
    assert run(router.providers_for(b, {"airtime_provider": "vtu", "provider_auto_failover": True})) == ["vtu", "monnify"]
    data = SimpleNamespace(provider="monnify", category=BillerCategory.DATA, name="MTN", product_name="1GB")
    assert run(router.providers_for(data, {"airtime_provider": "vtu"})) == ["monnify"]                       # data never swaps plan-for-plan
    vtu_plan = SimpleNamespace(provider="vtu", category=BillerCategory.DATA, name="MTN", product_name="1GB")
    assert run(router.providers_for(vtu_plan, {"airtime_provider": "monnify"})) == ["vtu"]


def test_a_down_supplier_goes_to_the_back_and_an_unmapped_network_never_uses_vtu(monkeypatch):
    async def fake_down(name): return name == "monnify"
    monkeypatch.setattr(router, "is_down", fake_down)
    assert run(router.providers_for(airtime_biller(), {"airtime_provider": "monnify", "provider_auto_failover": True})) == ["vtu", "monnify"]
    assert run(router.providers_for(airtime_biller(name="Spectranet"), {"airtime_provider": "monnify", "provider_auto_failover": True})) == ["monnify"]
    monkeypatch.setattr(settings, "GYK_API_KEY", "")
    assert run(router.providers_for(airtime_biller(), {"airtime_provider": "vtu", "provider_auto_failover": True})) == ["monnify"]   # not set up: never offered


# ── Pricing: cost + 6%, whole naira, per-plan override wins ───────────────
def vtu_plan(**over):
    base = dict(provider="vtu", is_active=True, category=BillerCategory.DATA, name="MTN", product_name="1GB", product_id="11", price_kobo=32000,
                requires_validation=False, markup_percent=Decimal("6"), commission_percent=Decimal("0"), customer_price_kobo=None, min_amount_kobo=None, max_amount_kobo=None)
    base.update(over)
    return SimpleNamespace(**base)


def test_vtu_plans_sell_at_cost_plus_six_percent_rounded_up_to_a_whole_naira():
    q = bp.quote(vtu_plan(), amount_kobo=None)
    assert q.vend_kobo == 32000 and q.charge_kobo == 34000 and q.profit_kobo == 2000        # 320 * 1.06 = 339.2 -> N340
    assert bp.quote(vtu_plan(markup_percent=Decimal("10")), amount_kobo=None).charge_kobo == 35200
    assert bp.quote(vtu_plan(customer_price_kobo=40050), amount_kobo=None).charge_kobo == 40050   # a hand-set price is used exactly


# ── Airtime to Cash maths ─────────────────────────────────────────────────
FEES = {"air_mtn_charges": "20", "air_airtel_charges": "25", "air_to_cash": "5"}


def test_supplier_credit_and_customer_payout():
    assert a2c.provider_credit_kobo(1000, "MTN", FEES) == 79500         # 1000 - 20% - N5 = N795
    assert a2c.provider_credit_kobo(1000, "Airtel", FEES) == 74500
    assert a2c.provider_credit_kobo(1000, "Glo", FEES) == 99500         # no percentage listed: only the fixed fee
    assert a2c.provider_credit_kobo(3, "MTN", FEES) == 0                # never negative
    payout, fee = a2c.split_payout(79500, 10)
    assert (payout, fee) == (71550, 7950) and payout + fee == 79500     # the two always add back to what the supplier credited
    assert a2c.split_payout(79501, 10) == (71550, 7951)                 # customer's share rounds DOWN, the remainder is ours


def test_the_sim_pin_never_appears_in_the_repr_of_the_request_body():
    from app.api.v1.routes.airtime_cash import SubmitBody
    assert "1234" not in repr(SubmitBody(simpin="1234", pin="0000"))


def test_a2c_submit_reads_the_suppliers_success_shapes():
    def handler(req):
        body = json.loads(req.content)
        assert body["action"] == "submit" and body["simpin"] == "4321" and body["sessionId"] == "S1"
        return httpx.Response(200, json={"status": "success", "code": 200, "info": {"success": 1}, "details": [{"status": "success", "reference": "A9"}], "wallet_balance": 1500})
    r = run(client(handler).a2c_submit(network="1", phone="0801", amount_naira=1000, simpin="4321", session_id="S1", amount_to_receive=795))
    assert r["vendStatus"] == "SUCCESS" and r["transactionReference"] == "A9" and r["walletBalance"] == 1500
    fail = run(client(lambda req: httpx.Response(200, json={"status": "error", "message": "Invalid SIM PIN"})).a2c_submit(
        network="1", phone="0801", amount_naira=1000, simpin="0000", session_id="S1", amount_to_receive=795))
    assert fail["vendStatus"] == "FAILED"


def test_otp_and_verify_return_the_suppliers_ids_and_refuse_bad_replies():
    h = lambda req: httpx.Response(200, json={"status": "success", "data": {"identifier": "ID7", "sessionId": "SS8"}})
    assert run(client(h).a2c_otp(network="1", phone="0801")) == "ID7"
    assert run(client(h).a2c_verify(identifier="ID7", otp="123456")) == "SS8"
    bad = lambda req: httpx.Response(200, json={"status": "error", "message": "nope"})
    with pytest.raises(gyk.VtuError):
        run(client(bad).a2c_verify(identifier="ID7", otp="000000"))


# ── Failover loop: the money-safety rules ─────────────────────────────────
def failover(monkeypatch, outcomes, attempts):
    """Run _vend_with_failover with scripted per-supplier outcomes; returns (result, error, request, calls)."""
    calls = []
    async def fake_once(name, *a, **k):
        calls.append(name)
        return outcomes[name]
    async def noop(*a, **k): return False
    monkeypatch.setattr(svc, "_vend_once", fake_once)
    monkeypatch.setattr(router, "note_failure", noop)
    monkeypatch.setattr(router, "note_success", noop)
    req = SimpleNamespace(id=uuid.uuid4(), provider=attempts[0], failed_over_from=None)
    res, err = run(svc._vend_with_failover(req, airtime_biller(), None, "0801", None, attempts))
    return res, err, req, calls


def test_a_definite_supplier_failure_moves_airtime_to_the_backup(monkeypatch):
    res, err, req, calls = failover(monkeypatch, {
        "monnify": ({}, gyk.VtuError("x", kind="provider", raw="insufficient wallet balance")),
        "vtu": ({"vendStatus": "SUCCESS"}, None)}, ["monnify", "vtu"])
    assert calls == ["monnify", "vtu"] and res["vendStatus"] == "SUCCESS" and err is None
    assert req.provider == "vtu" and req.failed_over_from == "monnify"            # recorded, so accounting credits the supplier that really served it


def test_an_ambiguous_outcome_is_never_retried_on_the_other_supplier(monkeypatch):
    res, err, req, calls = failover(monkeypatch, {
        "monnify": ({}, gyk.VtuError("x", ambiguous=True, raw="timeout after sending")),
        "vtu": ({"vendStatus": "SUCCESS"}, None)}, ["monnify", "vtu"])
    assert calls == ["monnify"] and err.ambiguous is True and req.provider == "monnify" and req.failed_over_from is None   # held, not double-vended


def test_a_bad_number_is_not_a_reason_to_switch_supplier(monkeypatch):
    res, err, req, calls = failover(monkeypatch, {
        "monnify": ({}, gyk.VtuError("x", kind="customer", raw="invalid phone number")),
        "vtu": ({"vendStatus": "SUCCESS"}, None)}, ["monnify", "vtu"])
    assert calls == ["monnify"] and err.kind == "customer"


def test_when_both_suppliers_fail_definitely_the_last_error_is_returned_for_a_clean_refund(monkeypatch):
    res, err, req, calls = failover(monkeypatch, {
        "monnify": ({}, gyk.VtuError("x", kind="provider", raw="service unavailable")),
        "vtu": ({}, gyk.VtuError("y", kind="provider", raw="insufficient balance"))}, ["monnify", "vtu"])
    assert calls == ["monnify", "vtu"] and err.raw == "insufficient balance" and req.provider == "vtu"


# ── What the live server actually does (found by running scripts/diagnose_gyk.py) ──
def test_a_refused_history_call_is_never_mistaken_for_nothing_found():
    """Their API answers a rejected key with HTTP 200 + {"status":"error","message":"Invalid user"}. That must NOT read as 'no purchase
    found', or a delivered purchase could be refunded after the grace period."""
    refused = client(lambda req: httpx.Response(200, json={"status": "error", "message": "Invalid user"}))
    assert run(refused.find_purchase(phone="08012345678", since=datetime.now(timezone.utc) - timedelta(minutes=5))) is None


def test_invalid_user_on_a_purchase_is_a_definite_provider_side_failure_not_a_held_one():
    r = run(client(lambda req: httpx.Response(200, json={"status": "error", "message": "Invalid user_key"})).buy_airtime(
        network="1", phone="0801", amount_naira=100, idempotency_key="k"))
    err = r["_error"]
    assert err.kind == "provider" and err.ambiguous is False          # our key is wrong: nothing was bought, safe to fail over / refund


def test_plan_rows_with_other_field_names_still_parse_and_the_price_column_can_be_chosen(monkeypatch):
    rows = [{"planid": 9, "network_id": "1", "plan": "1GB", "plan_validity": "30 days", "amount": 300, "smart_price": 280}]
    h = lambda req: httpx.Response(200, json={"status": "success", "total_rows": 1, "data": rows})
    assert run(client(h).get_all_plans())[0]["amount_naira"] == 300.0
    monkeypatch.setattr(settings, "GYK_PRICE_FIELD", "smart_price")
    p = run(client(h).get_all_plans())[0]
    assert p["amount_naira"] == 280.0 and p["variation_code"] == "9" and p["name"] == "1GB 30 days"


def test_wallet_balance_is_found_wherever_the_reply_nests_it():
    for body in ({"status": "success", "wallet_balance": 1250.5},
                 {"status": "success", "data": {"wallet_balance": "1250.50", "level": "SMART"}},
                 {"status": "success", "user": {"profile": {"wallet_balance": 1250.5}}}):
        assert run(client(lambda req, b=body: httpx.Response(200, json=b)).wallet_balance()) == 1250.5
    assert run(client(lambda req: httpx.Response(200, json={"status": "error", "message": "Invalid user"})).wallet_balance()) is None
