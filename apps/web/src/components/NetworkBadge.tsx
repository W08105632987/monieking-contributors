import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Network branding. Prefers a real official logo file if one exists at
 * the expected static path; falls back automatically to a clean
 * brand-colored initial badge if the file is missing or fails to load.
 *
 * IMPORTANT — about the logo files themselves: this component can only
 * ever reference a path (/networks/<name>.png) — it cannot conjure an
 * authentic MTN/Airtel/Glo/9mobile logo file out of nowhere, and
 * deliberately doesn't ship a placeholder pretending to be one. Drop
 * the real, licensed logo files you're cleared to use into
 * apps/web/public/networks/ using the filenames below, and they'll
 * start rendering automatically — nothing else needs to change.
 *
 *   apps/web/public/networks/mtn.png
 *   apps/web/public/networks/airtel.png
 *   apps/web/public/networks/glo.png
 *   apps/web/public/networks/9mobile.png
 *
 * Until a given file is added, that network keeps showing the
 * colored-badge fallback below — never a broken image icon.
 */
export type NetworkName = 'MTN' | 'Airtel' | 'Glo' | '9mobile'

const NETWORK_STYLE: Record<NetworkName, { bg: string; text: string; label: string; logoFile: string }> = {
  MTN:      { bg: '#FFCB05', text: '#000000', label: 'MTN',     logoFile: 'mtn.png' },
  Airtel:   { bg: '#ED1C24', text: '#FFFFFF', label: 'airtel',  logoFile: 'airtel.png' },
  Glo:      { bg: '#00A551', text: '#FFFFFF', label: 'glo',     logoFile: 'glo.png' },
  '9mobile': { bg: '#00A99D', text: '#FFFFFF', label: '9mobile', logoFile: '9mobile.png' },
}

export function NetworkBadge({ network, size = 40, className }: { network: NetworkName; size?: number; className?: string }) {
  const style = NETWORK_STYLE[network]
  const [logoFailed, setLogoFailed] = useState(false)

  if (!logoFailed) {
    return (
      <img
        src={`/networks/${style.logoFile}`}
        alt={network}
        width={size}
        height={size}
        onError={() => setLogoFailed(true)}
        className={cn('rounded-full object-contain bg-white shrink-0', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className={cn('rounded-full flex items-center justify-center font-extrabold shrink-0', className)}
      style={{ width: size, height: size, backgroundColor: style.bg, color: style.text, fontSize: size * 0.26 }}
    >
      {network === '9mobile' ? '9' : style.label.slice(0, network === 'MTN' ? 3 : 2).toUpperCase()}
    </div>
  )
}

export const ALL_NETWORKS: NetworkName[] = ['MTN', 'Airtel', 'Glo', '9mobile']
