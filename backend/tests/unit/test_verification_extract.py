"""Phase 6c: reading person data from unknown Techhub shapes, and the unified history mappers."""
import io
import types
from datetime import datetime, timedelta, timezone

import pytest

from app.history import feed as H
from app.verification import extract as X


def test_extracts_from_unusual_key_names():
    d = X.extract_fields({"Surname": "ADE", "FirstName": "Bola", "sex": "f", "birthdate": "01-01-1990",
                          "telephoneno": "0803", "residenceAddress": "1 Road"})
    assert d["last_name"] == "ADE" and d["first_name"] == "Bola" and d["gender"] == "Female"
    assert d["date_of_birth"] == "01-01-1990" and d["phone_number"] == "0803" and d["address"] == "1 Road"


def test_extracts_from_nested_shapes():
    d = X.extract_fields({"data": {"personal": {"last_name": "ADE", "first_name": "BOLA"}, "contact": [{"phone": "080"}]}})
    assert d["first_name"] == "BOLA" and d["phone_number"] == "080"


def test_full_name_only_is_split():
    d = X.extract_fields({"fullname": "ADE BOLA TEE"})
    assert (d["last_name"], d["first_name"], d["middle_name"]) == ("ADE", "BOLA", "TEE")


def test_loose_key_matching():
    d = X.extract_fields({"applicant_first_name": "BOLA", "customer_surname": "ADE", "dateOfBirthFormatted": "x"})
    assert d["first_name"] == "BOLA" and d["last_name"] == "ADE" and d["date_of_birth"] == "x"
    # birth place must not be mistaken for date of birth
    assert "date_of_birth" not in X.extract_fields({"birthplace": "Lagos", "first_name": "A"})


def test_unmappable_data_has_no_identity_and_key_names_exclude_values():
    raw = {"weird": {"zzz": "SECRET-VALUE", "qqq": 1}}
    assert not X.has_identity(X.extract_fields(raw))
    names = X.key_names(raw)
    assert names == ["weird.zzz", "weird.qqq"] and "SECRET" not in str(names)


def test_requested_id_fills_missing_identifier_so_slips_can_be_bought():
    d = X.complete({"first_name": "A", "last_name": "B"}, b"", id_key="nin", requested_id="12345678901")
    assert d["nin"] == "12345678901"
    d = X.complete({"first_name": "A", "last_name": "B", "nin": "99999999999"}, b"", id_key="nin", requested_id="12345678901")
    assert d["nin"] == "99999999999"


def test_pdf_text_fills_gaps():
    pytest.importorskip("reportlab")
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, line in enumerate(["Surname: ADEYEMI", "First Name: BOLA", "Gender: Male", "Date of Birth: 01-02-1990"]):
        c.drawString(72, 750 - 20 * i, line)
    c.save()
    d = X.complete({"message": "ok"}, buf.getvalue(), id_key="nin", requested_id="12345678901")
    assert d["last_name"] == "ADEYEMI" and d["first_name"] == "BOLA" and d["date_of_birth"] == "01-02-1990"


def test_photo_inside_json():
    import base64
    jpeg = b"\xff\xd8\xff" + b"0" * 600
    assert X.photo_from_data({"user": {"photo": base64.b64encode(jpeg).decode()}}) == jpeg
    assert X.photo_from_data({"photo": "short"}) == b""


# ── history mappers ───────────────────────────────────────────────────────
NOW = datetime(2026, 10, 15, tzinfo=timezone.utc)


def _ver(**kw):
    base = dict(id="v1", kind="nin", status="found", fee_kobo=1000, summary={"name": "A** B***"}, created_at=NOW,
                failure_reason=None, purged_at=None, expires_at=datetime.now(timezone.utc) + timedelta(hours=5))
    base.update(kw)
    return types.SimpleNamespace(**base)


def test_verification_items_cover_every_outcome():
    ok = H.verification_item(_ver())
    assert ok["status"] == "completed" and ok["openable"] and ok["detail"] == "A** B***"
    nf = H.verification_item(_ver(status="not_found", fee_kobo=0))
    assert nf["status"] == "completed" and nf["amount_kobo"] == 0 and "not charged" in nf["detail"].lower()
    bad = H.verification_item(_ver(status="failed", fee_kobo=0, failure_reason="temporarily unavailable"))
    assert bad["status"] == "failed" and bad["detail"] == "temporarily unavailable" and not bad["openable"]
    old = H.verification_item(_ver(expires_at=NOW - timedelta(days=1)))
    assert old["expired"] and not old["openable"]


def test_manual_bill_identity_mapping_and_merge():
    man = H.manual_item(types.SimpleNamespace(id="m", status="failed", price_kobo=500, created_at=NOW,
                                              worker_remarks="blurry photo", service_type="nin_modification",
                                              service_category="nin"), "Nin Modification")
    assert man["status"] == "failed" and man["detail"] == "blurry photo" and man["source"] == "manual"
    run = H.manual_item(types.SimpleNamespace(id="m2", status=types.SimpleNamespace(value="processing"), price_kobo=1,
                                              created_at=NOW, worker_remarks=None, service_type="x", service_category="y"), "X")
    assert run["status"] == "pending"
    bill = H.bill_item(types.SimpleNamespace(id="b", status=types.SimpleNamespace(value="completed"), amount_kobo=9,
                                             created_at=NOW, failure_reason=None), "MTN · Airtime")
    assert bill["status"] == "completed"
    ident = H.identity_item(types.SimpleNamespace(id="i", status=types.SimpleNamespace(value="reversed"),
                                                  amount_charged_kobo=5, created_at=NOW, failure_reason=None),
                            "BVN modification", types.SimpleNamespace(value="bvn"))
    assert ident["status"] == "reversed" and ident["category"] == "bvn"
    items = [dict(man, created_at="2026-10-01"), dict(bill, created_at="2026-10-03"), dict(ident, created_at="2026-10-02")]
    assert [i["source"] for i in H.merge(items, 2)] == ["bill", "identity"]
