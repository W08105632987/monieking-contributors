import { LegalPageLayout, Section } from './LegalPageLayout'

/** Public page (no login) that Google Play links to as the "how to delete your account" web address. */
export default function DeleteAccountPage() {
  return (
    <LegalPageLayout title="Delete your MonieKing account" effectiveDate="9 November 2026">
      <Section title="Delete it yourself in the app">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Sign in to MonieKing.</li>
          <li>Open <strong>Profile</strong> and scroll to the bottom.</li>
          <li>Tap <strong>Delete my account</strong>, type DELETE, and confirm.</li>
        </ol>
        <p>Before you delete, withdraw any money left in your wallet and wait for pending withdrawals or bill payments to finish. The app will tell you if something is still pending.</p>
      </Section>
      <Section title="If you cannot sign in">
        <p>Contact us through the support option on the sign-in screen, or use the contact details on our <a className="underline" href="/legal/privacy">Privacy Policy</a>, from the phone number you registered with. We will verify it is you and delete the account.</p>
      </Section>
      <Section title="What is deleted, and what is kept">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Deleted:</strong> your name, phone number, email, bank details, next of kin, profile picture, identity verification details and sign-in access.</li>
          <li><strong>Kept without your personal details:</strong> payment and wallet records that Nigerian financial record-keeping rules require us to retain.</li>
        </ul>
      </Section>
    </LegalPageLayout>
  )
}
