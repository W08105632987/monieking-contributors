import pytest

from app.core.public_errors import GENERIC_MESSAGE, looks_technical, public_message

TECHNICAL = [
    "Payment provider login failed (HTTP 503). Please try again.",
    "Payment provider rejected our credentials. Please contact support.",
    "Internal server error",
    "Traceback (most recent call last):\n  File \"x.py\", line 1",
    "Could not reach Monnify (ConnectError). Check MONNIFY_BASE_URL.",
    "Bills provider returned a non-JSON response (HTTP 502): <html>",
    "sqlalchemy.exc.IntegrityError: duplicate key value violates unique constraint",
    "SELECT id FROM users WHERE phone = 1",
    "Failed to fetch https://api.monnify.com/api/v1/auth/login",
    "KeyError: 'accessToken'",
    "",
    None,
    "x" * 500,
]

SAFE = [
    "Insufficient wallet balance.",
    "That is not a valid Nigerian mobile number.",
    "This number looks like a MTN line, not GLO.",
    "Invalid OTP code.",
    "Phone number is required.",
]


@pytest.mark.parametrize("msg", TECHNICAL)
def test_technical_is_flagged(msg):
    assert looks_technical(msg)
    assert public_message(msg) == GENERIC_MESSAGE


@pytest.mark.parametrize("msg", SAFE)
def test_business_messages_pass_through(msg):
    assert not looks_technical(msg)
    assert public_message(msg) == msg


def test_custom_fallback():
    assert public_message("login failed (HTTP 500)", "Try later.") == "Try later."
