import { useEffect, useState } from 'react'
import { useSeason } from '@/hooks/useSeasonal'
import { SEASONAL_IMAGES, type SeasonalSlot } from '@/lib/seasonal'
import { cn } from '@/lib/utils'

// Remember results so a missing file is probed once, not on every render/mount.
const status = new Map<string, 'ok' | 'missing'>()

function useImageAvailable(src: string | undefined): boolean {
  const [ok, setOk] = useState(() => !!src && status.get(src) === 'ok')
  useEffect(() => {
    if (!src) { setOk(false); return }
    const known = status.get(src)
    if (known) { setOk(known === 'ok'); return }
    let alive = true
    const img = new Image()
    img.onload = () => { status.set(src, 'ok'); if (alive) setOk(true) }
    img.onerror = () => { status.set(src, 'missing'); if (alive) setOk(false) }
    img.src = src
    return () => { alive = false }
  }, [src])
  return ok
}

/**
 * Optional seasonal artwork slot. Renders the image for the live season only if
 * the file exists in public/seasonal/; otherwise renders nothing (the CSS/SVG
 * decoration carries the theme). Purely decorative and never intercepts taps.
 */
export function SeasonalArt({ slot, className }: { slot: SeasonalSlot; className?: string }) {
  const season = useSeason()
  const src = season ? SEASONAL_IMAGES[season][slot] : undefined
  const ok = useImageAvailable(src)
  if (!src || !ok) return null
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      loading="lazy"
      onError={() => { status.set(src, 'missing') }}
      className={cn('mk-art pointer-events-none', className)}
    />
  )
}
