"""Regression tests for Web Push sending.

Background
----------
push_service passed settings.VAPID_PRIVATE_KEY_PEM (a PEM *string*) straight
to pywebpush.webpush(), which rejects it ("Could not deserialize key data").
The error was swallowed as a log warning, so no push was ever delivered even
with correctly configured keys. It also had no TTL/timeout, and a DB failure
inside it (migration 043 missing) silently rolled back the caller's writes.

No database or network: keys are generated locally, the push service is a
local HTTP server, the session is a fake.
"""
import asyncio
import base64
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.core.config import settings
from app.services import push_service

b64u = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")


def _vapid_pair():
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    pub = b64u(key.public_key().public_bytes(serialization.Encoding.X962,
                                             serialization.PublicFormat.UncompressedPoint))
    return pem, pub


@pytest.fixture
def push_server():
    received = []
    status = {"code": 201}

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            received.append({"headers": {k.lower(): v for k, v in self.headers.items()}, "body": self.rfile.read(n)})
            self.send_response(status["code"]); self.end_headers()
        def log_message(self, *a): pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield SimpleNamespace(url=f"http://127.0.0.1:{srv.server_port}/p", received=received, status=status)
    srv.shutdown()


def _device(url):
    priv = ec.generate_private_key(ec.SECP256R1())
    auth = os.urandom(16)
    return priv, auth, {"endpoint": url, "keys": {
        "p256dh": b64u(priv.public_key().public_bytes(serialization.Encoding.X962,
                                                      serialization.PublicFormat.UncompressedPoint)),
        "auth": b64u(auth)}}


@pytest.fixture
def keys(monkeypatch):
    pem, pub = _vapid_pair()
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY_PEM", pem)
    monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY_B64", pub)
    push_service._load_vapid.cache_clear()
    return pem, pub


def test_pem_string_is_accepted_and_delivered(keys, push_server):
    import http_ece
    priv, auth, info = _device(push_server.url)
    push_service._send_one(info, json.dumps({"title": "T", "body": "B"}))
    req = push_server.received[-1]
    assert json.loads(http_ece.decrypt(req["body"], private_key=priv, auth_secret=auth, version="aes128gcm")) == {"title": "T", "body": "B"}
    assert req["headers"]["ttl"] == str(push_service.PUSH_TTL_SECONDS)
    assert req["headers"]["urgency"] == "high"
    assert f"k={keys[1]}" in req["headers"]["authorization"]


@pytest.mark.parametrize("wrap", [
    lambda p: p,
    lambda p: p.replace("\n", "\\n"),                 # one-line env var with literal \n
    lambda p: '"' + p.replace("\n", "\\n") + '"',     # same, quoted
    lambda p: "  " + p + "\n\n",                      # stray whitespace
])
def test_env_var_formats(monkeypatch, push_server, wrap):
    pem, pub = _vapid_pair()
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY_PEM", wrap(pem))
    monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY_B64", pub)
    push_service._load_vapid.cache_clear()
    _, _, info = _device(push_server.url)
    push_service._send_one(info, "{}")
    assert len(push_server.received) == 1


def test_is_configured_needs_both_keys(monkeypatch):
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY_PEM", "x")
    monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY_B64", "")
    assert push_service.push_is_configured() is False
    monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY_B64", "y")
    assert push_service.push_is_configured() is True


class _Result:
    def __init__(self, rows): self._rows = rows
    def scalars(self): return self
    def all(self): return self._rows


class _Nested:
    def __init__(self, fail): self.fail = fail
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False


class FakeDB:
    def __init__(self, rows, fail_select=False):
        self.rows, self.fail_select, self.deleted, self.nested = rows, fail_select, False, 0
    def begin_nested(self):
        self.nested += 1
        return _Nested(False)
    async def execute(self, stmt):
        if self.fail_select:
            raise RuntimeError('relation "push_subscriptions" does not exist')
        if "DELETE" in str(stmt).upper():
            self.deleted = True
            return _Result([])
        return _Result(self.rows)


def _row(url):
    return SimpleNamespace(id=__import__("uuid").uuid4(), endpoint=url, p256dh_key=_device(url)[2]["keys"]["p256dh"],
                           auth_key=_device(url)[2]["keys"]["auth"])


def test_send_push_noop_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY_PEM", "")
    db = FakeDB([])
    assert asyncio.run(push_service.send_push(db, user_id=__import__("uuid").uuid4(), title="t", body="b")) == 0
    assert db.nested == 0


def test_send_push_delivers_and_counts(keys, push_server):
    db = FakeDB([_row(push_server.url), _row(push_server.url)])
    n = asyncio.run(push_service.send_push(db, user_id=__import__("uuid").uuid4(), title="t", body="b"))
    assert n == 2 and len(push_server.received) == 2 and not db.deleted


def test_dead_endpoint_is_pruned(keys, push_server):
    push_server.status["code"] = 410
    db = FakeDB([_row(push_server.url)])
    n = asyncio.run(push_service.send_push(db, user_id=__import__("uuid").uuid4(), title="t", body="b"))
    assert n == 0 and db.deleted


def test_server_error_is_not_pruned_and_never_raises(keys, push_server):
    push_server.status["code"] = 500
    db = FakeDB([_row(push_server.url)])
    n = asyncio.run(push_service.send_push(db, user_id=__import__("uuid").uuid4(), title="t", body="b"))
    assert n == 0 and not db.deleted


def test_db_failure_is_contained_in_a_savepoint(keys):
    db = FakeDB([], fail_select=True)
    n = asyncio.run(push_service.send_push(db, user_id=__import__("uuid").uuid4(), title="t", body="b"))
    assert n == 0
    assert db.nested == 1   # the failing query ran inside begin_nested(), so Postgres only rolls back the savepoint
