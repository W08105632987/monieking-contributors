import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { PromoBanner } from '@/types'
import { isValidPromoExternalUrl } from '@/lib/promoBannerConstants'

/** Skeleton shown while banners (and the first banner's image) are loading.
 *  Reserves exactly the same height so nothing jumps when the real banner appears. */
function BannerSkeleton() {
  return (
    <div className="mb-4">
      <div className="w-full rounded-2xl animate-pulse bg-green-100 dark:bg-night-600" style={{ minHeight: 108 }} />
    </div>
  )
}

const AUTO_ADVANCE_MS = 10_000
const SWIPE_THRESHOLD_PX = 40
const SLIDE_MS = 380
/** Longest we will hold the skeleton waiting for the first banner's picture. */
const FIRST_IMAGE_WAIT_MS = 1_500

function usesImage(b: PromoBanner): boolean {
  return !!b.image_url && (b.layout_style === 'full_bleed_image' || b.layout_style === 'split_image_text')
}

/* ── Image that never "pops": it is already decoded (see preloading below), and
 *    if it is not yet, it fades in instead of appearing abruptly. ─────────────── */
function BannerImg({ src, alt, style, onError }: { src: string; alt: string; style: React.CSSProperties; onError: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const ref = useCallback((el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true) // already cached/decoded: show at once
  }, [])
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={onError}
      className="absolute inset-0 w-full h-full object-cover"
      style={{ ...style, opacity: loaded ? 1 : 0, transition: loaded ? 'opacity 180ms ease-out' : 'none' }}
      draggable={false}
    />
  )
}

/* ── Individual slide renderers ─────────────────────────────────────────── */

function GradientSlide({ banner }: { banner: PromoBanner }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl text-left block w-full h-full"
      style={{ background: `linear-gradient(115deg, ${banner.gradient_from} 0%, ${banner.gradient_to} 100%)`, minHeight: 108 }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.35) 35%, rgba(255,255,255,0.05) 50%, transparent 65%)',
          backgroundSize: '250% 250%',
          animation: 'promo-shine 3.2s ease-in-out infinite',
        }}
      />
      <div className="relative z-10 p-5 flex items-center justify-between h-full">
        <div className="min-w-0 pr-3">
          <p className="text-white font-extrabold text-base leading-tight">{banner.title}</p>
          {banner.subtitle && <p className="text-white/80 text-xs mt-1 leading-snug">{banner.subtitle}</p>}
          {banner.link_type !== 'none' && (
            <div className="flex items-center gap-1 mt-2.5 text-white text-xs font-bold">View <ChevronRight className="w-3.5 h-3.5" /></div>
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
      className="relative overflow-hidden rounded-2xl text-left block w-full h-full"
      style={{ background: `linear-gradient(115deg, ${banner.gradient_from} 0%, ${banner.gradient_to} 100%)`, minHeight: 108 }}
    >
      <BannerImg src={banner.image_url!} alt={banner.title} onError={onImgError} style={{ objectPosition: `${focalX}% ${focalY}%` }} />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.30) 50%, rgba(0,0,0,0.04) 100%)' }}
      />
      <div className="relative z-10 p-5 flex items-end justify-between h-full" style={{ minHeight: 108 }}>
        <div className="min-w-0 pr-3">
          <p className="text-white font-extrabold text-base leading-tight drop-shadow">{banner.title}</p>
          {banner.subtitle && <p className="text-white/90 text-xs mt-1 leading-snug drop-shadow">{banner.subtitle}</p>}
          {banner.link_type !== 'none' && (
            <div className="flex items-center gap-1 mt-2.5 text-white text-xs font-bold drop-shadow">View <ChevronRight className="w-3.5 h-3.5" /></div>
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
      className="relative overflow-hidden rounded-2xl text-left block w-full h-full flex flex-row"
      style={{ background: `linear-gradient(115deg, ${banner.gradient_from} 0%, ${banner.gradient_to} 100%)`, minHeight: 108 }}
    >
      <div className="flex-1 p-4 flex flex-col justify-center z-10 min-w-0 pr-2">
        <p className="text-white font-extrabold text-sm leading-tight">{banner.title}</p>
        {banner.subtitle && <p className="text-white/80 text-xs mt-1 leading-snug">{banner.subtitle}</p>}
        {banner.link_type !== 'none' && (
          <div className="flex items-center gap-1 mt-2.5 text-white text-xs font-bold">View <ChevronRight className="w-3.5 h-3.5" /></div>
        )}
      </div>
      <div className="relative overflow-hidden" style={{ width: '42%', flexShrink: 0 }}>
        <BannerImg src={banner.image_url!} alt={banner.title} onError={onImgError} style={{ objectPosition: `${focalX}% ${focalY}%` }} />
      </div>
    </div>
  )
}

/* ── Banner slide with fallback ─────────────────────────────────────────── */
function BannerSlide({ banner }: { banner: PromoBanner }) {
  const [imgBroken, setImgBroken] = useState(false)
  const layout = imgBroken ? 'gradient_only' : (banner.layout_style ?? 'gradient_only')
  if (layout === 'full_bleed_image' && banner.image_url) return <FullBleedImageSlide banner={banner} onImgError={() => setImgBroken(true)} />
  if (layout === 'split_image_text' && banner.image_url) return <SplitImageSlide banner={banner} onImgError={() => setImgBroken(true)} />
  return <GradientSlide banner={banner} />
}

/** Signed position of slide `i` relative to the current one: 0 = in view, -1 = just left, +1 = just right. */
function slotOffset(i: number, index: number, n: number, dragDir: number): number {
  let d = (((i - index) % n) + n) % n
  if (d > n / 2) d -= n
  if (n === 2 && d === 1 && dragDir > 0) d = -1 // two banners: the other one is on the left while dragging right
  return d
}

/**
 * Dashboard banner carousel: swipeable, auto-advancing every 10s.
 *
 * Built so the picture is ALWAYS there when a banner slides into view:
 *  - every banner image is downloaded and decoded as soon as the list arrives,
 *    long before its turn (no gradient first, picture seconds later);
 *  - all slides stay mounted side by side and slide horizontally, so a banner
 *    that comes into view is already painted (previously only one slide was
 *    mounted at a time and an image started loading only when its slide mounted);
 *  - slides move with the finger while swiping, and cross over with no blank gap
 *    (previously one banner faded fully out, then the next faded in);
 *  - the first banner is held back (skeleton) until its picture is ready, up to
 *    1.5 s, so it never appears as a bare gradient and then changes.
 * Falls back to the gradient if an image URL fails.
 */
export function PromoBannerCarousel() {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [dragPx, setDragPx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [readyUrls, setReadyUrls] = useState<Set<string>>(() => new Set())
  const [holdExpired, setHoldExpired] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const touchStartX = useRef<number | null>(null)
  const touchDeltaX = useRef(0)
  const wasDragged = useRef(false)
  const prevPos = useRef<Record<string, number>>({})
  const viewedBannersRef = useRef<Set<string>>(new Set())

  const { data: banners = [], isLoading } = useQuery({
    queryKey: ['promo-banners-active'],
    queryFn: async () => {
      const { data } = await api.get<PromoBanner[]>('/promo-banners/active')
      return data
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  })
  const n = banners.length

  // Download + decode every banner image up front.
  useEffect(() => {
    let cancelled = false
    const mark = (url: string) => { if (!cancelled) setReadyUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url))) }
    banners.filter(usesImage).forEach((b) => {
      const url = b.image_url!
      const im = new Image()
      im.decoding = 'async'
      im.onload = () => { (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => mark(url)) }
      im.onerror = () => mark(url) // broken image: stop waiting; the slide falls back to its gradient
      im.src = url
    })
    return () => { cancelled = true }
  }, [banners])

  // Upper bound on how long the first banner can be held back.
  useEffect(() => {
    if (n === 0) return
    const t = setTimeout(() => setHoldExpired(true), FIRST_IMAGE_WAIT_MS)
    return () => clearTimeout(t)
  }, [n > 0])

  useEffect(() => { if (index >= n && n > 0) setIndex(0) }, [n, index])

  const isReady = useCallback((b: PromoBanner | undefined) => !b || !usesImage(b) || readyUrls.has(b.image_url!), [readyUrls])

  const goTo = useCallback((next: number) => {
    if (n === 0) return
    setIndex(((next % n) + n) % n)
  }, [n])

  const restartTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (n <= 1) return
    timerRef.current = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % n
        return isReady(banners[next]) ? next : i // never slide in a banner whose picture is not ready yet
      })
    }, AUTO_ADVANCE_MS)
  }, [n, banners, isReady])

  useEffect(() => {
    restartTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [restartTimer])

  const banner = banners[index]

  // Impression event when the displayed banner changes (deduped per session)
  useEffect(() => {
    if (!banner?.id) return
    if (viewedBannersRef.current.has(banner.id)) return
    viewedBannersRef.current.add(banner.id)
    api.post(`/promo-banners/${banner.id}/impression`).catch(() => {})
  }, [banner?.id])

  const firstReady = isReady(banners[0]) || holdExpired
  if (isLoading || (n > 0 && !firstReady)) return <BannerSkeleton />
  if (n === 0 || !banner) return null

  const handleTap = (b: PromoBanner) => {
    if (wasDragged.current) return
    if (b.link_type === 'internal_route' && b.link_target) {
      api.post(`/promo-banners/${b.id}/click`).catch(() => {})
      navigate(b.link_target)
    } else if (b.link_type === 'external_url' && b.link_target) {
      if (isValidPromoExternalUrl(b.link_target)) {
        api.post(`/promo-banners/${b.id}/click`).catch(() => {})
        window.open(b.link_target, '_blank', 'noopener,noreferrer')
      }
    }
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    wasDragged.current = false
    if (timerRef.current) clearInterval(timerRef.current)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current
    if (Math.abs(touchDeltaX.current) > 8) { wasDragged.current = true; setDragging(true) }
    if (wasDragged.current) setDragPx(touchDeltaX.current) // the banner follows the finger
  }
  const onTouchEnd = () => {
    const d = touchDeltaX.current
    touchStartX.current = null
    setDragging(false)
    setDragPx(0)
    if (n > 1) {
      if (d > SWIPE_THRESHOLD_PX) goTo(index - 1)
      else if (d < -SWIPE_THRESHOLD_PX) goTo(index + 1)
    }
    setTimeout(() => { wasDragged.current = false }, 60)
    restartTimer()
  }

  const dragDir = dragPx === 0 ? 0 : Math.sign(dragPx)

  return (
    <div className="mb-4">
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{ display: 'grid', touchAction: 'pan-y' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {banners.map((b, i) => {
          const pos = slotOffset(i, index, n, dragDir)
          const clamped = Math.max(-2, Math.min(2, pos))
          // A slide that wraps from one far side to the other must jump, not sweep across the screen.
          const jumped = Math.abs(clamped - (prevPos.current[b.id] ?? clamped)) > 1
          prevPos.current[b.id] = clamped
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => handleTap(b)}
              aria-hidden={i !== index}
              tabIndex={i === index ? 0 : -1}
              className="w-full block text-left"
              style={{
                gridArea: '1 / 1',
                minHeight: 108,
                transform: `translate3d(calc(${clamped * 100}% + ${dragPx}px), 0, 0)`,
                transition: dragging || jumped ? 'none' : `transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                willChange: 'transform',
              }}
            >
              <BannerSlide banner={b} />
            </button>
          )
        })}
      </div>

      {n > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {banners.map((_, i) => (
            <button
              key={i}
              onClick={() => { goTo(i); restartTimer() }}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{ width: i === index ? 18 : 6, background: i === index ? '#052E16' : '#D1FAE5' }}
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
    </div>
  )
}
