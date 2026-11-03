import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A card that turns over to show its back.
 *
 * Why not a real 3D flip (preserve-3d + backface-visibility)? iPhone Safari draws it wrong when the faces have rounded
 * corners, overflow clipping or scrolling content, and needs vendor prefixes React does not add. This version never uses
 * either: the front turns edge-on and fades, then the back turns in from the other edge. It looks like a flip and behaves
 * the same on iPhone, Android and desktop.
 */
export function FlipCard({ front, back, flipped, onToggle, height = 200, backClassName, label }: {
  front: ReactNode; back: ReactNode; flipped: boolean; onToggle: () => void
  height?: number; backClassName?: string; label?: string
}) {
  const half = 0.2
  const face = 'absolute inset-0 rounded-3xl overflow-hidden'
  return (
    <div role="button" tabIndex={0} aria-pressed={flipped} aria-label={label ?? 'Flip card'}
      onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      className="relative w-full cursor-pointer select-none" style={{ height }}>
      <motion.div className={face} initial={false}
        animate={{ rotateY: flipped ? 90 : 0, opacity: flipped ? 0 : 1 }}
        transition={{ duration: half, ease: 'easeIn', delay: flipped ? 0 : half }}
        style={{ transformPerspective: 900, pointerEvents: flipped ? 'none' : 'auto' }}>
        {front}
      </motion.div>
      <motion.div className={cn(face, backClassName)} initial={false}
        animate={{ rotateY: flipped ? 0 : -90, opacity: flipped ? 1 : 0 }}
        transition={{ duration: half, ease: 'easeOut', delay: flipped ? half : 0 }}
        style={{ transformPerspective: 900, pointerEvents: flipped ? 'auto' : 'none' }}>
        {back}
      </motion.div>
    </div>
  )
}
