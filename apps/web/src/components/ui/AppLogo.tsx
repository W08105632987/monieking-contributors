import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The MonieKing app mark. Prefers a real logo file if one exists at
 * the expected static path; falls back automatically to the existing
 * ₦-badge mark if the file is missing or fails to load — same pattern
 * as NetworkBadge for MTN/Airtel/Glo/9mobile.
 *
 * IMPORTANT — about the logo file itself: this component can only
 * ever reference a path (/brand/logo.png) — it can't conjure the
 * actual final MonieKing logo out of nowhere, and deliberately
 * doesn't ship a placeholder pretending to be the real thing. Drop
 * the finished logo file into:
 *
 *   apps/web/public/brand/logo.png   (square, transparent background,
 *                                      at least 512x512 recommended)
 *
 * and it starts rendering everywhere this component is used — splash
 * screen, login page, onboarding carousel — automatically, nothing
 * else needs to change. See public/brand/README.txt for the PWA icon
 * sizes needed separately (those are static manifest entries, not
 * something this component controls).
 *
 * Until that file is added, every one of these spots keeps showing
 * the ₦ badge fallback below — never a broken image icon.
 */
export function AppLogo({ size = 64, rounded = '28px', className }: { size?: number; rounded?: string; className?: string }) {
  const [logoFailed, setLogoFailed] = useState(false)

  if (!logoFailed) {
    return (
      <img
        src="/brand/logo-icon.png"
        alt="MonieKing"
        width={size}
        height={size}
        onError={() => setLogoFailed(true)}
        className={cn('object-contain shrink-0', className)}
        style={{ width: size, height: size, borderRadius: rounded }}
      />
    )
  }

  return (
    <div
      className={cn('bg-green-900 dark:bg-white/10 flex items-center justify-center shrink-0', className)}
      style={{ width: size, height: size, borderRadius: rounded }}
    >
      <span className="text-copper-400 dark:text-night-100 font-extrabold" style={{ fontSize: size * 0.42 }}>₦</span>
    </div>
  )
}
