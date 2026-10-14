"""Pure-logic tests for the Techhub verification feature (no network, no DB)."""
import base64
import io
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

# The sandbox that authored this may lack runtime deps; stub only if missing.
for _mod, _attrs in (("httpx", {"Timeout": lambda **k: None, "AsyncClient": object,
                                "TimeoutException": type("TimeoutException", (Exception,), {}),
                                "HTTPError": type("HTTPError", (Exception,), {})}),):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = types.SimpleNamespace(**_attrs)
try:
    import app.core.config  # noqa: F401
except Exception:
    _cfg = types.ModuleType("app.core.config")
    _cfg.settings = types.SimpleNamespace(TECHHUB_API_KEY="", TECHHUB_BASE_URL="", VERIFICATION_ENCRYPTION_KEY="")
    sys.modules["app.core.config"] = _cfg

from app.integrations import techhub as T  # noqa: E402
from app.verification import breaker as B  # noqa: E402
from app.verification import constants as C  # noqa: E402
from app.verification import crypto, normalize as N, settings as S  # noqa: E402
from app.verification.photo import extract_portrait  # noqa: E402
from app.verification.sheet_pdf import build_sheet_pdf  # noqa: E402

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def _pdf_b64(payload=b"%PDF-1.4 fake"):
    return base64.b64encode(payload).decode()


GOOD = {"status": "success", "response_code": "00", "message": "ok",
        "user_data": {"nin": "12345678901", "first_name": "JOHN", "last_name": "DOE"}, "pdf_base64": _pdf_b64()}


# ── Techhub response mapping ──────────────────────────────────────────────
def test_success_returns_data_and_pdf():
    r = T.interpret(200, GOOD)
    assert r.user_data["first_name"] == "JOHN" and r.pdf.startswith(b"%PDF")


def test_success_without_pdf_is_not_a_delivered_product():
    with pytest.raises(T.TechhubUnavailable):
        T.interpret(200, {**GOOD, "pdf_base64": ""})
    with pytest.raises(T.TechhubUnavailable):
        T.interpret(200, {**GOOD, "pdf_base64": _pdf_b64(b"not a pdf")})


def test_success_without_user_data_is_unavailable():
    with pytest.raises(T.TechhubUnavailable):
        T.interpret(200, {**GOOD, "user_data": {}})


def test_not_found_code_02():
    with pytest.raises(T.TechhubNotFound):
        T.interpret(400, {"status": "error", "response_code": "02", "message": "Record not found"})


def test_invalid_input_code_01_does_not_count_as_failure():
    with pytest.raises(T.TechhubInvalidInput) as e:
        T.interpret(400, {"status": "error", "response_code": "01", "error_code": "INVALID_NIN", "message": "Invalid NIN"})
    assert e.value.counts_as_failure is False


def test_balance_400_is_our_outage_not_customer_error():
    with pytest.raises(T.TechhubUnavailable) as e:
        T.interpret(400, {"status": "error", "message": "Insufficient balance"})
    assert e.value.reason == "provider_balance" and e.value.counts_as_failure


def test_unclassified_400_is_unavailable():
    with pytest.raises(T.TechhubUnavailable):
        T.interpret(400, {"status": "error", "message": "something odd"})


@pytest.mark.parametrize("status,exc", [(429, T.TechhubBusy), (401, T.TechhubAuthError), (403, T.TechhubUnavailable),
                                        (500, T.TechhubUnavailable), (503, T.TechhubUnavailable)])
def test_http_statuses(status, exc):
    with pytest.raises(exc):
        T.interpret(status, {})


def test_rate_limit_does_not_trip_breaker():
    assert T.TechhubBusy().counts_as_failure is False


def test_non_json_body_is_unavailable():
    with pytest.raises(T.TechhubUnavailable):
        T.interpret(200, None)


def test_customer_messages_never_mention_provider():
    for e in (T.TechhubUnavailable("ip_blocked"), T.TechhubAuthError("auth"), T.TechhubBusy(), T.TechhubNotFound()):
        assert "techhub" not in e.user_message.lower()


# ── input normalization ───────────────────────────────────────────────────
def test_nin_bvn_digits():
    assert N.normalize_inputs("nin", {"nin": "123 4567 8901"}) == {"nin": "12345678901"}
    assert N.normalize_inputs("bvn", {"bvn": "12345678901"}) == {"bvn": "12345678901"}
    for bad in ("1234567890", "123456789012", "abcdefghijk", ""):
        with pytest.raises(N.InputError):
            N.normalize_inputs("nin", {"nin": bad})


@pytest.mark.parametrize("raw", ["08012345678", "+2348012345678", "2348012345678", "8012345678", "0801 234 5678"])
def test_phone_forms(raw):
    assert N.normalize_inputs("phone", {"phone": raw}) == {"phone": "08012345678"}


def test_phone_rejects_garbage():
    for bad in ("12345", "0801234567a", "18012345678"):
        with pytest.raises(N.InputError):
            N.normalize_inputs("phone", {"phone": bad})


def test_phone_method_ignores_other_fields():
    assert N.normalize_inputs("phone", {"phone": "08012345678", "nin": "99999999999", "dob": "x"}) == {"phone": "08012345678"}


def test_demographic_formats_dob_for_techhub():
    out = N.normalize_inputs("demographic", {"firstname": "john", "lastname": "o'neil", "dob": "1985-05-15", "gender": "male"})
    assert out == {"firstname": "JOHN", "lastname": "O'NEIL", "dob": "15-05-1985", "gender": "MALE"}


def test_demographic_gender_optional_and_checked():
    out = N.normalize_inputs("demographic", {"firstname": "A", "lastname": "B", "dob": "15-05-1985"})
    assert "gender" not in out
    with pytest.raises(N.InputError):
        N.normalize_inputs("demographic", {"firstname": "A", "lastname": "B", "dob": "15-05-1985", "gender": "x"})


def test_dob_rejects_future_and_garbage():
    for bad in ("2999-01-01", "31-02-1990", "hello", "", "1800-01-01"):
        with pytest.raises(N.InputError):
            N.normalize_dob(bad)


def test_names_reject_digits_and_markup():
    for bad in ("J0hn", "<b>x</b>", "", "x" * 80):
        with pytest.raises(N.InputError):
            N.normalize_inputs("demographic", {"firstname": bad, "lastname": "Doe", "dob": "1985-05-15"})


def test_unknown_method():
    with pytest.raises(N.InputError):
        N.normalize_inputs("faceid", {})


def test_masks_hide_the_middle():
    assert N.mask_id("12345678901") == "123•••••901"
    assert "4567" not in N.mask_id("12345678901")
    assert N.mask_name("John Doe") == "J••• D••"


# ── endpoint table ────────────────────────────────────────────────────────
def test_every_offered_tier_has_an_endpoint():
    for tier in C.NIN_TIERS:
        assert ("nin", tier) in C.ENDPOINTS and ("phone", tier) in C.ENDPOINTS
    for tier in C.BVN_TIERS:
        assert ("bvn", tier) in C.ENDPOINTS
    assert ("demographic", C.DEMOGRAPHIC_TIER) in C.ENDPOINTS
    assert all(v.endswith(".php") for v in C.ENDPOINTS.values())


def test_no_vnin_endpoint():
    assert not any("vnin" in v.lower() for v in C.ENDPOINTS.values())


# ── settings ──────────────────────────────────────────────────────────────
def test_defaults_are_off_and_unpriced():
    s = S.parse({})
    assert s.enabled is False and s.retention_hours == 24 and not s.can_enable()
    assert all(s.fee_for(m) == 0 for m in C.METHODS)
    assert s.slip_price("nin", "regular") == 0


def test_cannot_enable_without_all_fees():
    cur = S.parse({})
    with pytest.raises(S.SettingsError):
        S.validate_update(cur, {"enabled": True})
    with pytest.raises(S.SettingsError):
        S.validate_update(cur, {"enabled": True, "fees": {"nin": 100, "phone": 100, "demographic": 100}})


def test_can_enable_in_one_patch_with_all_fees():
    cur = S.parse({})
    out = S.validate_update(cur, {"enabled": True, "fees": {"nin": 100, "phone": 100, "demographic": 100, "bvn": 100}})
    assert out[C.K_ENABLED] == "true" and out[C.K_FEE + "bvn"] == "100"


def test_cannot_clear_a_fee_while_on():
    raw = {C.K_ENABLED: "true", **{C.K_FEE + m: "100" for m in C.METHODS}}
    cur = S.parse(raw)
    assert cur.enabled and cur.can_enable()
    with pytest.raises(S.SettingsError):
        S.validate_update(cur, {"fees": {"bvn": 0}})
    assert S.validate_update(cur, {"enabled": False, "fees": {"bvn": 0}})[C.K_ENABLED] == "false"


def test_validation_rules():
    cur = S.parse({})
    for patch in ({"retention_hours": 0}, {"retention_hours": 500}, {"retention_hours": True}, {"nin_auth_url": "http://x"},
                  {"lookup_tier": {"bvn": "regular"}}, {"lookup_tier": {"nin": "vnin"}}, {"fees": {"vnin": 5}},
                  {"fees": {"nin": -1}}, {"slips": {"bvn.regular": 5}}, {"slips": {"nin.premium": "5"}}, {"bogus": 1},
                  {"enabled": "yes"}):
        with pytest.raises(S.SettingsError):
            S.validate_update(cur, patch)
    ok = S.validate_update(cur, {"retention_hours": 48, "slips": {"nin.premium": 50000}, "lookup_tier": {"nin": "standard"},
                                 "nin_auth_url": "https://example.org/auth"})
    assert ok[C.K_RETENTION] == "48" and ok["verification.slip.nin.premium"] == "50000"


def test_garbled_stored_values_fall_back_safely():
    s = S.parse({C.K_RETENTION: "abc", C.K_FEE + "nin": "-5", C.K_ENABLED: "TRUE", C.K_LOOKUP_TIER + "bvn": "regular"})
    assert s.retention_hours == 24 and s.fee_for("nin") == 0 and s.enabled and s.lookup_tier["bvn"] == "standard"


# ── breaker ───────────────────────────────────────────────────────────────
def test_breaker_trips_on_third_consecutive_failure_once():
    b = B.Breaker()
    b, t1 = B.on_failure(b, NOW, "timeout")
    b, t2 = B.on_failure(b, NOW, "timeout")
    assert not t1 and not t2 and B.allows_call(b, NOW)
    b, t3 = B.on_failure(b, NOW, "timeout")
    assert t3 and b.is_open and not B.allows_call(b, NOW)


def test_success_resets_the_streak():
    b = B.Breaker()
    b, _ = B.on_failure(b, NOW, "x")
    b, _ = B.on_failure(b, NOW, "x")
    b, rec = B.on_success(b)
    assert not rec and b.failures == 0
    b, t = B.on_failure(b, NOW, "x")
    assert not t


def test_breaker_retests_after_five_minutes_and_recovers():
    b = B.Breaker()
    for _ in range(3):
        b, _t = B.on_failure(b, NOW, "x")
    assert not B.allows_call(b, NOW + timedelta(minutes=4, seconds=59))
    assert B.allows_call(b, NOW + timedelta(minutes=5))
    b2, rec = B.on_success(b)
    assert rec and not b2.is_open


def test_failed_retest_reopens_without_second_alert():
    b = B.Breaker()
    for _ in range(3):
        b, _t = B.on_failure(b, NOW, "x")
    later = NOW + timedelta(minutes=5)
    b, tripped = B.on_failure(b, later, "x")
    assert not tripped and b.is_open and not B.allows_call(b, later + timedelta(minutes=1))
    assert B.allows_call(b, later + timedelta(minutes=5))


# ── crypto ────────────────────────────────────────────────────────────────
def _key():
    from cryptography.fernet import Fernet
    return Fernet.generate_key().decode()


def test_crypto_round_trip_and_not_plaintext():
    k = _key()
    tok = crypto.encrypt_json({"nin": "12345678901"}, key=k)
    assert b"12345678901" not in tok
    assert crypto.decrypt_json(tok, key=k) == {"nin": "12345678901"}


def test_crypto_wrong_key_returns_none_not_garbage():
    assert crypto.decrypt_bytes(crypto.encrypt_bytes(b"x", key=_key()), key=_key()) is None


def test_crypto_rotation_new_key_first_old_still_decrypts():
    old, new = _key(), _key()
    tok = crypto.encrypt_bytes(b"secret", key=old)
    assert crypto.decrypt_bytes(tok, key=f"{new},{old}") == b"secret"
    assert crypto.decrypt_bytes(crypto.encrypt_bytes(b"s", key=f"{new},{old}"), key=new) == b"s"


def test_crypto_missing_or_bad_key_raises():
    with pytest.raises(crypto.CryptoNotConfigured):
        crypto.encrypt_bytes(b"x", key="")
    with pytest.raises(crypto.CryptoNotConfigured):
        crypto.encrypt_bytes(b"x", key="not-a-key")


# ── photo extraction (synthetic PDFs) ─────────────────────────────────────
def _png(w, h, color):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    buf.seek(0)
    return buf


def _pdf_with(images):
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 700
    for (w, h, color) in images:
        c.drawImage(ImageReader(_png(w, h, color)), 50, y - 100, width=w / 3, height=h / 3)
        y -= 150
    c.showPage()
    c.save()
    return buf.getvalue()


def test_picks_portrait_over_qr_and_banner():
    pdf = _pdf_with([(300, 300, "black"), (900, 200, "green"), (240, 320, "red")])
    jpg = extract_portrait(pdf)
    assert jpg is not None
    from PIL import Image
    im = Image.open(io.BytesIO(jpg))
    assert im.height > im.width
    r, g, b = im.convert("RGB").getpixel((im.width // 2, im.height // 2))
    assert r > 200 and g < 60   # the red portrait, not the black QR


def test_no_portrait_returns_none():
    assert extract_portrait(_pdf_with([(300, 300, "black"), (900, 200, "green")])) is None


def test_garbage_pdf_never_raises():
    assert extract_portrait(b"%PDF-1.4 total nonsense") is None
    assert extract_portrait(b"") is None


def test_large_photo_is_shrunk():
    jpg = extract_portrait(_pdf_with([(1200, 1600, "blue")]))
    from PIL import Image
    assert max(Image.open(io.BytesIO(jpg)).size) <= 480


# ── branded sheet ─────────────────────────────────────────────────────────
DATA = {"nin": "12345678901", "first_name": "JOHN", "middle_name": "M", "last_name": "DOE", "gender": "MALE",
        "date_of_birth": "15-05-1985", "phone_number": "08012345678", "address": "1 <Sample> & Sons St"}


def test_sheet_builds_with_and_without_photo_and_masks_by_default():
    a = build_sheet_pdf(kind="nin", data=DATA, photo_jpeg=extract_portrait(_pdf_with([(240, 320, "red")])),
                        reference="MK-VF-1", verified_at=NOW)
    b = build_sheet_pdf(kind="bvn", data={**DATA, "bvn": "22212345678"}, photo_jpeg=None, reference="MK-VF-2", verified_at=NOW)
    assert a.startswith(b"%PDF") and b.startswith(b"%PDF")
    from pypdf import PdfReader
    text = PdfReader(io.BytesIO(a)).pages[0].extract_text()
    import re
    assert "12345678901" not in text and re.search(r"123\D{5}901", text)
    assert "not an official NIMC document" in text
    t2 = PdfReader(io.BytesIO(b)).pages[0].extract_text()
    assert "not an official bank or NIBSS document" in t2 and "techhub" not in (text + t2).lower()


def test_sheet_reveal_shows_full_id():
    from pypdf import PdfReader
    pdf = build_sheet_pdf(kind="nin", data=DATA, photo_jpeg=None, reference="r", verified_at=NOW, reveal_id=True)
    assert "12345678901" in PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
