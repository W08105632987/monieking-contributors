"""
Monnify bills + webhook flow — no database or network needed.

Covers: endpoint paths, error classification (ambiguous vs definite),
paging, vend-status parsing, and the money-safety rules of pay_bill /
resolve_pending_bill / the payment webhook.
"""
import asyncio
import os
import uuid
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")

from app.integrations import monnify_bills as mb                      # noqa: E402
from app.integrations.monnify_bills import MonnifyBillsError, MonnifyBillsProvider, vend_outcome   # noqa: E402
from app.models.bill_payment import BillPaymentStatus, BillerCategory  # noqa: E402
from app.services import bill_payment_service as svc                  # noqa: E402


def run(coro):
    return asyncio.run(coro)


# ── Provider: paths ───────────────────────────────────────────────

class _Base:
    _access_token = "t"

    async def _headers(self):
        return {"Authorization": "Bearer t"}


def _provider(monkeypatch):
    monkeypatch.setattr(mb, "get_payment_provider", lambda: _Base())
    return MonnifyBillsProvider()


def test_every_endpoint_uses_the_vas_prefix(monkeypatch):
    p = _provider(monkeypatch)
    calls = []

    async def fake_request(method, path, **kw):
        calls.append((method, path))
        return []
    p._request = fake_request

    async def go():
        await p.get_biller_categories()
        await p.get_billers("ELECTRICITY")
        await p.get_biller_products("IKEDC")
        await p.validate_customer(product_code="P", customer_id="1")
        await p.vend_bill(product_code="P", customer_id="1", amount_kobo=500_00, vend_reference="r")
        await p.requery_bill("a|b")
    run(go())

    assert calls, "nothing was called"
    for _, path in calls:
        assert path.startswith("/api/v1/vas/bills-payment/"), path
    assert any("/billers?categoryCode=ELECTRICITY" in path for _, path in calls)
    assert any("/biller-products?billerCode=IKEDC" in path for _, path in calls)
    assert any("/validate-customer" in path for _, path in calls)
    assert any(path.endswith("/vend") for _, path in calls)
    assert any("requery?reference=a%7Cb" in path for _, path in calls)


def test_vend_payload_shape(monkeypatch):
    p = _provider(monkeypatch)
    sent = {}

    async def fake_request(method, path, **kw):
        sent.update(kw["json"])
        return {}
    p._request = fake_request
    run(p.vend_bill(product_code="11", customer_id="0801", amount_kobo=123_456, vend_reference="ref-1"))
    # both spellings: live Monnify rejected vendAmount alone with "Amount must be greater than zero"
    assert sent == {"productCode": "11", "customerId": "0801", "amount": 1234.56, "reference": "ref-1",
                    "vendAmount": 1234.56, "vendReference": "ref-1"}
    run(p.vend_bill(product_code="11", customer_id="0801", amount_kobo=100, vend_reference="r", validation_reference="V"))
    assert sent["validationReference"] == "V"


# ── Provider: error classification ────────────────────────────────

def _with_transport(monkeypatch, handler):
    real = httpx.AsyncClient

    def factory(*a, **kw):
        kw.pop("timeout", None)
        return real(transport=httpx.MockTransport(handler), **kw)
    monkeypatch.setattr(mb.httpx, "AsyncClient", factory)


def _err(monkeypatch, handler, method="POST"):
    p = _provider(monkeypatch)
    _with_transport(monkeypatch, handler)
    with pytest.raises(MonnifyBillsError) as ei:
        run(p._request(method, "/x", json={}))
    return ei.value


def test_404_is_a_definite_failure_with_the_real_message(monkeypatch):
    e = _err(monkeypatch, lambda r: httpx.Response(404, json={"error": "Not Found", "status": 404}))
    assert e.message == "Not Found" and not e.ambiguous and not e.retriable


def test_4xx_rejection_is_definite_not_ambiguous(monkeypatch):
    e = _err(monkeypatch, lambda r: httpx.Response(400, json={"requestSuccessful": False, "responseMessage": "Invalid meter"}))
    assert e.message == "Invalid meter" and not e.ambiguous


def test_5xx_is_ambiguous_and_retriable(monkeypatch):
    e = _err(monkeypatch, lambda r: httpx.Response(503, json={"responseMessage": "down"}))
    assert e.ambiguous and e.retriable


def test_non_json_5xx_is_ambiguous(monkeypatch):
    e = _err(monkeypatch, lambda r: httpx.Response(502, text="<html>bad gateway</html>"))
    assert e.ambiguous and "502" in e.message


def test_read_timeout_is_ambiguous(monkeypatch):
    def boom(request):
        raise httpx.ReadTimeout("slow", request=request)
    e = _err(monkeypatch, boom)
    assert e.ambiguous and e.retriable


def test_connect_failure_is_definitely_not_processed(monkeypatch):
    def boom(request):
        raise httpx.ConnectError("no route", request=request)
    e = _err(monkeypatch, boom)
    assert e.retriable and not e.ambiguous


def test_401_refreshes_the_token_once_then_succeeds(monkeypatch):
    base = _Base()
    monkeypatch.setattr(mb, "get_payment_provider", lambda: base)
    p = MonnifyBillsProvider()
    seen = []

    def handler(request):
        seen.append(1)
        if len(seen) == 1:
            return httpx.Response(401, json={"error": "expired"})
        return httpx.Response(200, json={"requestSuccessful": True, "responseBody": {"ok": True}})
    _with_transport(monkeypatch, handler)
    assert run(p._request("GET", "/x")) == {"ok": True}
    assert len(seen) == 2 and base._access_token is None


def test_auth_failure_becomes_a_bills_error_not_an_http_exception(monkeypatch):
    class BadAuth(_Base):
        async def _headers(self):
            raise HTTPException(status_code=502, detail="Payment provider rejected our credentials.")
    monkeypatch.setattr(mb, "get_payment_provider", lambda: BadAuth())
    p = MonnifyBillsProvider()
    with pytest.raises(MonnifyBillsError) as ei:
        run(p._request("GET", "/x"))
    assert "credentials" in ei.value.message


# ── Provider: paging ──────────────────────────────────────────────

def test_paging_follows_pages_until_nothing_new(monkeypatch):
    p = _provider(monkeypatch)
    pages = {
        0: {"content": [{"billerCode": "A"}, {"billerCode": "B"}]},
        1: {"content": [{"billerCode": "C"}]},
        2: {"content": []},
    }

    async def fake_request(method, path, **kw):
        page = int(path.split("page=")[1].split("&")[0])
        return pages[page]
    p._request = fake_request
    rows = run(p._list_all("/p?categoryCode=X", ("billerCode",)))
    assert [r["billerCode"] for r in rows] == ["A", "B", "C"]


def test_paging_stops_when_server_ignores_page_parameter(monkeypatch):
    p = _provider(monkeypatch)
    n = []

    async def fake_request(method, path, **kw):
        n.append(path)
        return [{"billerCode": "A"}, {"billerCode": "B"}]   # same list every time
    p._request = fake_request
    rows = run(p._list_all("/p", ("billerCode",)))
    assert len(rows) == 2 and len(n) == 2


def test_paging_falls_back_to_a_plain_call_if_paging_params_are_rejected(monkeypatch):
    p = _provider(monkeypatch)

    async def fake_request(method, path, **kw):
        if "page=" in path:
            raise MonnifyBillsError("Bad request", retriable=False)
        return [{"billerCode": "A"}]
    p._request = fake_request
    assert run(p._list_all("/p", ("billerCode",))) == [{"billerCode": "A"}]


# ── Vend status + helpers ─────────────────────────────────────────

@pytest.mark.parametrize("body,expected", [
    ({"vendStatus": "SUCCESS"}, "SUCCESS"),
    ({"vendStatus": "success"}, "SUCCESS"),
    ({"vendStatus": "FAILED"}, "FAILED"),
    ({"vendStatus": "IN_PROGRESS"}, "PENDING"),
    ({"vendStatus": "IN-PROGRESS"}, "PENDING"),
    ({"vendStatus": "SOMETHING_NEW"}, "PENDING"),
    ({}, "PENDING"),
    ({"transactionReference": "TX1"}, "PENDING"),     # no status is never treated as success
    (None, "PENDING"),
])
def test_vend_outcome(body, expected):
    assert vend_outcome(body) == expected


def test_price_to_kobo_rounds_and_rejects_zero():
    assert svc._price_to_kobo("1234.56") == 123456     # int(float*100) would give 123455
    assert svc._price_to_kobo(100) == 10000
    assert svc._price_to_kobo("0.00") is None
    assert svc._price_to_kobo(0) is None
    assert svc._price_to_kobo(None) is None
    assert svc._price_to_kobo("abc") is None
    assert svc._price_to_kobo(-5) is None


def test_read_vend_instruction():
    assert svc._read_vend_instruction({"vendInstruction": {"requireValidationRef": True}, "validationReference": "V1"}) == (True, "V1")
    assert svc._read_vend_instruction({"vendInstruction": {"requireValidationRef": False}, "validationReference": "V1"}) == (False, "V1")
    assert svc._read_vend_instruction({"vendInstruction": {"requireValidationRef": True, "validationReference": "V2"}}) == (True, "V2")
    assert svc._read_vend_instruction({}) == (False, None)


# ── pay_bill / resolve_pending_bill (fake DB, no Postgres) ────────

class FakeDB:
    def __init__(self, biller):
        self.biller = biller
        self.added = []
        self.commits = 0
        self.rollbacks = 0
        self.existing_refs = set()      # wallet_transactions references that "already exist"
        self.locked_request = None      # what select(...).with_for_update() returns

    async def get(self, model, pk):
        return self.biller

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        for o in self.added:
            if getattr(o, "id", None) is None:
                o.id = uuid.uuid4()
            if getattr(o, "created_at", None) is None and hasattr(o, "created_at"):
                pass

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, obj):
        # A real refresh reloads the last COMMITTED row; the only thing
        # committed before settlement is the PENDING request.
        obj.status = BillPaymentStatus.PENDING
        obj.completed_at = None
        obj.token = None

    async def execute(self, stmt):
        text = str(stmt)
        if "wallet_transactions" in text:
            ref_hit = bool(self.existing_refs)
            return SimpleNamespace(first=lambda: (1,) if ref_hit else None)
        return SimpleNamespace(scalar_one_or_none=lambda: self.locked_request)


def _biller(category=BillerCategory.AIRTIME, requires_validation=False, price_kobo=None):
    return SimpleNamespace(
        id=uuid.uuid4(), is_active=True, category=category, name="MTN Airtime", product_name="MTN VTU",
        product_id="11", price_kobo=price_kobo, requires_validation=requires_validation,
    )


class Env:
    """Wires fakes into bill_payment_service and records what happened."""
    def __init__(self, monkeypatch, *, biller=None, vend=None, validate=None, requery=None,
                 debit_error=None, balance=10_000_00):
        self.biller = biller or _biller()
        self.db = FakeDB(self.biller)
        self.debits, self.credits, self.vends, self.audit = [], [], [], []
        self.wallet = SimpleNamespace(id=uuid.uuid4(), balance_kobo=balance)

        env = self

        class FakeProvider:
            async def validate_customer(self, **kw):
                r = validate
                if isinstance(r, Exception):
                    raise r
                return r if r is not None else {}

            async def vend_bill(self, **kw):
                env.vends.append(kw)
                if isinstance(vend, Exception):
                    raise vend
                return vend if vend is not None else {"vendStatus": "SUCCESS", "transactionReference": "TX1"}

            async def requery_bill(self, ref):
                if isinstance(requery, Exception):
                    raise requery
                return requery

        async def no_rules(*a, **k):
            return None

        async def get_wallet(db, owner_id):
            return env.wallet

        async def debit(db, **kw):
            if debit_error:
                raise debit_error
            env.debits.append(kw)

        async def credit(db, **kw):
            env.credits.append(kw)

        async def log(db, **kw):
            env.audit.append(kw["action"])

        monkeypatch.setattr(svc, "get_bills_provider", lambda: FakeProvider())
        monkeypatch.setattr(svc, "_enforce_director_rules", no_rules)
        monkeypatch.setattr(svc, "get_or_create_wallet", get_wallet)
        monkeypatch.setattr(svc, "debit_wallet", debit)
        monkeypatch.setattr(svc, "credit_wallet", credit)
        monkeypatch.setattr(svc, "log_action", log)

    def pay(self, **over):
        args = dict(customer_id=uuid.uuid4(), biller_id=self.biller.id, customer_reference="08031234567",
                    amount_kobo=500_00, initiated_by="customer")
        args.update(over)
        return run(svc.pay_bill(self.db, **args))


def test_success_completes_and_debits_once(monkeypatch):
    env = Env(monkeypatch, vend={"vendStatus": "SUCCESS", "transactionReference": "TX9", "token": "1234-5678"})
    req = env.pay()
    assert req.status == BillPaymentStatus.COMPLETED
    assert req.monnify_transaction_reference == "TX9" and req.token == "1234-5678"
    assert len(env.debits) == 1 and env.debits[0]["amount_kobo"] == 500_00
    assert env.credits == []
    assert env.vends[0]["vend_reference"] == str(req.id)
    assert env.db.commits >= 2           # debit checkpoint, then settlement


def test_the_debit_is_committed_before_monnify_is_called(monkeypatch):
    env = Env(monkeypatch)
    order = []
    orig_commit = env.db.commit

    async def commit():
        order.append("commit")
        await orig_commit()
    env.db.commit = commit
    orig_vend = env.vends

    class P:
        async def validate_customer(self, **kw):
            return {}

        async def vend_bill(self, **kw):
            order.append("vend")
            return {"vendStatus": "SUCCESS"}
    monkeypatch.setattr(svc, "get_bills_provider", lambda: P())
    env.pay()
    assert order.index("commit") < order.index("vend")


def test_definite_failure_refunds_and_marks_failed(monkeypatch):
    env = Env(monkeypatch, vend=MonnifyBillsError("Insufficient float", ambiguous=False))
    req = env.pay()
    assert req.status == BillPaymentStatus.FAILED and "float" in req.failure_reason
    assert len(env.debits) == 1 and len(env.credits) == 1
    assert env.credits[0]["amount_kobo"] == 500_00 and env.credits[0]["category"].value == "reversal"
    assert env.credits[0]["reference"].startswith("BILLREV-")


def test_failed_vend_status_refunds(monkeypatch):
    env = Env(monkeypatch, vend={"vendStatus": "FAILED", "responseMessage": "Network error"})
    req = env.pay()
    assert req.status == BillPaymentStatus.FAILED and len(env.credits) == 1


def test_timeout_keeps_money_held_and_stays_pending(monkeypatch):
    env = Env(monkeypatch, vend=MonnifyBillsError("timed out", retriable=True, ambiguous=True))
    req = env.pay()
    assert req.status == BillPaymentStatus.PENDING
    assert len(env.debits) == 1 and env.credits == []


@pytest.mark.parametrize("body", [{"vendStatus": "IN_PROGRESS"}, {}, {"transactionReference": "TX1"}, {"vendStatus": "WEIRD"}])
def test_in_progress_or_unknown_never_completes_or_refunds(monkeypatch, body):
    env = Env(monkeypatch, vend=body)
    # {} must reach the provider as a real (empty) answer, not "use the default success"
    env_vend = body
    class P:
        async def validate_customer(self, **kw): return {}
        async def vend_bill(self, **kw): return env_vend
    monkeypatch.setattr(svc, "get_bills_provider", lambda: P())
    req = env.pay()
    assert req.status == BillPaymentStatus.PENDING
    assert env.credits == []


def test_insufficient_balance_at_debit_stops_before_monnify(monkeypatch):
    env = Env(monkeypatch, debit_error=HTTPException(status_code=400, detail="Insufficient wallet balance."))
    with pytest.raises(ValueError, match="Insufficient"):
        env.pay()
    assert env.vends == []


def test_precheck_blocks_when_balance_too_low(monkeypatch):
    env = Env(monkeypatch, balance=100)
    with pytest.raises(ValueError, match="Insufficient"):
        env.pay()
    assert env.debits == [] and env.vends == []


def test_settlement_crash_leaves_request_pending_for_the_resolver(monkeypatch):
    env = Env(monkeypatch, vend={"vendStatus": "SUCCESS"})

    async def broken_log(db, **kw):
        raise RuntimeError("db hiccup")
    monkeypatch.setattr(svc, "log_action", broken_log)
    req = env.pay()
    assert req.status == BillPaymentStatus.PENDING     # reverted, not lost
    assert env.db.rollbacks == 1 and len(env.debits) == 1 and env.credits == []


def test_fixed_price_overrides_client_amount(monkeypatch):
    env = Env(monkeypatch, biller=_biller(price_kobo=2_500_00))
    req = env.pay(amount_kobo=100)
    assert req.amount_kobo == 2_500_00 and env.debits[0]["amount_kobo"] == 2_500_00


# validation

def test_required_validation_failure_blocks_payment_before_any_debit(monkeypatch):
    env = Env(monkeypatch, biller=_biller(BillerCategory.ELECTRICITY, requires_validation=True),
              validate=MonnifyBillsError("Invalid meter number"))
    with pytest.raises(ValueError, match="Invalid meter"):
        env.pay()
    assert env.debits == [] and env.vends == []


def test_validation_reference_sent_only_when_monnify_requires_it(monkeypatch):
    env = Env(monkeypatch, biller=_biller(BillerCategory.ELECTRICITY, requires_validation=True),
              validate={"vendInstruction": {"requireValidationRef": True}, "validationReference": "VREF", "customerName": "ADA O"})
    req = env.pay(validation_reference="client-sent-junk")
    assert env.vends[0]["validation_reference"] == "VREF"       # server's, not the client's
    assert req.validated_account_name == "ADA O"

    env2 = Env(monkeypatch, biller=_biller(BillerCategory.ELECTRICITY, requires_validation=True),
               validate={"vendInstruction": {"requireValidationRef": False}, "validationReference": "VREF"})
    env2.pay()
    assert env2.vends[0]["validation_reference"] is None


def test_airtime_validation_is_best_effort(monkeypatch):
    env = Env(monkeypatch, validate=MonnifyBillsError("MSISDN lookup unavailable"))
    req = env.pay()
    assert req.status == BillPaymentStatus.COMPLETED


# resolver

def _pending_request(db, tx_ref=None):
    from app.models.bill_payment import BillPaymentRequest
    r = BillPaymentRequest(
        id=uuid.uuid4(), customer_id=uuid.uuid4(), initiated_by="customer", biller_id=uuid.uuid4(),
        customer_reference="08••••••67", amount_kobo=500_00, status=BillPaymentStatus.PENDING,
    )
    r.monnify_transaction_reference = tx_ref
    db.locked_request = r
    return r


def test_resolver_completes_on_confirmed_success(monkeypatch):
    env = Env(monkeypatch, requery={"vendStatus": "SUCCESS", "transactionReference": "TXQ"})
    r = _pending_request(env.db)
    out = run(svc.resolve_pending_bill(env.db, r.id))
    assert out.status == BillPaymentStatus.COMPLETED and out.monnify_transaction_reference == "TXQ"
    assert env.credits == []


def test_resolver_refunds_once_on_confirmed_failure(monkeypatch):
    env = Env(monkeypatch, requery={"vendStatus": "FAILED"})
    r = _pending_request(env.db)
    out = run(svc.resolve_pending_bill(env.db, r.id))
    assert out.status == BillPaymentStatus.FAILED and len(env.credits) == 1

    # a second resolver run (or a double click) must not pay twice
    env.db.existing_refs.add("anything")
    r2 = _pending_request(env.db)
    run(svc.resolve_pending_bill(env.db, r2.id))
    assert len(env.credits) == 1


def test_resolver_leaves_it_alone_when_monnify_is_unreachable_or_in_progress(monkeypatch):
    env = Env(monkeypatch, requery=MonnifyBillsError("down", retriable=True, ambiguous=True))
    r = _pending_request(env.db)
    assert run(svc.resolve_pending_bill(env.db, r.id)).status == BillPaymentStatus.PENDING
    assert env.credits == []

    env2 = Env(monkeypatch, requery={"vendStatus": "IN_PROGRESS"})
    r2 = _pending_request(env2.db)
    assert run(svc.resolve_pending_bill(env2.db, r2.id)).status == BillPaymentStatus.PENDING
    assert env2.credits == []


def test_resolver_ignores_requests_that_are_not_pending(monkeypatch):
    env = Env(monkeypatch, requery={"vendStatus": "FAILED"})
    r = _pending_request(env.db)
    r.status = BillPaymentStatus.COMPLETED
    run(svc.resolve_pending_bill(env.db, r.id))
    assert env.credits == []


# ── Webhook ───────────────────────────────────────────────────────

from app.api.v1.routes import webhooks as wh   # noqa: E402


class _Nested:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False     # propagate


class WebhookDB:
    def __init__(self, *, existing=False, wallet=None, integrity_on_insert=False):
        self.existing, self.wallet, self.integrity_on_insert = existing, wallet, integrity_on_insert
        self.added = []

    def begin_nested(self):
        return _Nested(self)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        if self.integrity_on_insert and self.added:
            raise IntegrityError("insert", {}, Exception("duplicate key"))

    async def execute(self, stmt):
        text = str(stmt)
        if "payment_webhooks" in text:
            return SimpleNamespace(scalar_one_or_none=lambda: object() if self.existing else None)
        return SimpleNamespace(scalar_one_or_none=lambda: self.wallet)


class FakeRequest:
    def __init__(self, payload, signature="sig"):
        self._payload = payload
        self.headers = {"monnify-signature": signature} if signature else {}

    async def body(self):
        return b"{}"

    async def json(self):
        return self._payload


def _payload(event_type="SUCCESSFUL_TRANSACTION", ref="MNFY|1", status="PAID", amount=5000, account="1234567890"):
    return {"eventType": event_type, "eventData": {
        "transactionReference": ref, "paymentStatus": status, "amountPaid": amount,
        "destinationAccountInformation": {"accountNumber": account},
    }}


def _hook(monkeypatch, *, db, payload, signature="sig", credit=None, sandbox=True):
    state = SimpleNamespace(credits=[], notes=[])

    class Prov:
        is_sandbox = sandbox

        def verify_webhook_signature(self, body, sig):
            return True

        def parse_webhook_event(self, p):
            from app.integrations.monnify import MonnifyProvider
            return MonnifyProvider.parse_webhook_event(self, p)

    async def fake_credit(db_, **kw):
        if credit:
            raise credit
        state.credits.append(kw)

    async def fake_notify(db_, **kw):
        state.notes.append(kw)

    monkeypatch.setattr(wh, "get_payment_provider", lambda: Prov())
    monkeypatch.setattr(wh, "credit_wallet", fake_credit)
    monkeypatch.setattr(wh, "send_notification", fake_notify)
    out = run(wh.monnify_payment_webhook(FakeRequest(payload, signature), db))
    return out, state


WALLET = SimpleNamespace(id=uuid.uuid4(), owner_id=uuid.uuid4())


def test_successful_transaction_credits_the_wallet_once(monkeypatch):
    db = WebhookDB(wallet=WALLET)
    out, st = _hook(monkeypatch, db=db, payload=_payload())
    assert out["message"] == "Payment processed successfully"
    assert len(st.credits) == 1 and st.credits[0]["amount_kobo"] == 500_000
    assert db.added[0].processed is True and len(st.notes) == 1


def test_disbursement_and_other_events_never_credit(monkeypatch):
    for event in ("SUCCESSFUL_DISBURSEMENT", "FAILED_DISBURSEMENT", "REVERSED_DISBURSEMENT", "SUCCESSFUL_REFUND", "SETTLEMENT"):
        db = WebhookDB(wallet=WALLET)
        out, st = _hook(monkeypatch, db=db, payload=_payload(event_type=event, status="SUCCESS"))
        assert st.credits == [] and db.added == [], event
        assert "not a payment completion" in out["message"]


def test_unpaid_status_is_ignored(monkeypatch):
    db = WebhookDB(wallet=WALLET)
    out, st = _hook(monkeypatch, db=db, payload=_payload(status="PENDING"))
    assert st.credits == [] and db.added == []


def test_missing_reference_does_not_poison_idempotency(monkeypatch):
    db = WebhookDB(wallet=WALLET)
    out, st = _hook(monkeypatch, db=db, payload=_payload(ref=""))
    assert st.credits == [] and db.added == []
    assert "manual review" in out["message"]


def test_zero_amount_is_not_credited(monkeypatch):
    db = WebhookDB(wallet=WALLET)
    out, st = _hook(monkeypatch, db=db, payload=_payload(amount=0))
    assert st.credits == [] and db.added == []


def test_duplicate_delivery_is_ignored_both_ways(monkeypatch):
    out, st = _hook(monkeypatch, db=WebhookDB(existing=True, wallet=WALLET), payload=_payload())
    assert out["message"] == "Already processed" and st.credits == []
    # two deliveries racing past the select: the unique constraint catches the second
    out, st = _hook(monkeypatch, db=WebhookDB(wallet=WALLET, integrity_on_insert=True), payload=_payload())
    assert out["message"] == "Already processed" and st.credits == []


def test_unknown_account_is_recorded_for_review(monkeypatch):
    db = WebhookDB(wallet=None)
    out, st = _hook(monkeypatch, db=db, payload=_payload())
    assert st.credits == [] and "No wallet found" in db.added[0].processing_error


def test_frozen_wallet_is_recorded_and_acknowledged_not_retried_forever(monkeypatch):
    db = WebhookDB(wallet=WALLET)
    out, st = _hook(monkeypatch, db=db, payload=_payload(), credit=HTTPException(status_code=403, detail="Wallet is frozen"))
    assert "not credited" in out["message"].lower()
    assert db.added[0].processed is False and "frozen" in db.added[0].processing_error


def test_unexpected_error_returns_500_so_monnify_retries(monkeypatch):
    db = WebhookDB(wallet=WALLET)
    with pytest.raises(HTTPException) as ei:
        _hook(monkeypatch, db=db, payload=_payload(), credit=RuntimeError("db down"))
    assert ei.value.status_code == 500


def test_unsigned_webhook_rejected_in_production(monkeypatch):
    db = WebhookDB(wallet=WALLET)
    with pytest.raises(HTTPException) as ei:
        _hook(monkeypatch, db=db, payload=_payload(), signature="", sandbox=False)
    assert ei.value.status_code == 401
