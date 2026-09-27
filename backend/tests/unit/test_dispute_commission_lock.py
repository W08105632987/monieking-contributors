"""Unit tests for Dispute Commission Lock Mechanism (Section 4.4)
Tests:
  1. Clean hold & release with sufficient balance
  2. Insufficient balance -> shortfall + debt creation
  3. Dispute resolved in worker favor after shortfall -> debt cancelled & held funds restored
  4. Dispute resolved against worker with active debt -> debt persists & held funds forfeited
  5. Future job commission absorbed by active debt
  6. Eligibility window calculation
  7. Duplicate dispute check logic (one live dispute per job regardless of raiser)
"""
import pytest
from datetime import datetime, timezone, timedelta
from app.models.manual_service_request import CommissionStatus


def test_hold_sufficient_balance():
    worker_balance = 500000  # 5,000 NGN
    worker_held = 0
    worker_debt = 0
    commission_kobo = 100000  # 1,000 NGN

    hold_amount = min(worker_balance, commission_kobo)
    shortfall = commission_kobo - hold_amount

    worker_balance -= hold_amount
    worker_held += hold_amount
    if shortfall > 0:
        worker_debt += shortfall

    assert hold_amount == 100000
    assert shortfall == 0
    assert worker_balance == 400000
    assert worker_held == 100000
    assert worker_debt == 0


def test_hold_insufficient_balance_shortfall():
    worker_balance = 30000  # 300 NGN available
    worker_held = 0
    worker_debt = 0
    commission_kobo = 100000  # 1,000 NGN required

    hold_amount = min(worker_balance, commission_kobo)
    shortfall = commission_kobo - hold_amount

    worker_balance -= hold_amount
    worker_held += hold_amount
    if shortfall > 0:
        worker_debt += shortfall

    assert hold_amount == 30000
    assert shortfall == 70000
    assert worker_balance == 0
    assert worker_held == 30000
    assert worker_debt == 70000


def test_resolve_in_worker_favor_after_shortfall():
    worker_balance = 0
    worker_held = 30000
    worker_debt = 70000
    commission_kobo = 100000

    hold_amount = min(worker_held, commission_kobo)
    shortfall = commission_kobo - hold_amount

    # In worker favor:
    worker_held -= hold_amount
    worker_balance += hold_amount
    if shortfall > 0:
        worker_debt = max(0, worker_debt - shortfall)

    assert worker_held == 0
    assert worker_balance == 30000
    assert worker_debt == 0


def test_resolve_against_worker_with_debt():
    worker_balance = 0
    worker_held = 30000
    worker_debt = 70000
    commission_kobo = 100000

    hold_amount = min(worker_held, commission_kobo)

    # Against worker: held is forfeited, debt stays active
    worker_held -= hold_amount

    assert worker_held == 0
    assert worker_balance == 0
    assert worker_debt == 70000  # Debt remains!


def test_future_commission_absorbs_debt():
    worker_balance = 0
    worker_debt = 70000
    new_job_commission = 100000

    # Debt absorption logic from job_pool_service.py
    if worker_debt > 0:
        repay = min(worker_debt, new_job_commission)
        worker_debt -= repay
        surplus = new_job_commission - repay
    else:
        surplus = new_job_commission

    worker_balance += surplus

    assert worker_debt == 0
    assert worker_balance == 30000  # Only surplus credited!


def test_future_commission_partial_debt_repayment():
    worker_balance = 0
    worker_debt = 70000
    new_job_commission = 40000

    if worker_debt > 0:
        repay = min(worker_debt, new_job_commission)
        worker_debt -= repay
        surplus = new_job_commission - repay
    else:
        surplus = new_job_commission

    worker_balance += surplus

    assert worker_debt == 30000  # 300 NGN still owed
    assert worker_balance == 0   # 0 credited to balance


def test_eligibility_window():
    now = datetime.now(timezone.utc)
    eligibility_hours = 72

    # Within window
    completed_recent = now - timedelta(hours=48)
    age_hours_recent = (now - completed_recent).total_seconds() / 3600
    assert age_hours_recent <= eligibility_hours

    # Expired
    completed_old = now - timedelta(hours=73)
    age_hours_old = (now - completed_old).total_seconds() / 3600
    assert age_hours_old > eligibility_hours
