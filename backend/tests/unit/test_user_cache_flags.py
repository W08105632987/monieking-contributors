"""The user cache never stores secrets, but must still remember WHETHER a PIN / withdrawal password was set —
otherwise the 'set up your PIN' banner reappears on every refresh."""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x@localhost/x_test")

from app.core.dependencies import _serialize_user, _deserialize_user
from app.models.user import User, UserRole, UserStatus


def _user(**kw):
    return User(id=uuid.uuid4(), role=UserRole.DIRECTOR, full_name="D", phone_number="08000000000", status=UserStatus.ACTIVE, **kw)


def test_pin_and_withdrawal_flags_survive_the_cache():
    u = _user(payment_pin_hash="x", withdrawal_password_hash="y")
    raw = _serialize_user(u)
    assert '"payment_pin_hash"' not in raw and '"withdrawal_password_hash"' not in raw
    back = _deserialize_user(raw)
    assert back.has_payment_pin is True and back.has_withdrawal_password is True
    assert back.payment_pin_hash is None  # the secret itself is still not cached


def test_unset_stays_unset():
    back = _deserialize_user(_serialize_user(_user()))
    assert back.has_payment_pin is False and back.has_withdrawal_password is False
