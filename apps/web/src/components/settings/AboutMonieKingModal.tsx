import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen'

interface AboutMonieKingModalProps {
  open: boolean
  onClose: () => void
}

/**
 * "About MonieKing" — opened manually from Profile. Renders the exact
 * same OnboardingScreen used pre-login (untouched — see that file's
 * own header comment for why).
 *
 * OPEN QUESTION, not decided here: OnboardingScreen's own last-slide
 * buttons ("Create your account" / "I already have an account") both
 * navigate away to Register/Login — which makes sense pre-login, but
 * is an odd thing to offer someone who already has an account and is
 * already signed in, reading this from their Profile page. The
 * earlier spec for this modal was a single "Get Started" that just
 * closes it and returns to Profile — that would need a small variation
 * on the last slide, which means either touching OnboardingScreen.tsx
 * (not doing that without being told to) or forking a copy of it for
 * this one context. Left as-is for now — an external "X" close button
 * added here in the wrapper (not inside OnboardingScreen.tsx) so this
 * is at least fully closable in the meantime.
 */
export function AboutMonieKingModal({ open, onClose }: AboutMonieKingModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="onboarding-unscaled fixed inset-0 z-[950]"
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-6 right-6 z-[10] w-9 h-9 bg-black/10 dark:bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center active:scale-95 transition-all"
          >
            <X className="w-4 h-4 text-green-900 dark:text-white" />
          </button>
          <OnboardingScreen />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
