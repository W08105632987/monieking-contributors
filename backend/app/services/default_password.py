"""LEGACY default login password: the person's phone number followed by MK (08031234567 -> 08031234567MK). Kept ONLY so
the app can refuse it as a new password and so old accounts can be found; nothing creates it any more.

Used whenever MonieKing sets a password FOR someone: a director resetting it, or a customer an officer or director
registered who now wants to use their own phone. It is predictable on purpose, so the account is flagged
(`must_change_password`) and the app keeps asking for a new password at every login until it is changed."""
import re
import secrets

SUFFIX = "MK"

# 8 characters from 32 symbols (no 0/O, 1/I/L): about a trillion combinations, easy to read out or type from an SMS.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_temporary_password() -> str:
    """A RANDOM one-time password for accounts MonieKing creates or resets for someone (finding S-14).

    Before, every such account got phone number + "MK". Phone numbers are not secret, so anyone could log into any
    account that had not yet been used (officer-registered customers, imported customers, service workers, reset
    accounts) and take it over, withdrawal password included. The new password is random and only ever shown to the
    director/officer who created it, who hands it on (copy, SMS, WhatsApp)."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


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
