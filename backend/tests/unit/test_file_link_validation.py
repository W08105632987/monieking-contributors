"""Links to files that staff later click must be ours or harmless data (finding S-13)."""
import base64

import pytest
from fastapi import HTTPException

from app.utils import upload_guard as ug

OURS = "https://abc.supabase.co/storage/v1/object/public/avatars/doc.pdf"


@pytest.fixture(autouse=True)
def _host(monkeypatch):
    monkeypatch.setattr(ug, "_storage_host", lambda: "abc.supabase.co")


def b64(raw):
    return base64.b64encode(raw).decode()


@pytest.mark.parametrize("bad", [
    "javascript:alert(document.cookie)", "  JaVaScRiPt:alert(1)", "vbscript:x", "http://abc.supabase.co/storage/v1/object/x",
    "https://evil.example/storage/v1/object/public/avatars/x.png", "https://abc.supabase.co.evil.example/storage/v1/object/x",
    "https://user:pw@abc.supabase.co/storage/v1/object/x", "https://abc.supabase.co/rest/v1/users", "//evil.example/x",
    "data:text/html;base64," + b64(b"<script>alert(1)</script>"), "data:image/svg+xml;base64," + b64(b"<svg onload=alert(1)>"),
    "data:application/javascript;base64," + b64(b"alert(1)"), "", None, 123,
])
def test_dangerous_links_are_refused(bad):
    with pytest.raises(HTTPException) as e:
        ug.validate_file_url(bad)
    assert e.value.status_code == 400


def test_our_storage_and_small_safe_files_pass():
    assert ug.validate_file_url(OURS) == OURS
    png = "data:image/png;base64," + b64(b"\x89PNG\r\n\x1a\n" + b"\0" * 30)
    assert ug.validate_file_url(png) == png
    assert ug.validate_file_url("data:text/plain;base64," + b64(b"hello"))


def test_disguised_image_and_oversize_refused():
    with pytest.raises(HTTPException):
        ug.validate_file_url("data:image/png;base64," + b64(b"<html>not a png</html>"))
    with pytest.raises(HTTPException):
        ug.validate_file_url("data:application/pdf;base64," + b64(b"%PDF-" + b"0" * 2000), max_data_bytes=1000)


def test_data_links_can_be_forbidden_and_lists_are_capped():
    with pytest.raises(HTTPException):
        ug.validate_file_url("data:image/png;base64," + b64(b"\x89PNG\r\n\x1a\n"), allow_data=False)
    with pytest.raises(HTTPException):
        ug.validate_file_urls([OURS] * 11)
    assert ug.validate_file_urls(None) == [] and ug.validate_file_urls([OURS]) == [OURS]
