"""Guarantor agreement (preview). The wording is a DRAFT pending the cooperative's lawyer."""
import hashlib
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.coop.models import CoopContractVersion

VERSION = "1.0-preview"

TICKS = [
    ("read_all", "I have read this whole agreement."),
    ("locked_until_repaid", "I understand my guaranteed money is locked until the loan is fully repaid, and a partial repayment does not release any of it."),
    ("may_lose", "I understand that if the borrower does not pay, I can lose the money I locked, but only after one full year has passed and every recovery step has failed."),
    ("borrower_info", "I understand the borrower and I can see each other's contribution history and phone number for this loan."),
    ("voluntary", "I am doing this freely. Nobody pressured me, and I have not been promised anything outside this agreement."),
]

BODY = """MONIEKING COOPERATIVE: GUARANTOR AGREEMENT AND RISK DISCLOSURE
DRAFT FOR TESTING ONLY. Pending written review by the cooperative's lawyer. Test money only.

Between: {guarantor} (Card {guarantor_card}), the Guarantor,
and: MONIEKING SOLUTION FOR POS AGENT COOPERATIVE SOCIETY LTD., the Cooperative,
for the loan of {borrower} (Card {borrower_card}), the Borrower.

1. THE LOAN
Loan {loan_no}: principal {principal}, interest {interest} ({rate}), total to repay {total}, over {term} month(s) in equal monthly instalments. Full interest is payable even if the Borrower repays early. The Board decides whether any loan is approved, even when it is fully guaranteed.

2. WHAT I AM GUARANTEEING
I guarantee {amount} of this loan. This amount is taken from my free contribution balance and LOCKED the moment I sign.

3. WHEN MY MONEY IS LOCKED AND RELEASED
My locked amount stays locked until the loan is fully repaid, including any interest and overdue charges. Partial repayments do not release any part of it. If the loan is rejected, cancelled or expires before disbursement, it is released at once. Once the loan is fully repaid and verified, it is released.

4. IF THE BORROWER DOES NOT PAY
The loan becomes overdue on the first day of the month after the loan term ends. From then, an overdue charge of {overdue_rate} of the ORIGINAL INTEREST is added for each overdue day{cap_text}. My money stays locked during recovery. It can be applied to a loss only after one full year has passed AND all recovery proceedings have failed AND the Board has made a recorded decision supported by a lawyer's written report. The Borrower's available funds are used first, and only with a recorded, authorised decision. Any remaining loss is shared among guarantors in proportion. If the Borrower dies, this is handled as a separate case under the legally approved procedure; death does not by itself release my locked money or cancel the debt.

5. WHAT I EARN
My share of loan interest and charges is paid through the year-end dividend under the cooperative's rules ({guarantee_pct} of the pool is shared by guarantors, {contribution_pct} by contributors). My dividend weight for this guarantee stops counting from the overdue date. A dividend is not automatic and depends on approval.

6. WHAT I CAN SEE AND WHAT THE BORROWER CAN SEE
I can see the Borrower's contribution history, phone number and loan record for this loan. The Borrower sees only my name as a guarantor.

7. MY LIMITS
I may not guarantee more than {max_active} loans at the same time. I must hold free funds of at least {min_funds_pct}% of the loan.

8. RECORDS
My signature, the time, my device and the exact text of this agreement are saved permanently and cannot be edited.

PENDING WRITTEN CONFIRMATION (not final policy): enforceability of the overdue charge and early-repayment clauses; exact treatment of death; treatment of borrower funds; no cap on the overdue charge.
"""


def render(vars: dict) -> str:
    return BODY.format(**vars)


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def ensure_version(db: AsyncSession) -> CoopContractVersion:
    row = (await db.execute(select(CoopContractVersion).where(CoopContractVersion.version == VERSION))).scalars().first()
    if not row:
        row = CoopContractVersion(id=uuid.uuid4(), version=VERSION, body=BODY)
        db.add(row)
        await db.flush()
    return row
