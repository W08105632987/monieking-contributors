"""The default login password: the person's phone number followed by MK (08031234567 -> 08031234567MK).

Used whenever MonieKing sets a password FOR someone: a director resetting it, or a customer an officer or director
registered who now wants to use their own phone. It is predictable on purpose, so the account is flagged
(`must_change_password`) and the app keeps asking for a new password at every login until it is changed."""
import re

SUFFIX = "MK"


def default_password(phone_number: str) -> str:
    return re.sub(r"\D", "", phone_number or "") + SUFFIX


def is_default_password(phone_number: str, password: str) -> bool:
    return bool(password) and password == default_password(phone_number)


def check_new_password(phone_number: str, password: str) -> str | None:
    """None when acceptable, otherwise a plain-language reason."""
    if len(password or "") < 8:
        return "New password must be at least 8 characters"
    if is_default_password(phone_number, password):
        return "Choose a password different from the default one"
    if re.sub(r"\D", "", password) == re.sub(r"\D", "", phone_number or "") and password.isdigit():
        return "Your phone number alone is not a safe password"
    return None
