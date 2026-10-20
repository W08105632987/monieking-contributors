# MonieKing Cooperative: Rules guide for directors

Read this before setting the rules. Every rule below is on the **Rules** page in the Director console.

## Provisional vs Confirmed

Every rule starts with a default so the cooperative can run. A rule marked PROVISIONAL is a placeholder the directors have not yet decided: it works exactly like a confirmed rule today, but it is a reminder that the Board still owes the cooperative a decision. A rule marked CONFIRMED has been decided by the required number of directors. To settle a rule you either change it, or press 'Confirm as it is' to keep today's value and mark it decided. Both need the same director approvals as any rule change. Before live funds are switched on, the go-live check lists the provisional rules that matter for real money.

**Why there was no way to simply keep a rule?** The old page only let you propose a *new* value, and a proposal equal to the current value was refused. That left provisional rules stuck. Now every provisional rule has a **Confirm as it is** button: it keeps today's value, needs the same director approvals, and marks the rule as decided.

## When a change starts working

- **Immediately**: Starts working as soon as enough directors approve.
- **New loans only**: Starts working for loans created after approval. Loans already running keep the rule they were approved with, so nobody is surprised mid-loan.
- **Next accounting year**: Approved now but switched on at the start of the next accounting year, so a year's dividend is never calculated with two sets of rules.

Rules marked **needed before live** should be decided before real money is switched on.

## Access

### Cooperative section switched on
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** The master switch for the whole cooperative section.
  - *On*: Members and directors can use the cooperative.
  - *Off*: The cooperative disappears for everyone until switched back on. Money and records stay safe.

### Only pilot members can see it
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Limits the cooperative to the pilot list while you are testing.
  - *On*: Only people on the pilot list can see and use it.
  - *Off*: Every customer can join.
- **Think about:** Turn off only when you are ready for the public.

### Live funds
- **Starts as:** Off · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** Switches from test money to real money. It is locked in the preview and is opened through the go-live checklist.

## Membership

### Minimum registration contribution
- **Starts as:** ₦50 · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** The least a person must pay to join. It becomes their first contribution (it is their money, not a fee).
- **Think about:** A low amount makes joining easy; a higher one filters for committed members.

### NIN required to join
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Requires a verified NIN before someone can join.
  - *On*: Only NIN-verified customers join. Safer against fake accounts.
  - *Off*: Anyone can join. Easier, but weaker identity checks.

### One-time membership fee
- **Starts as:** ₦1,000 · **Status:** Confirmed · **Starts working:** Next accounting year
- **What it does:** A one-time joining fee that goes into the running-cost fund. It is not refundable and is not paid again each year.
- **Think about:** Taken only when the full amount is available in the member's balance.

### Accounting year ends (month)
- **Starts as:** 12 · **Status:** Confirmed · **Starts working:** Next accounting year
- **What it does:** The month the accounting year ends. Dividends are calculated for the year that just closed.

### Accounting year ends (day)
- **Starts as:** 10 · **Status:** Confirmed · **Starts working:** Next accounting year
- **What it does:** The day of that month the accounting year ends.

## Loans

### Loan interest rate (flat per loan)
- **Starts as:** 10% · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** The flat interest charged on a loan, as a % of the amount borrowed. It does not shrink as the borrower repays. Each loan keeps the rate it was approved with.
- **Think about:** This is the cooperative's main income and it funds the dividend, so it is the most important number to decide.

### Minimum loan
- **Starts as:** ₦50,000 · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** The smallest loan a member may ask for.

### Maximum loan
- **Starts as:** ₦20,000,000 · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** The largest single loan the cooperative will consider.

### Maximum loan term
- **Starts as:** 6 months · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** The longest time a loan may run, in months. Members may choose shorter.

### Active loans per member
- **Starts as:** 1 · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** How many loans one member may have running at once.
- **Think about:** 1 is the safest: a member must finish a loan before taking another.

### First-loan limit (credit ladder)
- **Starts as:** ₦100,000 · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** A first-time borrower who asks for more than this is flagged to directors for extra care. It does not block the loan, it triggers a closer look.

### Waiting days before a first loan
- **Starts as:** 0 days · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** How long a new member must wait after joining before asking for a first loan. 0 means no waiting.
- **Think about:** A waiting period protects against people who join only to borrow.

### Loan request stays open for
- **Starts as:** 7 days · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** How long a loan request can wait to be fully guaranteed. After that it expires and every guarantee lock is released.

### Maximum guarantors per loan
- **Starts as:** 5 · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** The most guarantors one loan may have.

## Loan payout

### How an approved loan is paid out
- **Starts as:** treasurer_manual · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** How an approved loan is actually paid.
  - *treasurer_manual*: A director sends the money by bank transfer and records the proof. Safest with a single settlement account.
  - *wallet_credit*: The money is credited straight to the borrower's wallet with no director step.

### Transfer fee on a payout
- **Starts as:** 5% · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** A fee for sending the loan, as a % of the principal. It is shown to the borrower before they accept. Interest is always on the full principal.

### Who pays the transfer fee
- **Starts as:** borrower · **Status:** Provisional · **Starts working:** New loans only
- **What it does:** Who bears the transfer fee.
  - *borrower*: Taken from the loan: the borrower receives principal minus the fee.
  - *cooperative*: The cooperative absorbs it; the borrower receives the full principal.

### Borrower must accept the offer
- **Starts as:** On · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** The borrower must see and accept the final terms (net amount, fee, interest, schedule) after directors approve and before any money is sent.

### Offer stays open for
- **Starts as:** 48 hours · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** How long the borrower has to accept. If not accepted in time the loan closes and all guarantees are released.

### Account name must match the member
- **Starts as:** hold · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** What happens when the bank account name does not match the member's name.
  - *hold*: The payout/withdrawal is held until a director clears it. Safest against sending money to the wrong person.
  - *warn*: Only shows a warning.
  - *off*: No check.

### Treasurer must record bank evidence
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** The director who sends money must enter the bank transfer reference and a receipt note before it counts as paid. This leaves an audit trail for every naira out. Applies to loan payouts and withdrawals.

### Who may send the payout
- **Starts as:** any_director · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** Who is allowed to send loan payouts and withdrawals.
  - *treasurer*: Only the director given treasurer duty on the Roles page.
  - *any_director*: Any director.

### Payout sender cannot be a loan approver
- **Starts as:** Off · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** Stops the director who approved a loan from also sending its money.
- **Think about:** Turn on only with three or more directors, otherwise two approvers could leave nobody able to pay.

### Loan clock starts at
- **Starts as:** payout · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** When the loan term, instalment dates and interest begin.
  - *payout*: The day the money is actually sent (fair to the borrower).
  - *approval*: The day the directors approve it, even if sending takes a while.

### Overdue charges start
- **Starts as:** after_final_due_date · **Status:** Provisional · **Starts working:** New loans only
- **What it does:** When overdue charges begin after the last instalment.
  - *after_final_due_date*: The day after the final due date.
  - *on_final_due_date*: On the final due date itself.

## Repayment

### Repayments are taken from
- **Starts as:** contribution_auto · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** Where repayments come from.
  - *contribution_auto*: Taken automatically from the member's free contribution on each due date. Simple and reliable.
  - *wallet_manual*: The member pays from their wallet themselves.
  - *member_choice*: The member chooses each time.

### Deduct what is available when short
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** What to do when the free balance is less than the instalment.
  - *On*: Take what is available and leave the rest due.
  - *Off*: Take nothing unless the full instalment is available.

### Reminder before an instalment
- **Starts as:** 3 days · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** How many days before an instalment the member is reminded.

### Withdrawing while a loan is running
- **Starts as:** block · **Status:** Provisional · **Starts working:** Immediately · **Needed before live**
- **What it does:** Whether a member with a loan may withdraw.
  - *block*: No withdrawals or closing until the loan is cleared.
  - *keep_cover*: Only the amount above what the loan still needs.
  - *allow*: No restriction.
- **Think about:** 'block' or 'keep_cover' stops people borrowing then emptying their contribution.

### How a withdrawal is paid
- **Starts as:** director_payout · **Status:** Provisional · **Starts working:** Immediately · **Needed before live**
- **What it does:** How a withdrawal is paid out.
  - *director_payout*: The member requests, the money is held, and a director sends it to the member's bank and marks it paid, or rejects it and the money returns. The member sees every step.
  - *instant*: The money goes to the member's wallet immediately with no director step.
- **Think about:** director_payout suits the pilot: real bank transfers get a human check and a receipt.

### Guarantee release after a final repayment
- **Starts as:** directors · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** When guarantors' money is unlocked after a loan is fully repaid.
  - *directors*: Locked until the chosen directors confirm the last repayment.
  - *automatic*: Unlocked the moment the loan is fully paid.

### Closing-membership charge
- **Starts as:** 10% · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** The charge when a member closes their membership, as a % of the balance paid out.

### Closing charge goes to
- **Starts as:** pool_withdrawal · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** Where the closing charge goes.
  - *pool_withdrawal*: The dividend pool.
  - *running_cost*: The running-cost fund.

## Guarantees

### Required guarantee cover
- **Starts as:** 100 % of principal · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** How much of the loan must be covered by guarantors' locked money, as a % of the principal.
- **Think about:** 100% means every naira borrowed is backed by someone's contribution: very safe, harder to borrow.

### Guarantor must hold at least
- **Starts as:** 50 % of the loan in free funds · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** A guarantor must have at least this % of the loan free (not locked elsewhere) before they can guarantee. Stops people promising money they do not have.

### Minimum guarantee amount
- **Starts as:** ₦50,000 · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** The smallest amount one guarantor may commit.

### Each guarantor commits at least
- **Starts as:** 50 % of the loan · **Status:** Provisional · **Starts working:** New loans only
- **What it does:** Each guarantor must commit at least this % of the loan, so a loan is not spread across many tiny guarantees. The last guarantor may commit less if that is all that remains.

### Maximum guarantee amount
- **Starts as:** ₦20,000,000 · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** The largest amount one guarantor may commit to one loan.

### Active guarantees per member
- **Starts as:** 10 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** How many loans one member may guarantee at the same time.

### Borrower's own money counts toward cover
- **Starts as:** no · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** Whether the borrower's own contribution counts toward the required cover.
  - *no*: Cover must come from other members only.
  - *yes*: The borrower's own money can count, so people with big balances need fewer guarantors.

### Guarantee money locks when
- **Starts as:** signing · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** When a guarantor's money becomes locked. Today it locks the moment they sign and is released if the loan is rejected, cancelled or expires.

### Guarantor invitation stays open for
- **Starts as:** 48 hours · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** How long a guarantor has to respond to an invitation before it lapses.

## Overdue and charges

### Daily overdue charge
- **Starts as:** 3% · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** The daily charge on a late loan, as a % of the ORIGINAL interest (not the principal) for each day it is late.
- **Think about:** Choose a figure that encourages on-time repayment without being crushing.

### Overdue charge cap
- **Starts as:** 0 % of the original interest (0 = no cap) · **Status:** Provisional · **Starts working:** New loans only · **Needed before live**
- **What it does:** A ceiling on total overdue charges as a % of the original interest. 0 means no ceiling.
  - *0*: Charges keep growing every day. Get written legal confirmation before leaving it uncapped.
- **Think about:** A cap protects borrowers and is easier to defend legally.

### Grace days before overdue
- **Starts as:** 0 days · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** Free days after the due date before overdue charges start. 0 means charges start straight away.

### Early withdrawal charge
- **Starts as:** 10% · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** The charge when a member takes money out. It goes into the dividend pool, and the member does not share that year's dividend.
- **Think about:** This is what makes leaving early costly and protects members who stay.

### Running cost
- **Starts as:** 10% · **Status:** Confirmed · **Starts working:** Next accounting year
- **What it does:** The share of realised loan interest kept for running the cooperative (printing, bank charges, support) before the rest is split as dividend.

### Months before locked funds can be applied as a loss
- **Starts as:** 12 months · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** How long after recovery has failed before guarantors' locked money may be used to cover a bad loan. Gives time for every other option first.

## Dividend

### Contribution share of the pool
- **Starts as:** 70 % · **Status:** Confirmed · **Starts working:** Next accounting year
- **What it does:** How the dividend pool is split between members by their contributions. The rest goes to guarantors by the amount and time their money was locked.
- **Think about:** More weight on contributions rewards savers; more weight on guarantees rewards people who back others.

### Guarantee share of the pool
- **Starts as:** 30 % · **Status:** Confirmed · **Starts working:** Next accounting year
- **What it does:** Always 100% minus the contribution share. Shown for clarity; it cannot be set on its own.

### Qualifying balance
- **Starts as:** ₦100,000 · **Status:** Confirmed · **Starts working:** Next accounting year
- **What it does:** The balance a member must hold to qualify for the dividend.

### Qualifying holding period
- **Starts as:** 6 months · **Status:** Confirmed · **Starts working:** Next accounting year
- **What it does:** How long a member must have been in to qualify for the dividend.

### Guarantee share is paid from
- **Starts as:** pooled · **Status:** Provisional · **Starts working:** Next accounting year · **Needed before live**
- **What it does:** How the guarantors' share is divided. Today it is one pool shared by every guarantor by amount x days locked.

### Rounding of member shares
- **Starts as:** largest_remainder · **Status:** Provisional · **Starts working:** Next accounting year
- **What it does:** How leftover kobo from rounding are handed out so the total paid equals the pool exactly.

### Dividend is paid to
- **Starts as:** wallet · **Status:** Provisional · **Starts working:** Next accounting year · **Needed before live**
- **What it does:** Where the dividend is paid.
  - *wallet*: Into the member's MonieKing wallet to spend or withdraw.
  - *loan_card*: Onto the member's loan card.
  - *contribution*: Added to their contribution, so it keeps growing.

## Year end

### Membership fee is taken
- **Starts as:** year_end · **Status:** Provisional · **Starts working:** Next accounting year
- **What it does:** When the membership fee is taken.
  - *year_end*: At the year-end run, only if the full fee is available.
  - *on_join*: From the first payment when joining.

### Dividend share of members who do not qualify
- **Starts as:** carry_forward · **Status:** Provisional · **Starts working:** Next accounting year
- **What it does:** What happens to the share of members who do not qualify.
  - *carry_forward*: It stays in the pool for next year.
  - *redistribute*: It is shared among members who do qualify.

### Dividend dispute window
- **Starts as:** 14 days · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** How many days after approval a member may dispute their dividend figure.

### Accountant may also approve the dividend
- **Starts as:** Off · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** Whether the director who prepared the dividend may also approve it.
  - *Off*: Preparer and approvers stay separate. Better control.
  - *On*: The preparer can approve too.

## Approvals

### Directors needed to approve a loan
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** New loans only
- **What it does:** How many directors must approve a loan.
- **Think about:** 2 or more means no single director can lend the cooperative's money alone.

### Directors needed to approve a settings change
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** How many directors must approve a rule change. The proposer counts as the first.

### Directors needed to approve the dividend
- **Starts as:** 2 · **Status:** Provisional · **Starts working:** Next accounting year · **Needed before live**
- **What it does:** How many directors must approve the yearly dividend before it is paid.

## Requests and recovery

### Directors to confirm a final repayment
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Directors needed to confirm a final repayment and unlock guarantors.

### Directors to approve waiving a charge
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Directors needed to forgive an overdue charge.

### Directors to approve restructuring a loan
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Directors needed to change a running loan's terms.

### Directors to approve a write-off
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Directors needed to write off a loan the borrower cannot repay.

### Directors to approve an expense
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Directors needed to approve spending from the running-cost fund.

### Directors to approve any other debit
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Directors needed for any other deduction from cooperative funds.

### Directors to approve a payout to next of kin
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Directors needed to pay a deceased member's balance to their next of kin.

### Directors to confirm a sweep of funds
- **Starts as:** 2 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Directors needed to confirm moving cooperative money to its own bank account.

### Directors to switch on live funds
- **Starts as:** 3 · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** Directors needed to switch on real money. Needs at least this many directors with accounts.

### Who must agree to a restructure
- **Starts as:** borrower_and_guarantors · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** Who must agree again when a restructure changes what is owed.
  - *borrower_and_guarantors*: The borrower and every guarantor. Safest.
  - *borrower_only*: Just the borrower.
  - *directors_only*: Directors decide alone.

### A write-off needs a Board decision reference
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** A write-off must cite the Board decision that approved it.

### A write-off needs a lawyer's report
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** A write-off must attach a lawyer's report that recovery has failed.

### An expense needs a receipt or reference
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Every expense needs a receipt or reference before it is approved.

### Open a recovery case after overdue days
- **Starts as:** 7 days · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** After this many days overdue, a recovery case is opened automatically so someone follows up. 0 turns it off.

### Complaints answered within
- **Starts as:** 7 days · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** How quickly the directors commit to answering a complaint. Shown to the member and used to flag late replies.

## Safety and go-live

### Pilot cap on total money received
- **Starts as:** On · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** Limits the total money the cooperative may ever receive during the pilot, to cap risk while testing.

### Pilot cap
- **Starts as:** ₦500,000 · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** The pilot ceiling. Counts every contribution ever received; withdrawals do not reduce it.

### Extra confirmation for money actions
- **Starts as:** off · **Status:** Provisional · **Starts working:** Immediately · **Needed before live**
- **What it does:** Asks for the withdrawal password before sensitive actions.
  - *off*: No extra confirmation.
  - *member_money*: Members confirm withdrawals, closing, accepting a loan offer and repaying.
  - *all_money*: Directors also confirm payouts, votes and dividends.
- **Think about:** Recommended for live money.

### Where money really moves
- **Starts as:** test_ledger · **Status:** Provisional · **Starts working:** Immediately · **Needed before live**
- **What it does:** Whether money really moves.
  - *test_ledger*: Only the cooperative's own books change (testing).
  - *wallet*: Contributions, withdrawals and payouts also move real wallet money.

### Cooperative money is held in
- **Starts as:** single_settlement · **Status:** Provisional · **Starts working:** Immediately · **Needed before live**
- **What it does:** Where cooperative money is physically held.
  - *single_settlement*: Everything stays in the one Monnify settlement account; the app tracks the cooperative's share. Simplest for the pilot.
  - *sub_account*: The cooperative's share is moved to its own bank account in sweeps that directors confirm.

### Reconciliation must be clean within
- **Starts as:** 36 hours · **Status:** Confirmed · **Starts working:** Immediately
- **What it does:** How recently the books must have balanced cleanly. Go-live is blocked if the last clean check is older than this.

## Profiles

### Loans needed before a reliability % shows
- **Starts as:** 1 · **Status:** Provisional · **Starts working:** Immediately
- **What it does:** How many loans a member needs before a reliability % is shown to guarantors. Below that it says 'no history yet' so one late payment does not unfairly define a new member.
