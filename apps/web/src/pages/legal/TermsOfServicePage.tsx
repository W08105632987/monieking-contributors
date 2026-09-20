import { LegalPageLayout, Section } from './LegalPageLayout'

export default function TermsOfServicePage({ onClose }: { onClose?: () => void } = {}) {
  return (
    <LegalPageLayout title="Terms of Service" effectiveDate="1 September 2026" onClose={onClose}>
      <p className="text-green-500 dark:text-night-300 text-xs mb-6 bg-amber-50 border border-amber-200 rounded-xl p-3">
        This document is a working draft prepared for MonieKing and has not yet been reviewed by a licensed
        Nigerian attorney. It should be reviewed by qualified legal counsel — particularly for compliance with
        CBN guidelines on payment service provision and the Nigeria Data Protection Act — before being relied
        upon as a binding legal agreement.
      </p>

      <Section title="1. Who these terms cover">
        <p>
          These Terms of Service ("Terms") govern your access to and use of MonieKing — the mobile and web
          application, the officer and director portals, and all related services (together, the "Service") —
          operated by MonieKing ("we", "us", "our"). By creating an account, you agree to these Terms and to our
          Privacy Policy.
        </p>
        <p>
          You must be at least 18 years old, or the age of majority in your jurisdiction, to open a MonieKing
          account.
        </p>
      </Section>

      <Section title="2. What MonieKing is">
        <p>
          MonieKing is a digital contribution-savings platform. Customers make contributions to one or more
          contribution cards — either digitally through the app, or in cash through a zone officer who records
          the contribution on their behalf. Contributions and withdrawals are tracked in your account, and
          funds are held and moved through our licensed payment processing partner.
        </p>
        <p>
          MonieKing also offers optional services including a digital wallet, airtime and data top-up, bill
          payments (electricity, cable TV, and similar), and identity verification services (such as NIN and
          BVN-related services), where available.
        </p>
      </Section>

      <Section title="3. Your account">
        <p>
          You're responsible for the accuracy of the information you provide at registration, including your
          full name, phone number, bank account details, and next of kin information. You're responsible for
          keeping your login password and withdrawal password confidential, and for all activity that happens
          under your account. If you believe your account has been accessed without your permission, contact us
          immediately.
        </p>
        <p>
          We may suspend or close an account that we reasonably believe is being used fraudulently, in breach
          of these Terms, or in a way that puts other users or the platform at risk.
        </p>
      </Section>

      <Section title="4. Contributions, cards, and withdrawals">
        <p>
          Each contribution card has its own contribution rate and history. A contribution made by a zone
          officer on your behalf is recorded against your card and confirmed to you by SMS and in-app
          notification, showing the amount, the card, and the running total — check this against what you
          actually handed over, and let us know immediately if anything doesn't match.
        </p>
        <p>
          Withdrawal requests are subject to review and processing time as described in the app. We may apply a
          withdrawal charge as disclosed in the app at the time of your request. We reserve the right to decline
          or delay a withdrawal where we reasonably suspect fraud, error, or a compliance concern, and will
          communicate with you about it.
        </p>
      </Section>

      <Section title="5. Zone officers">
        <p>
          Zone officers are authorized representatives who may collect cash contributions on your behalf and
          record them on your account. An officer never has access to your login password, your withdrawal
          password, or the ability to move money out of your account. If an officer asks you for either
          password, refuse and report it to us immediately.
        </p>
      </Section>

      <Section title="6. Wallet, airtime, data, and bill payments">
        <p>
          Your MonieKing wallet may be funded via a dedicated virtual account number issued through our
          payment processing partner, or through withdrawals from your contribution cards. Airtime, data, and
          bill payments are fulfilled through third-party billers and network providers; we're not responsible
          for service interruptions caused by those third parties, but we'll help you resolve a payment that
          didn't deliver the service it was meant to.
        </p>
        <p>
          Before confirming any payment, you'll see exactly what will be debited and what your balance will be
          afterward. Once you confirm a payment, it's final unless the underlying service genuinely failed to
          deliver.
        </p>
      </Section>

      <Section title="7. Identity verification (KYC)">
        <p>
          Certain features — including higher transaction limits and some identity-related services — require
          you to complete identity verification, which may include providing your Bank Verification Number
          (BVN) and/or National Identification Number (NIN). This information is submitted securely to our
          verification partners and used solely for verifying your identity, in line with our Privacy Policy and
          applicable law. We do not sell this information.
        </p>
      </Section>

      <Section title="8. Fees">
        <p>
          Any fees — withdrawal charges, transaction charges on airtime/data/bill payments, or fees for
          identity verification services — are disclosed to you in the app before you confirm the relevant
          action. We don't charge hidden fees.
        </p>
      </Section>

      <Section title="9. Disputes">
        <p>
          If you believe a transaction on your account is wrong — a contribution you didn't make, a withdrawal
          you didn't request, or a payment that failed to deliver — raise a dispute through the app as soon as
          possible. We'll investigate and respond; unresolved disputes may be escalated to a director for
          review.
        </p>
      </Section>

      <Section title="10. Prohibited use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use the Service for money laundering, fraud, or any unlawful purpose</li>
          <li>Attempt to access another user's account or data without authorization</li>
          <li>Interfere with or disrupt the Service or its underlying infrastructure</li>
          <li>Provide false information at registration or during identity verification</li>
        </ul>
      </Section>

      <Section title="11. Limitation of liability">
        <p>
          To the maximum extent permitted by law, MonieKing is not liable for indirect, incidental, or
          consequential damages arising from your use of the Service. Nothing in these Terms limits liability
          that cannot be limited under applicable Nigerian law, including in relation to fraud or gross
          negligence on our part.
        </p>
      </Section>

      <Section title="12. Changes to these Terms">
        <p>
          We may update these Terms from time to time. If we make a material change, we'll notify you in the
          app before it takes effect. Continuing to use the Service after a change takes effect means you accept
          the updated Terms.
        </p>
      </Section>

      <Section title="13. Governing law">
        <p>
          These Terms are governed by the laws of the Federal Republic of Nigeria. Any dispute arising from
          these Terms or your use of the Service is subject to the exclusive jurisdiction of the courts of
          Nigeria.
        </p>
      </Section>

      <Section title="14. Contact">
        <p>
          Questions about these Terms can be sent through the in-app support channel, or to the contact details
          published in the app's About section.
        </p>
      </Section>
    </LegalPageLayout>
  )
}
