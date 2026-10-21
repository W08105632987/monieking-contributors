import os
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u@localhost/x")

from app.services.sms_service import compact, count_segments


def test_plain_text_is_gsm7_single_segment():
    r = count_segments("MonieKing: N5,000 contributed to Card #1001")
    assert r["encoding"] == "GSM-7" and r["segments"] == 1


def test_naira_sign_would_force_unicode_so_it_is_swapped():
    raw = "MonieKing: ₦5,000 contributed — thank you " + "x" * 80
    assert count_segments(raw)["encoding"] == "Unicode"
    fixed = compact(raw)
    assert "₦" not in fixed and "—" not in fixed
    assert count_segments(fixed)["encoding"] == "GSM-7"
    assert count_segments(fixed)["segments"] <= count_segments(raw)["segments"]


def test_segment_boundaries():
    assert count_segments("a" * 160)["segments"] == 1
    assert count_segments("a" * 161)["segments"] == 2     # multipart: 153 each
    assert count_segments("a" * 306)["segments"] == 2
    assert count_segments("a" * 307)["segments"] == 3
    assert count_segments("é" * 0)["segments"] == 0
    # braces cost two characters in GSM-7
    assert count_segments("{" * 81)["segments"] == 2
    assert count_segments("😀" * 71)["segments"] == 3
