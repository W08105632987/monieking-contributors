"""The electricity token must be found wherever the provider puts it."""
from app.services.bill_payment_service import _extract_token


def test_token_in_vend_instruction():
    assert _extract_token({"vendStatus": "SUCCESS", "vendInstruction": {"token": "1234 5678 9012 3456 7890"}}) == "1234 5678 9012 3456 7890"


def test_token_code_top_level():
    assert _extract_token({"tokenCode": "11112222333344445555"}) == "11112222333344445555"


def test_token_deeply_nested():
    assert _extract_token({"vendStatus": "SUCCESS", "data": {"meter": {"token": "99998888777766665555"}}}) == "99998888777766665555"


def test_token_only_in_description_text():
    assert _extract_token({"description": "Payment successful. Token: 1111-2222-3333-4444-5555 Units 20.1"}) == "1111-2222-3333-4444-5555"


def test_no_token_for_airtime():
    assert _extract_token({"vendStatus": "SUCCESS", "vendAmount": 500}) is None
    assert _extract_token({}) is None
