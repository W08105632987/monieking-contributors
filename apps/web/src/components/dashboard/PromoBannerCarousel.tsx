import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { PromoBanner } from '@/types'
import { isValidPromoExternalUrl } from '@/lib/promoBannerConstants'

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

/* ── Individual slide renderers ─────────────────────────────────────────── */

function GradientSlide({ banner }: { banner: PromoBanner }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl text-left block w-full"
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
    </div>
  )
}

function FullBleedImageSlide({ banner, onImgError }: { banner: PromoBanner; onImgError: () => void }) {
  const focalX = (banner.image_focal_x ?? 0.5) * 100
  const focalY = (banner.image_focal_y ?? 0.5) * 100

  return (
    <div
      className="relative overflow-hidden rounded-2xl text-left block w-full"
      style={{
        background: `linear-gradient(115deg, ${banner.gradient_from} 0%, ${banner.gradient_to} 100%)`,
        minHeight: 108,
      }}
    >
      {/* Full-bleed photo */}
      <img
        src={banner.image_url!}
        alt={banner.title}
        loading="lazy"
        onError={onImgError}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: `${focalX}% ${focalY}%` }}
      />
      {/* Dark gradient scrim for legibility over arbitrary photos */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.30) 50%, rgba(0,0,0,0.04) 100%)',
        }}
      />
      <div className="relative z-10 p-5 flex items-end justify-between h-full" style={{ minHeight: 108 }}>
        <div className="min-w-0 pr-3">
          <p className="text-white font-extrabold text-base leading-tight drop-shadow">{banner.title}</p>
          {banner.subtitle && (
            <p className="text-white/90 text-xs mt-1 leading-snug drop-shadow">{banner.subtitle}</p>
          )}
          {banner.link_type !== 'none' && (
            <div className="flex items-center gap-1 mt-2.5 text-white text-xs font-bold drop-shadow">
              View <ChevronRight className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SplitImageSlide({ banner, onImgError }: { banner: PromoBanner; onImgError: () => void }) {
  const focalX = (banner.image_focal_x ?? 0.5) * 100
  const focalY = (banner.image_focal_y ?? 0.5) * 100

  return (
    <div
      className="relative overflow-hidden rounded-2xl text-left block w-full flex flex-row"
      style={{
        background: `linear-gradient(115deg, ${banner.gradient_from} 0%, ${banner.gradient_to} 100%)`,
        minHeight: 108,
      }}
    >
      {/* Left — text */}
      <div className="flex-1 p-4 flex flex-col justify-center z-10 min-w-0 pr-2">
        <p className="text-white font-extrabold text-sm leading-tight">{banner.title}</p>
        {banner.subtitle && (
          <p className="text-white/80 text-xs mt-1 leading-snug">{banner.subtitle}</p>
        )}
        {banner.link_type !== 'none' && (
          <div className="flex items-center gap-1 mt-2.5 text-white text-xs font-bold">
            View <ChevronRight className="w-3.5 h-3.5" />
          </div>
        )}
      </div>

      {/* Right — image occupies ~42% width */}
      <div className="relative overflow-hidden" style={{ width: '42%', flexShrink: 0 }}>
        <img
          src={banner.image_url!}
          alt={banner.title}
          loading="lazy"
          onError={onImgError}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: `${focalX}% ${focalY}%` }}
        />
      </div>
    </div>
  )
}

/* ── Banner slide with fallback ─────────────────────────────────────────── */
function BannerSlide({ banner }: { banner: PromoBanner }) {
  const [imgBroken, setImgBroken] = useState(false)
  const layout = imgBroken ? 'gradient_only' : (banner.layout_style ?? 'gradient_only')

  if (layout === 'full_bleed_image' && banner.image_url) {
    return <FullBleedImageSlide banner={banner} onImgError={() => setImgBroken(true)} />
  }
  if (layout === 'split_image_text' && banner.image_url) {
    return <SplitImageSlide banner={banner} onImgError={() => setImgBroken(true)} />
  }
  return <GradientSlide banner={banner} />
}

/**
 * OPay-style dashboard carousel: swipeable, auto-advancing every 10s with a
 * fade transition between banners.  Supports three layout styles per banner:
 *   - gradient_only   — original shimmer gradient
 *   - full_bleed_image — photo background with dark scrim + text overlaid
 *   - split_image_text — text left / photo right
 * Falls back to gradient_only if the image URL 404s.
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

  if (isLoading) return <BannerSkeleton />
  if (banners.length === 0 || !banner) return null

  const handleTap = () => {
    if (isDragging) return
    if (banner.link_type === 'internal_route' && banner.link_target) {
      api.post(`/promo-banners/${banner.id}/click`).catch(() => {})
      navigate(banner.link_target)
    } else if (banner.link_type === 'external_url' && banner.link_target) {
      // Final safety check before open — backend already validated, but guard client-side too
      if (isValidPromoExternalUrl(banner.link_target)) {
        api.post(`/promo-banners/${banner.id}/click`).catch(() => {})
        window.open(banner.link_target, '_blank', 'noopener,noreferrer')
      }
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
            className="w-full block"
            style={{ minHeight: 108 }}
          >
            <BannerSlide banner={banner} />
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
