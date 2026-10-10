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
    "Guarantees",
    "Overdue and charges",
    "Dividend",
    "Approvals",
    "Profiles",
]

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
       effect=EFFECT_NEXT_YEAR, min=0, note="Deducted once, at the end of the accounting year (not built in this preview)."),
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
       note="Only after all recovery steps have failed and an authorised decision is recorded (not built in this preview)."),

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
       effect=EFFECT_NEXT_YEAR, options=("wallet", "loan_card"), required_for_live=True,
       note="Not built in this preview: the preview only estimates the dividend."),

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

    # ── Profiles ─────────────────────────────────────────────────────
    _D("reliability_min_history", "Profiles", "Loans needed before a reliability % shows", "int", "1", confirmed=False,
       effect=EFFECT_IMMEDIATE, min=1, max=20,
       note="Members with less history show 'no history yet' instead of a percentage."),

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
