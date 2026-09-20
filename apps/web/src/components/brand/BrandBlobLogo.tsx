import { cn } from '@/lib/utils'

interface BrandBlobLogoProps {
  /** Desired rendered height in pixels (default: 36) */
  height?: number
  /** Alternative alias for height */
  size?: number
  className?: string
  /** Whether to completely hide the splat/blob (e.g. on Register page or already green backgrounds) */
  hideBlob?: boolean
  /** Whether to render as an interactive link or plain element */
  onClick?: () => void
}

/**
 * BrandBlobLogo
 * Renders the official MonieKing full logo encased inside an energetic
 * Nickelodeon-inspired organic emerald green splat/splash badge.
 * 
 * Rules:
 * 1. Modeled after the Nickelodeon splat: fluid, rounded bulbous droplet lobes radiating outwards.
 * 2. On Dark Mode: The green splat automatically disappears (`dark:hidden`), rendering the crisp white logo directly.
 * 3. On Register Page (or via `hideBlob` prop): The splat is hidden since the background is already deep forest green.
 */
export function BrandBlobLogo({ height, size, className, hideBlob = false, onClick }: BrandBlobLogoProps) {
  const effectiveHeight = height ?? size ?? 36
  // Aspect ratio accommodates the radiating splash lobes comfortably
  const computedWidth = Math.round(effectiveHeight * 3.1)

  return (
    <div
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center justify-center shrink-0 select-none transition-all',
        onClick && 'cursor-pointer active:scale-95 transition-transform',
        className
      )}
      style={{
        height: `${effectiveHeight}px`,
        width: hideBlob ? 'auto' : undefined,
        minWidth: hideBlob ? undefined : `${computedWidth}px`,
      }}
      aria-label="MonieKing"
    >
      {/* ── Nickelodeon-Inspired Organic Green Splat / Splash SVG ── */}
      {/* Disappears automatically in dark mode (dark:hidden) or when hideBlob is true */}
      {!hideBlob && (
        <svg
          viewBox="0 0 520 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute inset-0 w-full h-full drop-shadow-md pointer-events-none transition-opacity duration-300 dark:hidden"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="mk-splat-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#042a14" />
              <stop offset="45%" stopColor="#064e3b" />
              <stop offset="85%" stopColor="#059669" />
              <stop offset="100%" stopColor="#042a14" />
            </linearGradient>
            <filter id="mk-splat-glow" x="-8%" y="-12%" width="116%" height="124%">
              <feDropShadow dx="0" dy="2.5" stdDeviation="3" floodColor="#000000" floodOpacity="0.22" />
            </filter>
          </defs>

          {/* Main Nickelodeon-style Splat Shape with bulbous fluid droplet lobes */}
          <path
            d="M 105,58
               C 102,42 96,24 110,16 C 122,8 132,24 135,46
               C 142,34 152,14 168,10 C 184,6 190,26 194,48
               C 204,36 218,22 232,18 C 245,14 250,28 252,50
               C 264,32 278,12 296,8 C 314,4 320,24 322,46
               C 334,30 348,18 362,15 C 378,12 384,28 385,50
               C 398,38 418,26 432,32 C 445,38 440,56 434,68
               C 455,60 482,66 494,80 C 506,95 496,112 476,118
               C 492,128 496,145 486,155 C 474,166 455,158 440,146
               C 442,160 435,178 420,185 C 405,192 392,176 385,158
               C 374,174 358,194 340,196 C 322,198 314,180 308,160
               C 298,176 282,192 265,193 C 248,194 242,178 238,158
               C 225,176 208,195 190,196 C 172,197 166,178 162,158
               C 150,174 132,190 116,188 C 100,186 96,170 95,152
               C 80,166 60,172 48,162 C 36,152 46,134 58,122
               C 38,126 18,118 10,102 C 2,86 16,72 38,72
               C 26,62 30,42 46,36 C 62,30 75,48 85,62
               C 92,60 98,59 105,58 Z"
            fill="url(#mk-splat-grad)"
            filter="url(#mk-splat-glow)"
          />

          {/* Flying detached micro-droplets characteristic of the Nickelodeon splash badge */}
          <circle cx="452" cy="22" r="7" fill="url(#mk-splat-grad)" />
          <circle cx="505" cy="62" r="5" fill="url(#mk-splat-grad)" />
          <circle cx="468" cy="180" r="6" fill="url(#mk-splat-grad)" />
          <circle cx="28" cy="145" r="6" fill="url(#mk-splat-grad)" />
          <circle cx="68" cy="20" r="5.5" fill="url(#mk-splat-grad)" />

          {/* High-gloss organic highlight rim */}
          <path
            d="M 112,48
               C 125,25 140,25 152,42
               M 175,20
               C 188,14 196,28 200,45
               M 298,18
               C 310,14 318,26 322,42
               M 445,82
               C 475,85 475,102 458,112"
            stroke="rgba(110, 231, 183, 0.45)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>
      )}

      {/* ── Official Company Logo ── */}
      <img
        src="/brand/logo.png"
        alt="MonieKing"
        className="relative z-10 w-auto object-contain pointer-events-none"
        style={{
          height: `${Math.round(effectiveHeight * (hideBlob ? 0.95 : 0.72))}px`,
          maxHeight: `${Math.round(effectiveHeight * (hideBlob ? 1.0 : 0.78))}px`,
        }}
        loading="eager"
      />
    </div>
  )
}
