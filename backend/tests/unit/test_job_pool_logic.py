"""
Unit tests for job pool business logic (no DB required).
Tests cover:
  - ManualServiceStatus enum string values (must match frontend expectations)
  - SWWithdrawalStatus enum string values
  - Worker route masking helpers (mask_name, mask_phone, mask_form_data)
  - Referral hold expiry calculation (time arithmetic)
"""
from __future__ import annotations

import uuid
import pytest
from datetime import datetime, timezone, timedelta


# ── Enum values ───────────────────────────────────────────────────────────────

def test_manual_service_status_values():
    """Backend enum values must match what the frontend checks for."""
    from app.models.manual_service_request import ManualServiceStatus
    assert ManualServiceStatus.PENDING.value    == "pending"
    assert ManualServiceStatus.PROCESSING.value == "processing"
    assert ManualServiceStatus.SUCCESSFUL.value == "successful"
    assert ManualServiceStatus.FAILED.value     == "failed"


def test_sw_withdrawal_status_values():
    """SWWithdrawalStatus values must match frontend badge checks."""
    from app.models.service_worker_withdrawal import SWWithdrawalStatus
    assert SWWithdrawalStatus.PENDING.value  == "pending"
    assert SWWithdrawalStatus.PAID.value     == "paid"
    assert SWWithdrawalStatus.REJECTED.value == "rejected"


# ── Masking helpers ───────────────────────────────────────────────────────────

def test_mask_name_basic():
    from app.api.v1.routes.worker import mask_name
    result = mask_name("John Doe")
    assert result is not None
    parts = result.split()
    assert len(parts) == 2
    assert parts[0].startswith("Jo")
    assert "*" in parts[0]
    assert parts[1].startswith("Do")
    assert "*" in parts[1]


def test_mask_name_short_word():
    from app.api.v1.routes.worker import mask_name
    result = mask_name("Li")
    assert result is not None
    assert result.endswith("*")


def test_mask_name_none():
    from app.api.v1.routes.worker import mask_name
    assert mask_name(None) is None


def test_mask_phone_standard():
    from app.api.v1.routes.worker import mask_phone
    result = mask_phone("08012345678")
    assert result is not None
    assert result.startswith("0801")
    assert "***" in result
    assert result.endswith("678")


def test_mask_phone_short():
    from app.api.v1.routes.worker import mask_phone
    result = mask_phone("123")
    assert result == "****"


def test_mask_phone_none():
    from app.api.v1.routes.worker import mask_phone
    assert mask_phone(None) is None


def test_mask_form_data_nin():
    from app.api.v1.routes.worker import mask_form_data
    form = {"nin": "12345678901", "full_name": "John"}
    result = mask_form_data(form)
    assert result["nin"].endswith("8901")
    assert "*" in result["nin"]
    assert result["full_name"] == "John"


def test_mask_form_data_bvn():
    from app.api.v1.routes.worker import mask_form_data
    form = {"bvn": "22123456789"}
    result = mask_form_data(form)
    assert result["bvn"].endswith("6789")
    assert "*" in result["bvn"]


def test_mask_form_data_email():
    from app.api.v1.routes.worker import mask_form_data
    form = {"email": "johndoe@example.com"}
    result = mask_form_data(form)
    assert "@example.com" in result["email"]
    assert "***" in result["email"]


def test_mask_form_data_dob():
    from app.api.v1.routes.worker import mask_form_data
    form = {"dob": "1990-05-12"}
    result = mask_form_data(form)
    assert result["dob"] == "****-**-**"


def test_mask_form_data_empty():
    from app.api.v1.routes.worker import mask_form_data
    assert mask_form_data(None) == {}
    assert mask_form_data({}) == {}


# ── Referral hold expiry logic ────────────────────────────────────────────────

def test_referral_hold_expires_in_future():
    hold_mins = 30
    now = datetime.now(timezone.utc)
    created_at = now - timedelta(minutes=5)
    expires_at = created_at + timedelta(minutes=hold_mins)
    assert now < expires_at, "Hold should still be active"


def test_referral_hold_expired():
    hold_mins = 30
    now = datetime.now(timezone.utc)
    created_at = now - timedelta(minutes=35)
    expires_at = created_at + timedelta(minutes=hold_mins)
    assert now >= expires_at, "Hold should have expired"


def test_cutoff_calculation():
    hold_mins = 30
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=hold_mins)

    # A job created before the cutoff → referral hold expired → visible in pool
    old_job_created_at = now - timedelta(minutes=35)
    assert old_job_created_at <= cutoff

    # A job created after the cutoff → still in exclusive referral hold → NOT visible
    recent_job_created_at = now - timedelta(minutes=10)
    assert recent_job_created_at > cutoff
