"""
The cooperative's rule book: every business decision is a setting defined here.

Nothing else in the module hard-codes a rate, limit, count or rule: code asks
`settings_store.get(...)` and the value comes from the director-controlled
settings (see settings_store.py). The definitions below only supply the type,
bounds, default, and *how a change is allowed to take effect*.

Defaults come from the directors' consolidated answers. A default marked
`confirmed=False` is a PROVISIONAL placeholder awaiting a Board decision: the
UI shows it as such, and live funds can never be switched on while a setting
that is `required_for_live` is still provisional.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# How a change takes effect once approved
EFFECT_IMMEDIATE = "immediate"       # from the moment the change is approved
EFFECT_NEW_LOANS = "new_loans"       # approved now; only loans created afterwards use it
EFFECT_NEXT_YEAR = "next_year"       # scheduled for the start of the next accounting year

EFFECT_LABEL = {
    EFFECT_IMMEDIATE: "Immediately",
    EFFECT_NEW_LOANS: "New loans only",
    EFFECT_NEXT_YEAR: "Next accounting year",
}

NAIRA = 100  # kobo per naira


@dataclass(frozen=True)
class SettingDef:
    key: str
    group: str
    label: str
    kind: str                      # int | bps | kobo | bool | enum | str
    default: str
    confirmed: bool = True         # False => provisional placeholder
    effect: str = EFFECT_NEW_LOANS
    note: str = ""
    min: Optional[int] = None
    max: Optional[int] = None
    options: tuple[str, ...] = ()
    unit: str = ""
    readonly: bool = False         # shown but cannot be changed in this release
    hidden: bool = False           # not shown in the settings screen
    required_for_live: bool = False


GROUPS = [
    "Access",
    "Membership",
    "Loans",
    "Loan payout",
    "Repayment",
    "Guarantees",
    "Overdue and charges",
    "Dividend",
    "Year end",
    "Approvals",
    "Requests and recovery",
    "Safety and go-live",
    "Profiles",
]

# Hidden settings that hold WHO does a job (director user ids). Changed from the Roles screen, with approval.
ROLE_KEYS = ("accountant_user_id", "treasurer_user_id", "final_release_directors")

_D = SettingDef

DEFINITIONS: list[SettingDef] = [
    # ── Access ───────────────────────────────────────────────────────
    _D("coop_enabled", "Access", "Cooperative section switched on", "bool", "true",
       effect=EFFECT_IMMEDIATE, note="Master switch for the whole cooperative section."),
    _D("coop_pilot_only", "Access", "Only pilot members can see it", "bool", "true",
       effect=EFFECT_IMMEDIATE, note="When on, only members added to the pilot list can use the member screens."),
    _D("coop_live_funds", "Access", "Live funds", "bool", "false", confirmed=False,
       effect=EFFECT_IMMEDIATE, readonly=True,
       note="Not available in this preview. All money is test money recorded inside the cooperative's own books."),

    # ── Membership ───────────────────────────────────────────────────
    _D("registration_min_kobo", "Membership", "Minimum registration contribution", "kobo", str(50 * NAIRA),
       effect=EFFECT_NEW_LOANS, min=0, note="Paid once when a member joins. It becomes the first contribution."),
    _D("nin_required", "Membership", "NIN required to join", "bool", "true",
       effect=EFFECT_IMMEDIATE, note="In the preview a tester without a linked NIN can continue and is marked as a test bypass."),
    _D("membership_fee_kobo", "Membership", "One-time membership fee", "kobo", str(1000 * NAIRA),
       effect=EFFECT_NEXT_YEAR, min=0, note="One-time, not yearly. Taken from the contribution balance, only when the full amount is available. Not refundable. Goes to running costs, not the dividend."),
    _D("year_end_month", "Membership", "Accounting year ends (month)", "int", "12",
       effect=EFFECT_NEXT_YEAR, min=1, max=12, note="The year starts on 1 January and ends on this month and day."),
    _D("year_end_day", "Membership", "Accounting year ends (day)", "int", "10",
       effect=EFFECT_NEXT_YEAR, min=1, max=31),

    # ── Loans ────────────────────────────────────────────────────────
    _D("loan_rate_bps", "Loans", "Loan interest rate (flat per loan)", "bps", "1000", confirmed=False,
       effect=EFFECT_NEW_LOANS, min=0, max=10000, unit="% of principal",
       note="Set by the directors from time to time. 10% is only an example. Each loan keeps the rate it was approved with.",
       required_for_live=True),
    _D("loan_min_kobo", "Loans", "Minimum loan", "kobo", str(50_000 * NAIRA), confirmed=False,
       effect=EFFECT_NEW_LOANS, min=0, required_for_live=True),
    _D("loan_max_kobo", "Loans", "Maximum loan", "kobo", str(20_000_000 * NAIRA),
       effect=EFFECT_NEW_LOANS, min=0),
    _D("loan_term_months", "Loans", "Maximum loan term", "int", "6",
       effect=EFFECT_NEW_LOANS, min=1, max=36, unit="months"),
    _D("loan_max_active", "Loans", "Active loans per member", "int", "1",
       effect=EFFECT_NEW_LOANS, min=1, max=5),
    _D("loan_first_limit_kobo", "Loans", "First-loan limit (credit ladder)", "kobo", str(100_000 * NAIRA), confirmed=False,
       effect=EFFECT_NEW_LOANS, min=0, required_for_live=True,
       note="New members are flagged to the directors when they ask for more than this on a first loan. The ladder tiers are still to be decided by the Board."),
    _D("loan_cooling_days", "Loans", "Waiting days before a first loan", "int", "0", confirmed=False,
       effect=EFFECT_NEW_LOANS, min=0, max=365, unit="days", required_for_live=True,
       note="0 means no waiting period. The Board is to decide."),
    _D("loan_request_expiry_days", "Loans", "Loan request stays open for", "int", "7", confirmed=False,
       effect=EFFECT_IMMEDIATE, min=1, max=90, unit="days",
       note="If the loan is not fully guaranteed in this time it expires and every lock is released."),
    _D("loan_max_guarantors", "Loans", "Maximum guarantors per loan", "int", "5", confirmed=False,
       effect=EFFECT_NEW_LOANS, min=1, max=20, required_for_live=True),

    # ── Guarantees ───────────────────────────────────────────────────
    _D("cover_pct", "Guarantees", "Required guarantee cover", "int", "100",
       effect=EFFECT_NEW_LOANS, min=1, max=100, unit="% of principal"),
    _D("guarantor_min_funds_pct", "Guarantees", "Guarantor must hold at least", "int", "50",
       effect=EFFECT_NEW_LOANS, min=0, max=100, unit="% of the loan in free funds"),
    _D("guarantee_min_kobo", "Guarantees", "Minimum guarantee amount", "kobo", str(50_000 * NAIRA),
       effect=EFFECT_NEW_LOANS, min=0),
    _D("guarantee_min_commit_pct", "Guarantees", "Each guarantor commits at least", "int", "50", confirmed=False,
       effect=EFFECT_NEW_LOANS, min=0, max=100, unit="% of the loan",
       note="Round 2 wording. The last guarantor may commit less if that is exactly what is still uncovered."),
    _D("guarantee_max_kobo", "Guarantees", "Maximum guarantee amount", "kobo", str(20_000_000 * NAIRA),
       effect=EFFECT_NEW_LOANS, min=0),
    _D("guarantee_max_active", "Guarantees", "Active guarantees per member", "int", "10",
       effect=EFFECT_IMMEDIATE, min=1, max=100),
    _D("borrower_funds_count", "Guarantees", "Borrower's own money counts toward cover", "enum", "no", confirmed=False,
       effect=EFFECT_NEW_LOANS, options=("no", "yes"), required_for_live=True,
       note="Directors have said no so far. Waiting for the Board for borrowers who already hold contribution. Not applied in this preview."),
    _D("lock_starts_at", "Guarantees", "Guarantee money locks when", "enum", "signing", confirmed=False,
       effect=EFFECT_NEW_LOANS, options=("signing",), required_for_live=True,
       note="The preview locks the money the moment the guarantor signs, and releases it if the loan is rejected, cancelled or expires."),
    _D("invite_expiry_hours", "Guarantees", "Guarantor invitation stays open for", "int", "48", confirmed=False,
       effect=EFFECT_IMMEDIATE, min=1, max=720, unit="hours"),

    # ── Overdue and charges ──────────────────────────────────────────
    _D("overdue_daily_bps", "Overdue and charges", "Daily overdue charge", "bps", "300",
       effect=EFFECT_NEW_LOANS, min=0, max=10000, unit="% of the original interest, per day",
       note="Calculated on the original interest, not on the principal."),
    _D("overdue_cap_pct", "Overdue and charges", "Overdue charge cap", "int", "0", confirmed=False,
       effect=EFFECT_NEW_LOANS, min=0, max=1000, unit="% of the original interest (0 = no cap)",
       required_for_live=True,
       note="No cap adopted. Pending written legal confirmation. Without a cap the charge passes the original interest after about 33 days."),
    _D("overdue_grace_days", "Overdue and charges", "Grace days before overdue", "int", "0",
       effect=EFFECT_NEW_LOANS, min=0, max=60, unit="days",
       note="Directors confirmed: no grace period. Overdue starts on the first day of the month after the loan term ends."),
    _D("early_withdrawal_bps", "Overdue and charges", "Early withdrawal charge", "bps", "1000",
       effect=EFFECT_IMMEDIATE, min=0, max=10000, unit="% of the amount withdrawn",
       note="Goes into the dividend pool. The member then does not share that year's dividend."),
    _D("running_cost_bps", "Overdue and charges", "Running cost", "bps", "1000",
       effect=EFFECT_NEXT_YEAR, min=0, max=10000, unit="% of realised loan interest",
       note="Taken from realised interest before the contribution/guarantee split."),
    _D("loss_wait_months", "Overdue and charges", "Months before locked funds can be applied as a loss", "int", "12",
       effect=EFFECT_NEW_LOANS, min=0, max=60, unit="months",
       note="Only after all recovery steps have failed and the write-off is approved with a Board decision and a lawyer's report."),

    # ── Dividend ─────────────────────────────────────────────────────
    _D("dividend_contribution_pct", "Dividend", "Contribution share of the pool", "int", "70",
       effect=EFFECT_NEXT_YEAR, min=0, max=100, unit="%",
       note="The guarantee share is automatically the rest (100% minus this)."),
    _D("dividend_guarantee_pct", "Dividend", "Guarantee share of the pool", "int", "30",
       effect=EFFECT_NEXT_YEAR, min=0, max=100, unit="%", readonly=True,
       note="Always 100% minus the contribution share, so the two can never disagree."),
    _D("dividend_min_balance_kobo", "Dividend", "Qualifying balance", "kobo", str(100_000 * NAIRA),
       effect=EFFECT_NEXT_YEAR, min=0,
       note="The exact test over the holding period is waiting for the Board. The preview checks the balance today."),
    _D("dividend_min_months", "Dividend", "Qualifying holding period", "int", "6",
       effect=EFFECT_NEXT_YEAR, min=0, max=24, unit="months"),
    _D("guarantee_share_scope", "Dividend", "Guarantee share is paid from", "enum", "pooled", confirmed=False,
       effect=EFFECT_NEXT_YEAR, options=("pooled",), required_for_live=True,
       note="Pooled means one guarantee pool shared by all guarantors by amount x days locked. Per-loan sharing is waiting for the Board."),
    _D("dividend_rounding", "Dividend", "Rounding of member shares", "enum", "largest_remainder", confirmed=False,
       effect=EFFECT_NEXT_YEAR, options=("largest_remainder",)),
    _D("dividend_payout", "Dividend", "Dividend is paid to", "enum", "wallet", confirmed=False,
       effect=EFFECT_NEXT_YEAR, options=("wallet", "loan_card", "contribution"), required_for_live=True,
       note="wallet: paid out to the member's MonieKing wallet. loan_card: paid to the loan card. contribution: added to the member's contribution balance (reinvested)."),

    # ── Approvals ────────────────────────────────────────────────────
    _D("approvals_loan", "Approvals", "Directors needed to approve a loan", "int", "2",
       effect=EFFECT_NEW_LOANS, min=1, max=10),
    _D("approvals_settings", "Approvals", "Directors needed to approve a settings change", "int", "2",
       effect=EFFECT_IMMEDIATE, min=1, max=10,
       note="The director who proposes a change counts as the first approval."),
    _D("approvals_dividend", "Approvals", "Directors needed to approve the dividend", "int", "2", confirmed=False,
       effect=EFFECT_NEXT_YEAR, min=1, max=10, required_for_live=True),
    _D("accountant_user_id", "Approvals", "Director with accountant duty", "str", "", confirmed=False,
       effect=EFFECT_IMMEDIATE, hidden=True,
       note="Prepares and reconciles the dividend. Cannot give the final approval on the same schedule."),
    _D("treasurer_user_id", "Approvals", "Director with treasurer duty", "str", "", confirmed=False,
       effect=EFFECT_IMMEDIATE, hidden=True,
       note="Sends loan payouts and records the bank evidence."),
    _D("final_release_directors", "Approvals", "Directors who confirm a final repayment", "str", "", confirmed=False,
       effect=EFFECT_IMMEDIATE, hidden=True,
       note="Comma-separated director ids. Empty means any director."),

    # ── Profiles ─────────────────────────────────────────────────────
    _D("reliability_min_history", "Profiles", "Loans needed before a reliability % shows", "int", "1", confirmed=False,
       effect=EFFECT_IMMEDIATE, min=1, max=20,
       note="Members with less history show 'no history yet' instead of a percentage."),


    # ── Loan payout ──────────────────────────────────────────────────
    _D("payout_mode", "Loan payout", "How an approved loan is paid out", "enum", "treasurer_manual", confirmed=False,
       effect=EFFECT_NEW_LOANS, options=("treasurer_manual", "wallet_credit"), required_for_live=True,
       note="treasurer_manual: the Treasurer sends the money by bank transfer and records the evidence. wallet_credit: the net amount is credited to the borrower's MonieKing wallet."),
    _D("transfer_fee_bps", "Loan payout", "Transfer fee on a payout", "bps", "500", confirmed=False,
       effect=EFFECT_NEW_LOANS, min=0, max=2000, unit="% of the principal", required_for_live=True,
       note="Shown to the borrower in the offer before they accept. Interest is always on the full principal."),
    _D("transfer_fee_payer", "Loan payout", "Who pays the transfer fee", "enum", "borrower", confirmed=False,
       effect=EFFECT_NEW_LOANS, options=("borrower", "cooperative"),
       note="borrower: the fee is taken from the loan, so the borrower receives principal minus fee. cooperative: the borrower receives the full principal."),
    _D("loan_offer_required", "Loan payout", "Borrower must accept the offer", "bool", "true",
       effect=EFFECT_NEW_LOANS, note="After the directors approve, the borrower sees the net amount, fee, interest and schedule and accepts before any money moves."),
    _D("loan_offer_expiry_hours", "Loan payout", "Offer stays open for", "int", "48", effect=EFFECT_IMMEDIATE, min=1, max=720, unit="hours",
       note="If the borrower does not accept in time, the loan closes and every guarantee is released."),
    _D("payout_name_match", "Loan payout", "Account name must match the member", "enum", "hold", confirmed=False,
       effect=EFFECT_IMMEDIATE, options=("hold", "warn", "off"),
       note="hold: a payout to an account whose verified name does not match is held for the directors. warn: only warns the Treasurer. off: no check."),
    _D("payout_evidence_required", "Loan payout", "Treasurer must record bank evidence", "bool", "true",
       effect=EFFECT_IMMEDIATE, note="A transfer reference or receipt link must be entered before a payout counts as paid."),
    _D("payout_executor", "Loan payout", "Who may send the payout", "enum", "any_director", confirmed=False,
       effect=EFFECT_IMMEDIATE, options=("any_director", "treasurer"),
       note="treasurer: only the director with treasurer duty (set in Roles). any_director: any director."),
    _D("payout_executor_not_approver", "Loan payout", "Payout sender cannot be a loan approver", "bool", "false", confirmed=False,
       effect=EFFECT_IMMEDIATE, note="Turn on only when there are at least three directors, otherwise two approving directors would leave nobody to pay."),
    _D("loan_clock_starts", "Loan payout", "Loan clock starts at", "enum", "payout", confirmed=False,
       effect=EFFECT_NEW_LOANS, options=("payout", "approval"), required_for_live=True,
       note="payout: the term, instalments and interest begin on the day the money is actually sent. approval: they begin on the approval day."),
    _D("final_due_rule", "Loan payout", "Overdue charges start", "enum", "after_final_due_date", confirmed=False,
       effect=EFFECT_NEW_LOANS, options=("after_final_due_date", "on_final_due_date"),
       note="after_final_due_date: the day after the final instalment due date (directors' decision). on_final_due_date: one day earlier."),

    # ── Repayment ────────────────────────────────────────────────────
    _D("repay_source", "Repayment", "Repayments are taken from", "enum", "contribution_auto", confirmed=False,
       effect=EFFECT_NEW_LOANS, options=("contribution_auto", "wallet_manual", "member_choice"), required_for_live=True,
       note="contribution_auto: due instalments are deducted automatically from the member's free contribution balance. wallet_manual: the member pays from their wallet. member_choice: the member picks either, per payment."),
    _D("auto_deduct_partial", "Repayment", "Deduct what is available when short", "bool", "true", effect=EFFECT_IMMEDIATE,
       note="On: if the free balance is less than the instalment, the free balance is taken and the rest stays due. Off: nothing is taken unless the full instalment is available."),
    _D("reminder_days_before", "Repayment", "Reminder before an instalment", "int", "3", effect=EFFECT_IMMEDIATE, min=0, max=30, unit="days"),
    _D("withdraw_while_borrowing", "Repayment", "Withdrawing while a loan is running", "enum", "block", confirmed=False,
       effect=EFFECT_IMMEDIATE, options=("block", "keep_cover", "allow"), required_for_live=True,
       note="block: no withdrawal or closing of membership while the member has a loan. keep_cover: only the amount above what the loan still needs. allow: no restriction."),
    _D("final_release_mode", "Repayment", "Guarantee release after a final repayment", "enum", "directors", confirmed=False,
       effect=EFFECT_NEW_LOANS, options=("directors", "automatic"), required_for_live=True,
       note="directors: guarantee money stays locked until the required directors confirm the final repayment. automatic: released as soon as the loan is fully paid."),
    _D("closure_charge_bps", "Repayment", "Closing-membership charge", "bps", "1000", effect=EFFECT_IMMEDIATE, min=0, max=10000, unit="% of the balance paid out"),
    _D("closure_charge_destination", "Repayment", "Closing charge goes to", "enum", "pool_withdrawal", confirmed=False,
       effect=EFFECT_IMMEDIATE, options=("pool_withdrawal", "running_cost"),
       note="pool_withdrawal: the dividend pool (same as an early-withdrawal charge). running_cost: the running-cost fund."),

    # ── Year end ─────────────────────────────────────────────────────
    _D("membership_fee_timing", "Year end", "Membership fee is taken", "enum", "year_end", confirmed=False,
       effect=EFFECT_NEXT_YEAR, options=("year_end", "on_join"),
       note="year_end: at the year-end run, only if the full fee is available. on_join: from the registration payment."),
    _D("dividend_unqualified", "Year end", "Dividend share of members who do not qualify", "enum", "carry_forward", confirmed=False,
       effect=EFFECT_NEXT_YEAR, options=("carry_forward", "redistribute"),
       note="carry_forward: stays in the pool and moves to next year. redistribute: shared among the members who do qualify."),
    _D("dividend_dispute_days", "Year end", "Dividend dispute window", "int", "14", effect=EFFECT_IMMEDIATE, min=1, max=90, unit="days",
       note="Counted from the day the dividend is approved."),
    _D("dividend_accountant_can_approve", "Year end", "Accountant may also approve the dividend", "bool", "false", confirmed=False,
       effect=EFFECT_IMMEDIATE, note="Off keeps the person who prepared the dividend separate from the people who approve it."),

    # ── Requests and recovery ────────────────────────────────────────
    _D("approvals_final_release", "Requests and recovery", "Directors to confirm a final repayment", "int", "2", effect=EFFECT_IMMEDIATE, min=1, max=10),
    _D("approvals_waiver", "Requests and recovery", "Directors to approve waiving a charge", "int", "2", effect=EFFECT_IMMEDIATE, min=1, max=10),
    _D("approvals_restructure", "Requests and recovery", "Directors to approve restructuring a loan", "int", "2", effect=EFFECT_IMMEDIATE, min=1, max=10),
    _D("approvals_write_off", "Requests and recovery", "Directors to approve a write-off", "int", "2", effect=EFFECT_IMMEDIATE, min=1, max=10),
    _D("approvals_expense", "Requests and recovery", "Directors to approve an expense", "int", "2", effect=EFFECT_IMMEDIATE, min=1, max=10),
    _D("approvals_general_debit", "Requests and recovery", "Directors to approve any other debit", "int", "2", effect=EFFECT_IMMEDIATE, min=1, max=10),
    _D("approvals_estate", "Requests and recovery", "Directors to approve a payout to next of kin", "int", "2", effect=EFFECT_IMMEDIATE, min=1, max=10),
    _D("approvals_sweep", "Requests and recovery", "Directors to confirm a sweep of funds", "int", "2", effect=EFFECT_IMMEDIATE, min=1, max=10),
    _D("approvals_golive", "Requests and recovery", "Directors to switch on live funds", "int", "3", confirmed=False, effect=EFFECT_IMMEDIATE, min=1, max=10,
       note="The directors decided on three. Needs at least that many directors with accounts."),
    _D("restructure_reconsent", "Requests and recovery", "Who must agree to a restructure", "enum", "borrower_and_guarantors", confirmed=False,
       effect=EFFECT_IMMEDIATE, options=("borrower_and_guarantors", "borrower_only", "directors_only"),
       note="A restructure that changes the term or amount owed needs the people it affects to agree again."),
    _D("write_off_requires_board_ref", "Requests and recovery", "A write-off needs a Board decision reference", "bool", "true", effect=EFFECT_IMMEDIATE),
    _D("write_off_requires_lawyer", "Requests and recovery", "A write-off needs a lawyer's report", "bool", "true", effect=EFFECT_IMMEDIATE),
    _D("expense_receipt_required", "Requests and recovery", "An expense needs a receipt or reference", "bool", "true", effect=EFFECT_IMMEDIATE),
    _D("recovery_auto_open_days", "Requests and recovery", "Open a recovery case after overdue days", "int", "7", effect=EFFECT_IMMEDIATE, min=0, max=365, unit="days",
       note="0 turns automatic opening off. Directors can always open a case by hand."),
    _D("complaint_response_days", "Requests and recovery", "Complaints answered within", "int", "7", effect=EFFECT_IMMEDIATE, min=1, max=60, unit="days"),

    # ── Safety and go-live ───────────────────────────────────────────
    _D("pilot_cap_enabled", "Safety and go-live", "Pilot cap on total money received", "bool", "true", effect=EFFECT_IMMEDIATE,
       note="While only pilot members can use the cooperative, the total ever paid in is limited."),
    _D("pilot_cap_kobo", "Safety and go-live", "Pilot cap", "kobo", str(500_000 * NAIRA), effect=EFFECT_IMMEDIATE, min=0,
       note="Counts every contribution and registration payment ever received, withdrawals do not reduce it."),
    _D("step_up_required", "Safety and go-live", "Extra confirmation for money actions", "enum", "off", confirmed=False,
       effect=EFFECT_IMMEDIATE, options=("off", "member_money", "all_money"), required_for_live=True,
       note="member_money: the withdrawal password or fingerprint is asked for withdrawals, closing membership, accepting a loan and paying a loan. all_money: also for directors sending a payout, confirming a release or paying a dividend."),
    _D("money_rail", "Safety and go-live", "Where money really moves", "enum", "test_ledger", confirmed=False,
       effect=EFFECT_IMMEDIATE, options=("test_ledger", "wallet"), required_for_live=True,
       note="test_ledger: only the cooperative's own books change. wallet: contributions, withdrawals and loan payouts also move money in the member's MonieKing wallet (only when live funds are on)."),
    _D("coop_account_mode", "Safety and go-live", "Cooperative money is held in", "enum", "single_settlement", confirmed=False,
       effect=EFFECT_IMMEDIATE, options=("single_settlement", "sub_account"), required_for_live=True,
       note="single_settlement: everything stays in the one Monnify settlement account and the app tracks the cooperative's share. sub_account: cooperative money is swept to a separate account (two directors confirm each sweep)."),
    _D("reconciliation_max_age_hours", "Safety and go-live", "Reconciliation must be clean within", "int", "36", effect=EFFECT_IMMEDIATE, min=1, max=720, unit="hours"),

    # ── Test tools (not part of the change flow) ─────────────────────
    _D("test_clock_offset_days", "Access", "Test clock offset", "int", "0",
       effect=EFFECT_IMMEDIATE, min=0, max=3650, hidden=True, readonly=True),
]

BY_KEY: dict[str, SettingDef] = {d.key: d for d in DEFINITIONS}

class SettingError(ValueError):
    pass


def parse_value(d: SettingDef, raw: str):
    """Convert the stored string into the right Python type, validating bounds."""
    raw = "" if raw is None else str(raw).strip()
    if d.kind == "bool":
        if raw.lower() in ("true", "1", "yes", "on"):
            return True
        if raw.lower() in ("false", "0", "no", "off"):
            return False
        raise SettingError(f"{d.label}: must be on or off")
    if d.kind in ("int", "bps", "kobo"):
        try:
            v = int(raw)
        except ValueError:
            raise SettingError(f"{d.label}: must be a whole number")
        if d.min is not None and v < d.min:
            raise SettingError(f"{d.label}: must be at least {d.min}")
        if d.max is not None and v > d.max:
            raise SettingError(f"{d.label}: must be at most {d.max}")
        return v
    if d.kind == "enum":
        if raw not in d.options:
            raise SettingError(f"{d.label}: must be one of {', '.join(d.options)}")
        return raw
    return raw  # str


def normalise_value(d: SettingDef, raw) -> str:
    """Canonical string form for storage (e.g. booleans become 'true'/'false')."""
    v = parse_value(d, raw)
    if d.kind == "bool":
        return "true" if v else "false"
    return str(v)
