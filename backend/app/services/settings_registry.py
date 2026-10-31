"""Single source of truth for the director's Business Settings page.

Every setting the page shows is declared here once: which group it belongs to, its limits, a plain-language
explanation, and any OTHER place in the app that can change the same value. The page renders from this and
PATCH /settings/{key} validates against it, so the UI and the server can never disagree about a limit.

Kinds
  money     stored in kobo (integer). The UI shows whole naira.
  percent   stored as a whole number 0-100.
  duration  stored as TOTAL MINUTES (integer). The UI shows an hours box and a minutes box.
  count     stored as a whole number.
  days      stored as a whole number of days.
  date      stored as YYYY-MM-DD.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class Link:
    label: str            # where else this can be changed
    path: str             # in-app route
    note: str             # what the director must know before saving


@dataclass(frozen=True)
class Def:
    key: str
    group: str
    label: str
    kind: str
    default: str
    what: str             # what the setting is
    effect: str           # what changing it does, and where in the app
    min: int | None = None
    max: int | None = None
    deferred: bool = False
    links: tuple[Link, ...] = field(default_factory=tuple)


GROUPS: list[dict] = [
    {"id": "contributions", "label": "Contribution Cards", "blurb": "Card rates, Food Card enrollment and card limits."},
    {"id": "wallet", "label": "Wallet, Funding & Withdrawals", "blurb": "Withdrawal fees and limits, processing time, and manual credit limits."},
    {"id": "workers", "label": "Service Workers", "blurb": "What workers earn and how long they have to finish jobs."},
    {"id": "officers", "label": "Affiliated Officers", "blurb": "How much of the company's profit commission officers earn."},
    {"id": "disputes", "label": "Disputes", "blurb": "How long a dispute can wait and how long customers have to raise one."},
    {"id": "verification", "label": "Identity Verification", "blurb": "How long NIN and BVN lookup results are kept."},
    {"id": "sms", "label": "SMS Alerts", "blurb": "What customers are charged per SMS and what SMS costs us."},
]

_SMS_CENTER = Link("SMS Center", "/director/sms",
                   "The SMS Center can also change this fee. Both screens edit the same value, so whichever you save last is the one in force.")
_VERIFICATION = Link("Verification Settings", "/director/verification",
                     "The Verification Settings page edits this same retention time (and also has a 'keep forever' switch that overrides it). Both screens edit the same value.")

DEFS: list[Def] = [
    # ── Contribution cards ────────────────────────────────────────────────
    Def("food_card_rate_kobo", "contributions", "Food Card daily rate", "money", "100000", min=5000, max=100_000_000, deferred=True,
        what="The amount a customer contributes per day on a Food Card.",
        effect="A change never touches cards that are already open. It is scheduled for the next 1 January, and every customer is notified the day before. You can edit or cancel a scheduled change until customers are notified."),
    Def("food_card_open_from", "contributions", "Food Card enrollment opens", "date", "2026-01-01",
        what="The first day customers can open a Food Card.",
        effect="Before this date, customers see enrollment as closed and cannot open a Food Card. It must be on or before the closing date."),
    Def("food_card_open_until", "contributions", "Food Card enrollment closes", "date", "2026-11-30",
        what="The last day customers can open a Food Card.",
        effect="After this date, customers cannot open a new Food Card. Cards already open are not affected."),
    Def("max_food_cards_per_customer", "contributions", "Food Cards per customer", "count", "2", min=1, max=20,
        what="The most Food Cards one customer can hold at the same time.",
        effect="A customer who already has this many active or completed Food Cards is blocked from opening another. Lowering it does not close cards customers already have."),
    Def("min_regular_card_rate_kobo", "contributions", "Minimum Regular Card daily rate", "money", "5000", min=5000, max=100_000_000,
        what="The lowest daily rate a customer can choose when opening a Regular Card.",
        effect="Customers cannot open a Regular Card below this rate. Existing cards keep their rate. Rates must still be a multiple of ₦50."),

    # ── Wallet, funding & withdrawals ─────────────────────────────────────
    Def("wallet_instant_withdrawal_fee_kobo", "wallet", "Instant withdrawal fee", "money", "5000", min=0, max=1_000_000,
        what="The flat fee charged on every instant wallet withdrawal.",
        effect="Applies to every new instant withdrawal straight away. It is taken from the amount the customer withdraws, and customers see it before they confirm."),
    Def("max_instant_withdrawal_kobo", "wallet", "Daily instant withdrawal limit", "money", "5000000", min=10_000, max=500_000_000_00,
        what="The most one customer can withdraw per day through instant wallet withdrawal.",
        effect="A withdrawal that would take the customer over this limit today is declined with a message showing what is left. Card withdrawals are not affected."),
    Def("withdrawal_sla_minutes", "wallet", "Withdrawal processing time (SLA)", "duration", "1440", min=1, max=30 * 1440,
        what="How long a withdrawal request should take to be processed.",
        effect="Pending withdrawals older than this are counted as stuck by the system health check, which raises the alert you see on the health page."),
    Def("max_manual_credit_kobo", "wallet", "Maximum single manual credit", "money", "500000000", min=100_000, max=10_000_000_000,
        what="The largest amount a director can credit to one account in a single manual funding (customer wallets and officer virtual accounts).",
        effect="Any manual credit above this is refused before the PIN is even checked. Lower it to reduce the damage a mistyped amount or a compromised director account can do. It does not limit money customers send in themselves."),

    # ── Service workers ───────────────────────────────────────────────────
    Def("service_worker_default_commission_percent", "workers", "Worker commission", "percent", "10", min=0, max=100,
        what="The percentage of a job's price a service worker earns when they complete it successfully.",
        effect="Applies to jobs resolved from now on; commission already credited does not change. Failed jobs pay no commission and refund the customer in full."),
    Def("service_worker_job_timeout_minutes", "workers", "Job completion time", "duration", "30", min=5, max=1440,
        what="How long a worker has to finish a job after claiming it.",
        effect="When the time is up, the job is taken back and returned to the open pool for another worker. Jobs already waiting on the provider are not returned."),
    Def("service_worker_referral_hold_minutes", "workers", "Referral hold time", "duration", "30", min=1, max=1440,
        what="How long a job referred to a specific worker is kept exclusively for them.",
        effect="Once this passes without the referred worker claiming it, the job drops into the general pool for everyone."),
    Def("manual_services_unclaimed_expiry_days", "workers", "Unclaimed job expiry", "days", "7", min=0, max=90,
        what="How many days a manual service request can sit unclaimed before it expires.",
        effect="Expired requests are cancelled and the customer is refunded in full. Set 0 to switch automatic expiry off."),

    # ── Affiliated officers ───────────────────────────────────────────────
    Def("affiliated_officer_commission_percent", "officers", "Affiliated officer commission", "percent", "30", min=0, max=100,
        what="The share of the company's profit on a withdrawal that goes to the customer's commission officer. The company's profit is the card charge: one day's rate for each month the withdrawal touches.",
        effect="Applies to withdrawals marked paid from now on, for every affiliated officer who has no personal rate of their own. Example: a ₦1,000 charge at 30% pays the officer ₦300 and the company keeps ₦700. Commission already earned does not change. You can give one officer their own rate on their officer page.",
        links=(Link("Officer page", "/director/officers", "An individual officer can have their own rate that overrides this one. Officers with their own rate are not affected by this setting."),)),

    # ── Disputes ──────────────────────────────────────────────────────────
    Def("dispute_sla_minutes", "disputes", "Dispute response time", "duration", "2880", min=60, max=30 * 1440,
        what="How long a dispute can stay open with the worker before it is escalated to you.",
        effect="Open or under-review disputes older than this are moved to the director queue automatically."),
    Def("dispute_eligibility_window_minutes", "disputes", "Dispute eligibility window", "duration", "4320", min=60, max=30 * 1440,
        what="How long after a service is completed a customer can still raise a commission dispute.",
        effect="After this window, customers can no longer dispute that job. It also decides how long worker commission can be held for a dispute."),

    # ── Identity verification ─────────────────────────────────────────────
    Def("verification.retention_minutes", "verification", "Verification result retention", "duration", "1440", min=60, max=168 * 60,
        what="How long the full NIN or BVN lookup result is kept before the personal details are wiped.",
        effect="After this time the stored details are deleted and only the masked summary remains. A shorter time is safer for customer data.",
        links=(_VERIFICATION,)),

    # ── SMS ───────────────────────────────────────────────────────────────
    Def("sms_fee_per_sms_kobo", "sms", "Fee per SMS", "money", "500", min=0, max=100_000,
        what="What a customer who turned on SMS alerts is charged for each SMS sent to them.",
        effect="Charged only when the SMS is sent successfully. A customer's wallet is allowed to go negative for SMS charges.",
        links=(_SMS_CENTER,)),
    Def("sms_provider_cost_per_segment_kobo", "sms", "SMS provider cost per segment", "money", "400", min=0, max=100_000,
        what="What our SMS provider charges us for each SMS segment.",
        effect="Used only to show you the cost of bulk sends in the SMS Center. It does not change what customers are charged.",
        links=(_SMS_CENTER,)),
]

BY_KEY: dict[str, Def] = {d.key: d for d in DEFS}

# Shown on the page as "no longer active" so nobody wonders where they went.
RETIRED: dict[str, str] = {
    "monthly_sms_fee_kobo": "Replaced by the per-SMS fee. Monthly SMS charging has been switched off, so this value did nothing.",
    "large_contribution_threshold_kobo": "The dual-approval step for large contributions was never built, so this value did nothing.",
}


class SettingError(ValueError):
    pass


def validate(d: Def, raw: str) -> str:
    """Return the normalised value to store, or raise SettingError with a message a director can read."""
    s = str(raw).strip()
    if d.kind == "date":
        try:
            date.fromisoformat(s)
        except ValueError:
            raise SettingError(f"{d.label}: enter a valid date.")
        return s
    if not s.lstrip("-").isdigit():
        raise SettingError(f"{d.label}: enter a whole number (no decimals).")
    n = int(s)
    lo, hi = d.min, d.max
    if lo is not None and n < lo or hi is not None and n > hi:
        raise SettingError(f"{d.label}: {_range_text(d)}.")
    if d.key == "min_regular_card_rate_kobo" and n % 5000 != 0:
        raise SettingError(f"{d.label}: must be a multiple of ₦50.")
    return str(n)


def _range_text(d: Def) -> str:
    def show(v: int) -> str:
        if d.kind == "money":
            return f"₦{v / 100:,.0f}"
        if d.kind == "duration":
            h, m = divmod(v, 60)
            return f"{h}h {m}m" if h and m else (f"{h} hour{'s' if h != 1 else ''}" if h else f"{m} minute{'s' if m != 1 else ''}")
        if d.kind == "percent":
            return f"{v}%"
        if d.kind == "days":
            return f"{v} day{'s' if v != 1 else ''}"
        return str(v)
    if d.min is not None and d.max is not None:
        return f"must be between {show(d.min)} and {show(d.max)}"
    return f"must be at least {show(d.min)}" if d.min is not None else f"must be at most {show(d.max)}"  # type: ignore[arg-type]


def to_public(d: Def, value: str | None, updated_at=None) -> dict:
    return {
        "key": d.key, "group": d.group, "label": d.label, "kind": d.kind, "value": value if value is not None else d.default,
        "default": d.default, "min": d.min, "max": d.max, "deferred": d.deferred, "what": d.what, "effect": d.effect,
        "links": [{"label": l.label, "path": l.path, "note": l.note} for l in d.links], "updated_at": updated_at,
    }
