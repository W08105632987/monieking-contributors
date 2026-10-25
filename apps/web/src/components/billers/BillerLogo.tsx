import { useState } from 'react'
import { cn } from '@/lib/utils'
import { rgba, brandGradient, type BillerBrand } from '@/lib/billerBrand'

/**
 * A provider's round logo. Falls back to a coloured initials badge when there is
 * no logo file for it (or the file fails to load), so nothing ever shows broken.
 * `glow` adds the soft brand-coloured ring used on the selected provider.
 */
export function BillerLogo({ brand, size = 48, glow = false, className }: {
  brand: BillerBrand; size?: number; glow?: boolean; className?: string
}) {
  const [failed, setFailed] = useState(false)
  const shadow = glow ? `0 0 0 3px ${rgba(brand.main, 0.9)}, 0 8px 26px ${rgba(brand.main, 0.5)}` : `0 1px 4px ${rgba('#000000', 0.18)}`

  if (brand.logo && !failed) {
    return (
      <img
        src={brand.logo}
        alt={brand.label}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={cn('rounded-full object-cover bg-white shrink-0', className)}
        style={{ width: size, height: size, boxShadow: shadow }}
      />
    )
  }
  return (
    <div
      aria-label={brand.label}
      className={cn('rounded-full flex items-center justify-center font-extrabold shrink-0 select-none', className)}
      style={{ width: size, height: size, background: brandGradient(brand), color: brand.on, fontSize: size * 0.34, boxShadow: shadow }}
    >
      {brand.initials}
    </div>
  )
}
