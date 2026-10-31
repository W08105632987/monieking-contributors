/**
 * Shared motion presets.
 *
 * Rules of the house:
 *  - animate transform / opacity only (compositor friendly, no layout work)
 *  - tweens, not springs, for sheets and overlays: springs overshoot and keep
 *    the main thread busy while they settle, which reads as stutter on phones
 *  - no backdrop-blur on full-screen overlays; a plain dim is far cheaper
 */
import type { Transition, Variants } from 'framer-motion'

/** Apple-ish "expo out" curve: fast start, long gentle settle. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const EASE_IN = [0.4, 0, 1, 1] as const

export const SHEET_DURATION = 0.34
export const SHEET_EXIT_DURATION = 0.24

export const sheetTransition: Transition = { type: 'tween', duration: SHEET_DURATION, ease: EASE_OUT }
export const sheetExitTransition: Transition = { type: 'tween', duration: SHEET_EXIT_DURATION, ease: EASE_IN }

/** Spread onto a motion element: `<motion.div {...sheetMotion} />` */
export const sheetMotion = {
  initial: { y: '100%' },
  animate: { y: 0, transition: sheetTransition },
  exit: { y: '100%', transition: sheetExitTransition },
} as const

/** Dim layer behind a sheet. Plain colour, opacity only. */
export const overlayMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.22, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } },
} as const

/** Centered dialog (desktop modal): scale + fade, no spring. */
export const dialogMotion = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.15, ease: EASE_IN } },
} as const

/** Route/page level transition. */
export const pageMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
} as const

export const pageFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
} as const

/** Staggered lists: parent uses `listContainer`, children `listItem`. */
export const listContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
}
export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } },
}

/** Style hint for elements that are about to animate. Remove once settled. */
export const willAnimate = { willChange: 'transform, opacity' } as const

/** Max pixels/second-ish thresholds used by swipe-to-dismiss. */
export const SWIPE_DISMISS_OFFSET = 110
export const SWIPE_DISMISS_VELOCITY = 600
