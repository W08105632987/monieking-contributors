"""Accounts MonieKing creates or resets get a RANDOM one-time password, never phone + MK (finding S-14)."""
import re

from app.services import default_password as dp


def test_temporary_passwords_are_random_readable_and_long_enough():
    seen = {dp.new_temporary_password() for _ in range(2000)}
    assert len(seen) == 2000                                  # no repeats
    assert all(re.fullmatch(r"[A-HJKMNP-Z2-9]{8}", p) for p in seen)   # 8 chars, no 0/O/1/I/L


def test_it_never_depends_on_the_phone_number():
    phone = "08012345678"
    assert dp.new_temporary_password() != dp.default_password(phone)
    assert not any(dp.is_default_password(phone, dp.new_temporary_password()) for _ in range(500))


def test_the_old_default_is_still_refused_as_a_new_password():
    assert dp.check_new_password("08012345678", "08012345678MK") is not None
    assert dp.check_new_password("08012345678", "08012345678") is not None
    assert dp.check_new_password("08012345678", "a-Good-passphrase-2026") is None


def test_it_fits_what_the_send_password_endpoint_accepts():
    from app.api.v1.routes.customer_admin import SendPasswordBody
    SendPasswordBody(channel="sms", temporary_password=dp.new_temporary_password(), pin="1234")
