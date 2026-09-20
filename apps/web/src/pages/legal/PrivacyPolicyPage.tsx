import { LegalPageLayout, Section } from './LegalPageLayout'

export default function PrivacyPolicyPage({ onClose }: { onClose?: () => void } = {}) {
  return (
    <LegalPageLayout title="Privacy Policy" effectiveDate="1 September 2026" onClose={onClose}>
      <p className="text-green-500 dark:text-night-300 text-xs mb-6 bg-amber-50 border border-amber-200 rounded-xl p-3">
        This document is a working draft prepared for MonieKing and has not yet been reviewed by a licensed
        Nigerian attorney. It's written to align with the Nigeria Data Protection Act (NDPA) 2023, but should
        be reviewed by qualified counsel and, where applicable, registered with the Nigeria Data Protection
        Commission before being relied upon as a compliant policy.
      </p>

      <Section title="1. What this policy covers">
        <p>
          This Privacy Policy explains what personal data MonieKing collects, why we collect it, who we share
          it with, and the rights you have over it. It applies to everyone who uses the MonieKing app — customers,
          zone officers, directors, and administrators.
        </p>
      </Section>

      <Section title="2. Data we collect">
        <p><strong>At registration:</strong> full name, phone number, login and withdrawal passwords (stored as
        irreversible hashes, never in plain text), bank name, account number and name, next of kin name and
        phone number.</p>
        <p><strong>For identity verification (optional, feature-gated):</strong> your Bank Verification Number
        (BVN) and/or National Identification Number (NIN), submitted directly to our verification partner and
        never stored by us in full, unmasked form.</p>
        <p><strong>Location (optional):</strong> if you grant location permission, we use it for fraud
        prevention and to detect your state for service availability — you can decline this, and declining
        doesn't block account creation.</p>
        <p><strong>Transaction data:</strong> every contribution, withdrawal, wallet transaction, airtime/data/
        bill payment, and identity-service request you make, including amounts and timestamps.</p>
        <p><strong>Usage data:</strong> which pages you visit and what you interact with in the app, collected
        through our own in-house analytics — not shared with or sent to any third-party analytics provider. See
        Section 6.</p>
        <p><strong>Device and technical data:</strong> IP address, device/browser type, and similar technical
        information collected automatically for security and fraud prevention.</p>
      </Section>

      <Section title="3. Why we collect it">
        <ul className="list-disc pl-5 space-y-1">
          <li>To create and operate your account, and to process your contributions, withdrawals, and payments</li>
          <li>To verify your identity where required by law or by a feature you've chosen to use</li>
          <li>To detect and prevent fraud, and to investigate disputes you raise</li>
          <li>To send you transactional SMS and in-app notifications about your account (contributions received, withdrawal status, security codes)</li>
          <li>To comply with our legal and regulatory obligations as a financial services platform</li>
          <li>To understand how the app is used, so we can fix what's broken and improve what isn't</li>
        </ul>
      </Section>

      <Section title="4. Who we share data with">
        <p>We share the minimum data necessary with:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Our payment processing partner</strong> — to hold your wallet balance, issue your virtual account number, and process withdrawals, airtime, data, and bill payments</li>
          <li><strong>Our identity verification partner</strong> — to verify a BVN or NIN you've chosen to submit</li>
          <li><strong>Our SMS provider</strong> — to deliver transactional SMS (contribution confirmations, verification codes) to your phone number</li>
          <li><strong>Zone officers</strong> — see the amount and card details of contributions they personally record on your behalf, and your name/phone number for the customers in their zone; nothing more</li>
          <li><strong>Regulators and law enforcement</strong> — where required by Nigerian law</li>
        </ul>
        <p>We do not sell your personal data to anyone, for any reason.</p>
      </Section>

      <Section title="5. How long we keep it">
        <p>
          We retain your account and transaction data for as long as your account is active, and for a period
          afterward as required by Nigerian financial recordkeeping obligations. If you ask us to delete test or
          duplicate data that isn't subject to a legal retention requirement, we will.
        </p>
      </Section>

      <Section title="6. Analytics">
        <p>
          MonieKing uses its own, self-hosted analytics to understand which pages and features are used — page
          visits and interactions, tied to an anonymous session identifier and, if you're logged in, your
          account. This data stays on our own infrastructure and is never sent to a third-party analytics
          service. It's used only in aggregate, to improve the app — never to build an advertising profile of
          you, because MonieKing doesn't show ads and doesn't share data with anyone for advertising purposes.
        </p>
      </Section>

      <Section title="7. Security">
        <p>
          Your login and withdrawal passwords are stored as irreversible cryptographic hashes — we cannot see
          your actual password, even internally. Sensitive verification data (BVN/NIN) is transmitted securely
          and never stored by us in full. Administrator access to the platform requires a second verification
          step (a one-time SMS code) on every login, not just the first.
        </p>
      </Section>

      <Section title="8. Your rights">
        <p>Under the Nigeria Data Protection Act, you have the right to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Know what personal data we hold about you</li>
          <li>Request a copy of your data</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data, subject to our legal retention obligations as a financial platform</li>
          <li>Withdraw consent for optional data collection (such as location) at any time</li>
        </ul>
        <p>To exercise any of these rights, contact us through the in-app support channel.</p>
      </Section>

      <Section title="9. Children">
        <p>
          MonieKing is not intended for anyone under 18. We don't knowingly collect data from minors.
        </p>
      </Section>

      <Section title="10. Changes to this policy">
        <p>
          If we make a material change to this policy, we'll notify you in the app before it takes effect.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          Questions about this policy, or requests relating to your data, can be sent through the in-app
          support channel, or to the contact details published in the app's About section.
        </p>
      </Section>
    </LegalPageLayout>
  )
}
