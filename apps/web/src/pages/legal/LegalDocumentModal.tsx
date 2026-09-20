import { AnimatePresence, motion } from 'framer-motion'
import TermsOfServicePage from './TermsOfServicePage'
import PrivacyPolicyPage from './PrivacyPolicyPage'

interface LegalDocumentModalProps {
  doc: 'terms' | 'privacy' | null
  onClose: () => void
}

/**
 * Shows the Terms of Service / Privacy Policy content in-app, without
 * ever opening a new browsing context — used from the registration
 * form instead of a `target="_blank"` link.
 *
 * Why: this app is a standalone PWA (manifest display: "standalone").
 * target="_blank" links inside an installed standalone PWA are
 * unreliable across platforms — iOS Safari in particular can pop the
 * link open outside the installed app in a window that doesn't fully
 * initialize (scroll and click handlers not attaching correctly is a
 * known symptom), which matches exactly what was being seen: a
 * visually correct page where nothing actually responds. Rather than
 * chase a platform-specific quirk that can't be reproduced or verified
 * here, this sidesteps it entirely — nothing ever leaves the current
 * window, so there's no secondary browsing context left to misbehave.
 * It's also better UX regardless: closing this returns to the
 * registration form exactly as filled in, instead of a fresh tab that
 * either can't get back to it or does so having lost progress.
 */
export function LegalDocumentModal({ doc, onClose }: LegalDocumentModalProps) {
  return (
    <AnimatePresence>
      {doc && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[960] bg-green-50 dark:bg-night-800"
        >
          {doc === 'terms' ? <TermsOfServicePage onClose={onClose} /> : <PrivacyPolicyPage onClose={onClose} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
