import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { formatNaira } from '@/lib/utils'
import type { ContributionCard } from '@/types'

const AUTO_ADVANCE_MS = 10_000
const SWIPE_THRESHOLD_PX = 40

export function CardCarousel({ cards }: { cards: ContributionCard[] }) {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const touchStartX = useRef<number | null>(null)
  const touchDeltaX = useRef(0)

  useEffect(() => {
    if (index >= cards.length && cards.length > 0) setIndex(0)
  }, [cards.length, index])

  const restartTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (cards.length <= 1) return
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % cards.length)
    }, AUTO_ADVANCE_MS)
  }

  useEffect(() => {
    restartTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [cards.length])

  if (cards.length === 0) return null

  const card = cards[index]

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    if (timerRef.current) clearInterval(timerRef.current)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current
  }
  const onTouchEnd = () => {
    if (touchDeltaX.current > SWIPE_THRESHOLD_PX) {
      setIndex((i) => (i - 1 + cards.length) % cards.length)
    } else if (touchDeltaX.current < -SWIPE_THRESHOLD_PX) {
      setIndex((i) => (i + 1) % cards.length)
    }
    touchStartX.current = null
    restartTimer()
  }

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <AnimatePresence mode="wait">
        <motion.div
          key={card.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-green-900 dark:text-white text-sm font-bold">
              {card.card_type === 'food' ? 'Food card' : 'Regular'} · {formatNaira(card.rate_kobo)}/day
            </p>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              card.card_type === 'food' ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
            }`}>
              {card.card_type === 'food' ? 'Food' : 'Regular'}
            </span>
          </div>

          <div className="h-2 bg-green-100 dark:bg-night-600 rounded-full overflow-hidden mb-2">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (card.total_days_contributed / 372) * 100)}%`,
                background: card.card_type === 'food' ? '#059669' : '#F59E0B',
              }}
            />
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-green-500 dark:text-night-300">{card.total_days_contributed} days</span>
            <span className="text-green-500 dark:text-night-300">
              {card.card_type === 'food' ? 'Locked' : formatNaira(card.total_contributed_kobo)}
            </span>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => navigate(`/customer/cards/${card.card_number}/contribute`)}
              className="flex-1 bg-green-900 dark:bg-copper-400 text-white dark:text-green-950 text-xs font-bold rounded-full py-2 active:scale-95 transition-all"
            >
              Contribute
            </button>
            <button
              onClick={() => navigate(`/customer/cards/${card.card_number}`)}
              className="flex-1 bg-green-50 dark:bg-night-600 text-green-700 dark:text-night-100 text-xs font-bold rounded-full py-2 active:scale-95 transition-all border border-green-200 dark:border-night-500"
            >
              View card
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {cards.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {cards.map((_, i) => (
            <button
              key={i}
              onClick={() => { setIndex(i); restartTimer() }}
              className="h-1.5 rounded-full transition-all duration-300 bg-[#052E16] dark:bg-copper-400"
              style={{ width: i === index ? 18 : 6, opacity: i === index ? 1 : 0.3 }}
              aria-label={`Go to card ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
