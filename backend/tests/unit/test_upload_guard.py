import base64

import pytest
from fastapi import HTTPException

from app.utils.upload_guard import IMAGE_ONLY, IMAGES_AND_PDF, decode_upload

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 20


def url(raw: bytes, mime="image/png") -> str:
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


def test_real_png_is_accepted_and_type_comes_from_bytes():
    raw, ctype, ext = decode_upload(url(PNG, "image/jpeg"), max_bytes=1024)   # client lies about the type
    assert (ctype, ext) == ("image/png", "png")


def test_html_disguised_as_image_is_refused():
    with pytest.raises(HTTPException) as e:
        decode_upload(url(b"<script>alert(1)</script>", "image/png"), max_bytes=1024)
    assert e.value.status_code == 400


def test_pdf_only_where_allowed():
    pdf = b"%PDF-1.7 test"
    assert decode_upload(url(pdf, "application/pdf"), max_bytes=1024, allowed=IMAGES_AND_PDF)[2] == "pdf"
    with pytest.raises(HTTPException):
        decode_upload(url(pdf, "application/pdf"), max_bytes=1024, allowed=IMAGE_ONLY)


def test_oversize_rejected_before_decoding():
    with pytest.raises(HTTPException):
        decode_upload("data:image/png;base64," + "A" * 5000, max_bytes=1000)


def test_garbage_base64_rejected():
    with pytest.raises(HTTPException):
        decode_upload("data:image/png;base64,@@@@", max_bytes=1000)
