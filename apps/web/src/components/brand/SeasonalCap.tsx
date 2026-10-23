import { useSeason } from '@/hooks/useSeasonal'

/** Santa cap perched on the logo while the Christmas theme is live. Renders inside a `relative` parent. */
export function SeasonalCap({ size }: { size: number }) {
  const season = useSeason()
  if (season !== 'christmas') return null
  const w = Math.round(size * 0.62)
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 48"
      width={w}
      height={Math.round(w * 0.75)}
      className="pointer-events-none absolute z-10 drop-shadow"
      style={{ left: -Math.round(size * 0.12), top: -Math.round(size * 0.34), transform: 'rotate(-14deg)' }}
    >
      <path d="M6 38 C10 14 30 4 50 10 C44 14 40 22 42 38 Z" fill="#dc2626" />
      <path d="M50 10 C58 12 60 20 56 26" fill="none" stroke="#dc2626" strokeWidth="6" strokeLinecap="round" />
      <circle cx="57" cy="28" r="6" fill="#fff" />
      <rect x="2" y="34" width="46" height="11" rx="5.5" fill="#fff" />
    </svg>
  )
}
