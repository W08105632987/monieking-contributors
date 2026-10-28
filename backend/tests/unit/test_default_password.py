from app.services.default_password import check_new_password, default_password, is_default_password


def test_default_is_phone_plus_mk():
    assert default_password("08031234567") == "08031234567MK"
    assert default_password(" 0803 123 4567 ") == "08031234567MK"
    assert is_default_password("08031234567", "08031234567MK") and not is_default_password("08031234567", "08031234567")


def test_new_password_rules():
    p = "08031234567"
    assert check_new_password(p, "short") and check_new_password(p, "08031234567MK") and check_new_password(p, "08031234567")
    assert check_new_password(p, "Sunrise2026!") is None
