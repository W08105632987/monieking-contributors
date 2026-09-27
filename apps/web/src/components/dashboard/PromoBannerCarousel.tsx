import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { PromoBanner } from '@/types'

/** Skeleton shown while banners are loading — reserves exactly the same height
 *  so downstream content doesn't jump when the real banner appears. */
function BannerSkeleton() {
  return (
    <div className="mb-4">
      <div
        className="w-full rounded-2xl animate-pulse bg-green-100 dark:bg-night-600"
        style={{ minHeight: 108 }}
      />
    </div>
  )
}

const AUTO_ADVANCE_MS = 10_000
const SWIPE_THRESHOLD_PX = 40

/**
 * OPay-style dashboard carousel: swipeable, auto-advancing every 10s with
 * a fade transition between banners, styled gradient banners with a
 * diagonal shine sweep — no image upload needed for v1.
 */
export function PromoBannerCarousel() {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const touchStartX = useRef<number | null>(null)
  const touchDeltaX = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  const { data: banners = [], isLoading } = useQuery({
    queryKey: ['promo-banners-active'],
    queryFn: async () => {
      const { data } = await api.get<PromoBanner[]>('/promo-banners/active')
      return data
    },
    refetchInterval: 120_000,
    retry: false,
  })

  useEffect(() => {
    if (index >= banners.length && banners.length > 0) setIndex(0)
  }, [banners.length, index])

  const restartTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (banners.length <= 1) return
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % banners.length)
    }, AUTO_ADVANCE_MS)
  }

  const viewedBannersRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    restartTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [banners.length])

  const banner = banners[index]

  // Fire impression event when the displayed banner changes (deduped per session)
  useEffect(() => {
    if (!banner?.id) return
    if (viewedBannersRef.current.has(banner.id)) return
    viewedBannersRef.current.add(banner.id)
    api.post(`/promo-banners/${banner.id}/impression`).catch(() => {})
  }, [banner?.id])

  // While the query is pending show a skeleton so nothing jumps
  if (isLoading) return <BannerSkeleton />
  // If the query resolved with zero banners, render nothing
  if (banners.length === 0 || !banner) return null

  const handleTap = () => {
    if (isDragging) return
    if (banner.link_type === 'internal_route' && banner.link_target) {
      api.post(`/promo-banners/${banner.id}/click`).catch(() => {})
      navigate(banner.link_target)
    } else if (banner.link_type === 'external_url' && banner.link_target) {
      api.post(`/promo-banners/${banner.id}/click`).catch(() => {})
      window.open(banner.link_target, '_blank')
    }
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    setIsDragging(false)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current
    if (Math.abs(touchDeltaX.current) > 8) setIsDragging(true)
  }

  const onTouchEnd = () => {
    if (touchDeltaX.current > SWIPE_THRESHOLD_PX) {
      setIndex((i) => (i - 1 + banners.length) % banners.length)
    } else if (touchDeltaX.current < -SWIPE_THRESHOLD_PX) {
      setIndex((i) => (i + 1) % banners.length)
    }
    touchStartX.current = null
    setTimeout(() => setIsDragging(false), 50)
    restartTimer()
  }

  return (
    <motion.div
      className="mb-4"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <AnimatePresence mode="wait">
          <motion.button
            key={banner.id}
            onClick={handleTap}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full relative overflow-hidden rounded-2xl text-left block"
            style={{
              background: `linear-gradient(115deg, ${banner.gradient_from} 0%, ${banner.gradient_to} 100%)`,
              minHeight: 108,
            }}
          >
            {/* Shine sweep */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.35) 35%, rgba(255,255,255,0.05) 50%, transparent 65%)',
                backgroundSize: '250% 250%',
                animation: 'promo-shine 3.2s ease-in-out infinite',
              }}
            />
            <div className="relative z-10 p-5 flex items-center justify-between h-full">
              <div className="min-w-0 pr-3">
                <p className="text-white font-extrabold text-base leading-tight">{banner.title}</p>
                {banner.subtitle && (
                  <p className="text-white/80 text-xs mt-1 leading-snug">{banner.subtitle}</p>
                )}
                {banner.link_type !== 'none' && (
                  <div className="flex items-center gap-1 mt-2.5 text-white text-xs font-bold">
                    View <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            </div>
          </motion.button>
        </AnimatePresence>
      </div>

      {banners.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {banners.map((_, i) => (
            <button
              key={i}
              onClick={() => { setIndex(i); restartTimer() }}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === index ? 18 : 6,
                background: i === index ? '#052E16' : '#D1FAE5',
              }}
              aria-label={`Go to banner ${i + 1}`}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes promo-shine {
          0%   { background-position: 200% 200%; }
          100% { background-position: -50% -50%; }
        }
      `}</style>
    </motion.div>
  )
}
