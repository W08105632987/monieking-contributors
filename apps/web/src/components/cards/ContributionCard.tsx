import { useState } from 'react'
import { motion } from 'framer-motion'
import { RotateCcw } from 'lucide-react'
import { cn, formatNaira, cardProgress, MONTH_NAMES } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import type { ContributionCard as ICard, CardGrid } from '@/types'

interface ContributionCardProps {
  card: ICard
  grid?: CardGrid
  className?: string
}

export function ContributionCard({ card, grid, className }: ContributionCardProps) {
  const [flipped, setFlipped] = useState(false)
  const progress = cardProgress(card.total_days_contributed)

  return (
    <div className={cn('flip-card-container w-full', className)} style={{ height: '220px' }}>
      <motion.div
        className="flip-card-inner w-full h-full relative"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.55, type: 'spring', stiffness: 200, damping: 25 }}
        style={{ transformStyle: 'preserve-3d' }}
        onClick={() => setFlipped((f) => !f)}
      >
        {/* ── FRONT ── */}
        <div
          className="flip-card-face absolute inset-0 rounded-3xl overflow-hidden cursor-pointer"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="w-full h-full bg-hero-gradient p-5 flex flex-col justify-between relative overflow-hidden">
            {/* Decorative circles */}
            <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-green-700 opacity-40" />
            <div className="absolute -right-2 top-12 w-20 h-20 rounded-full bg-green-600 opacity-25" />
            <div className="absolute right-20 -bottom-6 w-24 h-24 rounded-full bg-green-800 opacity-30" />

            <div className="flex items-start justify-between relative z-10">
              <div>
                <p className="text-green-300 text-xs font-semibold tracking-widest uppercase">
                  MonieKing
                </p>
                <p className="text-green-100 text-xs mt-0.5 font-medium">Contributors</p>
              </div>
              <Badge variant={card.card_type === 'food' ? 'green' : 'copper'} className="text-xs">
                {card.card_type === 'food' ? '🍱 Food' : '📋 Regular'}
              </Badge>
            </div>

            <div className="relative z-10">
              <p className="text-green-400 text-xs font-semibold uppercase tracking-wide mb-1">
                Daily Rate
              </p>
              <p className="text-copper-400 text-3xl font-extrabold tracking-tight">
                {formatNaira(card.rate_kobo)}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div>
                  <p className="text-green-500 text-xs">Contributed</p>
                  <p className="text-white text-sm font-bold">
                    {formatNaira(card.total_contributed_kobo)}
                  </p>
                </div>
                <div className="w-px h-8 bg-green-700" />
                <div>
                  <p className="text-green-500 text-xs">Days saved</p>
                  <p className="text-white text-sm font-bold">
                    {card.total_days_contributed} / 372
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-1 text-green-400">
                  <RotateCcw className="w-3 h-3" />
                  <span className="text-xs">flip</span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 bg-green-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-copper-gradient rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-green-500 text-xs mt-1">{progress}% complete</p>
            </div>
          </div>
        </div>

        {/* ── BACK — 12×31 Grid ── */}
        <div
          className="flip-card-face flip-card-back absolute inset-0 rounded-3xl overflow-hidden cursor-pointer"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div className="w-full h-full bg-card-back border border-green-100 p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <p className="text-green-700 text-xs font-bold uppercase tracking-wide">
                Contribution Grid
              </p>
              <div className="flex items-center gap-2 text-xs text-green-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-green-600 inline-block" /> Filled
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-green-100 inline-block" /> Empty
                </span>
              </div>
            </div>

            {/* Month labels + rows */}
            <div className="flex-1 overflow-hidden">
              <div className="flex gap-0.5 mb-1 ml-6">
                {Array.from({ length: 31 }, (_, i) => (
                  <div
                    key={i}
                    className="flex-1 text-center text-green-400"
                    style={{ fontSize: '5px', lineHeight: 1 }}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              {MONTH_NAMES.map((month, mIdx) => (
                <div key={mIdx} className="flex items-center gap-0.5 mb-0.5">
                  <span
                    className="text-green-600 font-semibold w-5 shrink-0 text-right"
                    style={{ fontSize: '6px' }}
                  >
                    {month}
                  </span>
                  <div className="flex gap-0.5 flex-1">
                    {Array.from({ length: 31 }, (_, dIdx) => {
                      const filled = grid?.[mIdx]?.[dIdx]?.filled ?? false
                      return (
                        <div
                          key={dIdx}
                          className={cn(
                            'flex-1 rounded-sm transition-colors',
                            filled ? 'bg-green-600' : 'bg-green-100',
                          )}
                          style={{ aspectRatio: '1' }}
                          title={`${month} Day ${dIdx + 1}${filled ? ' ✓' : ''}`}
                        />
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-center text-green-400 mt-1" style={{ fontSize: '9px' }}>
              Tap to flip back
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
