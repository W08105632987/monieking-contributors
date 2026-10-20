"""
Plain-language help for every rule on the directors' Rules page.
what    = what the rule means and what it accomplishes
options = what each choice does (enum / on-off rules)
tip     = what to weigh before deciding
"""

PROVISIONAL_EXPLAINED = (
    "Every rule starts with a default so the cooperative can run. A rule marked PROVISIONAL is a placeholder the directors have not yet decided: "
    "it works exactly like a confirmed rule today, but it is a reminder that the Board still owes the cooperative a decision. "
    "A rule marked CONFIRMED has been decided by the required number of directors. "
    "To settle a rule you either change it, or press 'Confirm as it is' to keep today's value and mark it decided. "
    "Both need the same director approvals as any rule change. Before live funds are switched on, the go-live check lists the provisional rules that matter for real money."
)
EFFECT_EXPLAINED = {
    "immediate": "Starts working as soon as enough directors approve.",
    "new_loans": "Starts working for loans created after approval. Loans already running keep the rule they were approved with, so nobody is surprised mid-loan.",
    "next_year": "Approved now but switched on at the start of the next accounting year, so a year's dividend is never calculated with two sets of rules.",
}

B = {"true": "On", "false": "Off"}

HELP: dict[str, dict] = {
    "coop_enabled": {"what": "The master switch for the whole cooperative section.", "options": {"On": "Members and directors can use the cooperative.", "Off": "The cooperative disappears for everyone until switched back on. Money and records stay safe."}},
    "coop_pilot_only": {"what": "Limits the cooperative to the pilot list while you are testing.", "options": {"On": "Only people on the pilot list can see and use it.", "Off": "Every customer can join."}, "tip": "Turn off only when you are ready for the public."},
    "coop_live_funds": {"what": "Switches from test money to real money. It is locked in the preview and is opened through the go-live checklist."},
    "registration_min_kobo": {"what": "The least a person must pay to join. It becomes their first contribution (it is their money, not a fee).", "tip": "A low amount makes joining easy; a higher one filters for committed members."},
    "nin_required": {"what": "Requires a verified NIN before someone can join.", "options": {"On": "Only NIN-verified customers join. Safer against fake accounts.", "Off": "Anyone can join. Easier, but weaker identity checks."}},
    "membership_fee_kobo": {"what": "A one-time joining fee that goes into the running-cost fund. It is not refundable and is not paid again each year.", "tip": "Taken only when the full amount is available in the member's balance."},
    "year_end_month": {"what": "The month the accounting year ends. Dividends are calculated for the year that just closed."},
    "year_end_day": {"what": "The day of that month the accounting year ends."},
    "loan_rate_bps": {"what": "The flat interest charged on a loan, as a % of the amount borrowed. It does not shrink as the borrower repays. Each loan keeps the rate it was approved with.", "tip": "This is the cooperative's main income and it funds the dividend, so it is the most important number to decide."},
    "loan_min_kobo": {"what": "The smallest loan a member may ask for."},
    "loan_max_kobo": {"what": "The largest single loan the cooperative will consider."},
    "loan_term_months": {"what": "The longest time a loan may run, in months. Members may choose shorter."},
    "loan_max_active": {"what": "How many loans one member may have running at once.", "tip": "1 is the safest: a member must finish a loan before taking another."},
    "loan_first_limit_kobo": {"what": "A first-time borrower who asks for more than this is flagged to directors for extra care. It does not block the loan, it triggers a closer look."},
    "loan_cooling_days": {"what": "How long a new member must wait after joining before asking for a first loan. 0 means no waiting.", "tip": "A waiting period protects against people who join only to borrow."},
    "loan_request_expiry_days": {"what": "How long a loan request can wait to be fully guaranteed. After that it expires and every guarantee lock is released."},
    "loan_max_guarantors": {"what": "The most guarantors one loan may have."},
    "cover_pct": {"what": "How much of the loan must be covered by guarantors' locked money, as a % of the principal.", "tip": "100% means every naira borrowed is backed by someone's contribution: very safe, harder to borrow."},
    "guarantor_min_funds_pct": {"what": "A guarantor must have at least this % of the loan free (not locked elsewhere) before they can guarantee. Stops people promising money they do not have."},
    "guarantee_min_kobo": {"what": "The smallest amount one guarantor may commit."},
    "guarantee_min_commit_pct": {"what": "Each guarantor must commit at least this % of the loan, so a loan is not spread across many tiny guarantees. The last guarantor may commit less if that is all that remains."},
    "guarantee_max_kobo": {"what": "The largest amount one guarantor may commit to one loan."},
    "guarantee_max_active": {"what": "How many loans one member may guarantee at the same time."},
    "borrower_funds_count": {"what": "Whether the borrower's own contribution counts toward the required cover.", "options": {"no": "Cover must come from other members only.", "yes": "The borrower's own money can count, so people with big balances need fewer guarantors."}},
    "lock_starts_at": {"what": "When a guarantor's money becomes locked. Today it locks the moment they sign and is released if the loan is rejected, cancelled or expires."},
    "invite_expiry_hours": {"what": "How long a guarantor has to respond to an invitation before it lapses."},
    "overdue_daily_bps": {"what": "The daily charge on a late loan, as a % of the ORIGINAL interest (not the principal) for each day it is late.", "tip": "Choose a figure that encourages on-time repayment without being crushing."},
    "overdue_cap_pct": {"what": "A ceiling on total overdue charges as a % of the original interest. 0 means no ceiling.", "options": {"0": "Charges keep growing every day. Get written legal confirmation before leaving it uncapped."}, "tip": "A cap protects borrowers and is easier to defend legally."},
    "overdue_grace_days": {"what": "Free days after the due date before overdue charges start. 0 means charges start straight away."},
    "early_withdrawal_bps": {"what": "The charge when a member takes money out. It goes into the dividend pool, and the member does not share that year's dividend.", "tip": "This is what makes leaving early costly and protects members who stay."},
    "running_cost_bps": {"what": "The share of realised loan interest kept for running the cooperative (printing, bank charges, support) before the rest is split as dividend."},
    "loss_wait_months": {"what": "How long after recovery has failed before guarantors' locked money may be used to cover a bad loan. Gives time for every other option first."},
    "dividend_contribution_pct": {"what": "How the dividend pool is split between members by their contributions. The rest goes to guarantors by the amount and time their money was locked.", "tip": "More weight on contributions rewards savers; more weight on guarantees rewards people who back others."},
    "dividend_guarantee_pct": {"what": "Always 100% minus the contribution share. Shown for clarity; it cannot be set on its own."},
    "dividend_min_balance_kobo": {"what": "The balance a member must hold to qualify for the dividend."},
    "dividend_min_months": {"what": "How long a member must have been in to qualify for the dividend."},
    "guarantee_share_scope": {"what": "How the guarantors' share is divided. Today it is one pool shared by every guarantor by amount x days locked."},
    "dividend_rounding": {"what": "How leftover kobo from rounding are handed out so the total paid equals the pool exactly."},
    "dividend_payout": {"what": "Where the dividend is paid.", "options": {"wallet": "Into the member's MonieKing wallet to spend or withdraw.", "loan_card": "Onto the member's loan card.", "contribution": "Added to their contribution, so it keeps growing."}},
    "approvals_loan": {"what": "How many directors must approve a loan.", "tip": "2 or more means no single director can lend the cooperative's money alone."},
    "approvals_settings": {"what": "How many directors must approve a rule change. The proposer counts as the first."},
    "approvals_dividend": {"what": "How many directors must approve the yearly dividend before it is paid."},
    "reliability_min_history": {"what": "How many loans a member needs before a reliability % is shown to guarantors. Below that it says 'no history yet' so one late payment does not unfairly define a new member."},
    "payout_mode": {"what": "How an approved loan is actually paid.", "options": {"treasurer_manual": "A director sends the money by bank transfer and records the proof. Safest with a single settlement account.", "wallet_credit": "The money is credited straight to the borrower's wallet with no director step."}},
    "transfer_fee_bps": {"what": "A fee for sending the loan, as a % of the principal. It is shown to the borrower before they accept. Interest is always on the full principal."},
    "transfer_fee_payer": {"what": "Who bears the transfer fee.", "options": {"borrower": "Taken from the loan: the borrower receives principal minus the fee.", "cooperative": "The cooperative absorbs it; the borrower receives the full principal."}},
    "loan_offer_required": {"what": "The borrower must see and accept the final terms (net amount, fee, interest, schedule) after directors approve and before any money is sent."},
    "loan_offer_expiry_hours": {"what": "How long the borrower has to accept. If not accepted in time the loan closes and all guarantees are released."},
    "payout_name_match": {"what": "What happens when the bank account name does not match the member's name.", "options": {"hold": "The payout/withdrawal is held until a director clears it. Safest against sending money to the wrong person.", "warn": "Only shows a warning.", "off": "No check."}},
    "payout_evidence_required": {"what": "The director who sends money must enter the bank transfer reference and a receipt note before it counts as paid. This leaves an audit trail for every naira out. Applies to loan payouts and withdrawals."},
    "payout_executor": {"what": "Who is allowed to send loan payouts and withdrawals.", "options": {"treasurer": "Only the director given treasurer duty on the Roles page.", "any_director": "Any director."}},
    "payout_executor_not_approver": {"what": "Stops the director who approved a loan from also sending its money.", "tip": "Turn on only with three or more directors, otherwise two approvers could leave nobody able to pay."},
    "loan_clock_starts": {"what": "When the loan term, instalment dates and interest begin.", "options": {"payout": "The day the money is actually sent (fair to the borrower).", "approval": "The day the directors approve it, even if sending takes a while."}},
    "final_due_rule": {"what": "When overdue charges begin after the last instalment.", "options": {"after_final_due_date": "The day after the final due date.", "on_final_due_date": "On the final due date itself."}},
    "repay_source": {"what": "Where repayments come from.", "options": {"contribution_auto": "Taken automatically from the member's free contribution on each due date. Simple and reliable.", "wallet_manual": "The member pays from their wallet themselves.", "member_choice": "The member chooses each time."}},
    "auto_deduct_partial": {"what": "What to do when the free balance is less than the instalment.", "options": {"On": "Take what is available and leave the rest due.", "Off": "Take nothing unless the full instalment is available."}},
    "reminder_days_before": {"what": "How many days before an instalment the member is reminded."},
    "withdraw_while_borrowing": {"what": "Whether a member with a loan may withdraw.", "options": {"block": "No withdrawals or closing until the loan is cleared.", "keep_cover": "Only the amount above what the loan still needs.", "allow": "No restriction."}, "tip": "'block' or 'keep_cover' stops people borrowing then emptying their contribution."},
    "withdraw_mode": {"what": "How a withdrawal is paid out.", "options": {"director_payout": "The member requests, the money is held, and a director sends it to the member's bank and marks it paid, or rejects it and the money returns. The member sees every step.", "instant": "The money goes to the member's wallet immediately with no director step."}, "tip": "director_payout suits the pilot: real bank transfers get a human check and a receipt."},
    "final_release_mode": {"what": "When guarantors' money is unlocked after a loan is fully repaid.", "options": {"directors": "Locked until the chosen directors confirm the last repayment.", "automatic": "Unlocked the moment the loan is fully paid."}},
    "closure_charge_bps": {"what": "The charge when a member closes their membership, as a % of the balance paid out."},
    "closure_charge_destination": {"what": "Where the closing charge goes.", "options": {"pool_withdrawal": "The dividend pool.", "running_cost": "The running-cost fund."}},
    "membership_fee_timing": {"what": "When the membership fee is taken.", "options": {"year_end": "At the year-end run, only if the full fee is available.", "on_join": "From the first payment when joining."}},
    "dividend_unqualified": {"what": "What happens to the share of members who do not qualify.", "options": {"carry_forward": "It stays in the pool for next year.", "redistribute": "It is shared among members who do qualify."}},
    "dividend_dispute_days": {"what": "How many days after approval a member may dispute their dividend figure."},
    "dividend_accountant_can_approve": {"what": "Whether the director who prepared the dividend may also approve it.", "options": {"Off": "Preparer and approvers stay separate. Better control.", "On": "The preparer can approve too."}},
    "approvals_final_release": {"what": "Directors needed to confirm a final repayment and unlock guarantors."},
    "approvals_waiver": {"what": "Directors needed to forgive an overdue charge."},
    "approvals_restructure": {"what": "Directors needed to change a running loan's terms."},
    "approvals_write_off": {"what": "Directors needed to write off a loan the borrower cannot repay."},
    "approvals_expense": {"what": "Directors needed to approve spending from the running-cost fund."},
    "approvals_general_debit": {"what": "Directors needed for any other deduction from cooperative funds."},
    "approvals_estate": {"what": "Directors needed to pay a deceased member's balance to their next of kin."},
    "approvals_sweep": {"what": "Directors needed to confirm moving cooperative money to its own bank account."},
    "approvals_golive": {"what": "Directors needed to switch on real money. Needs at least this many directors with accounts."},
    "restructure_reconsent": {"what": "Who must agree again when a restructure changes what is owed.", "options": {"borrower_and_guarantors": "The borrower and every guarantor. Safest.", "borrower_only": "Just the borrower.", "directors_only": "Directors decide alone."}},
    "write_off_requires_board_ref": {"what": "A write-off must cite the Board decision that approved it."},
    "write_off_requires_lawyer": {"what": "A write-off must attach a lawyer's report that recovery has failed."},
    "expense_receipt_required": {"what": "Every expense needs a receipt or reference before it is approved."},
    "recovery_auto_open_days": {"what": "After this many days overdue, a recovery case is opened automatically so someone follows up. 0 turns it off."},
    "complaint_response_days": {"what": "How quickly the directors commit to answering a complaint. Shown to the member and used to flag late replies."},
    "pilot_cap_enabled": {"what": "Limits the total money the cooperative may ever receive during the pilot, to cap risk while testing."},
    "pilot_cap_kobo": {"what": "The pilot ceiling. Counts every contribution ever received; withdrawals do not reduce it."},
    "step_up_required": {"what": "Asks for the withdrawal password before sensitive actions.", "options": {"off": "No extra confirmation.", "member_money": "Members confirm withdrawals, closing, accepting a loan offer and repaying.", "all_money": "Directors also confirm payouts, votes and dividends."}, "tip": "Recommended for live money."},
    "money_rail": {"what": "Whether money really moves.", "options": {"test_ledger": "Only the cooperative's own books change (testing).", "wallet": "Contributions, withdrawals and payouts also move real wallet money."}},
    "coop_account_mode": {"what": "Where cooperative money is physically held.", "options": {"single_settlement": "Everything stays in the one Monnify settlement account; the app tracks the cooperative's share. Simplest for the pilot.", "sub_account": "The cooperative's share is moved to its own bank account in sweeps that directors confirm."}},
    "reconciliation_max_age_hours": {"what": "How recently the books must have balanced cleanly. Go-live is blocked if the last clean check is older than this."},
}


def help_for(key: str) -> dict:
    h = HELP.get(key) or {}
    return {"what": h.get("what", ""), "options": h.get("options") or {}, "tip": h.get("tip", "")}
