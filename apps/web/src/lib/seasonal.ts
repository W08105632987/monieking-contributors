export interface SeasonalConfig { christmas: boolean; new_year: boolean; easter: boolean }
export type Season = 'christmas' | 'newyear' | 'easter' | null
export type ActiveSeason = Exclude<Season, null>

export const DEFAULT_SEASONAL: SeasonalConfig = { christmas: false, new_year: false, easter: false }

/**
 * Which theme is showing right now.
 * Easter (if switched on) wins. Christmas shows when switched on; with the
 * New Year sub-setting on, it turns into New Year decoration from 1 January.
 */
export function activeSeason(cfg: SeasonalConfig, now: Date = new Date()): Season {
  if (cfg.easter) return 'easter'
  if (cfg.christmas) return cfg.new_year && now.getMonth() === 0 ? 'newyear' : 'christmas'
  return null
}

/** Greeting text. The New Year year is always the current one, never hard-coded. */
export function seasonGreeting(season: ActiveSeason, now: Date = new Date()): string {
  switch (season) {
    case 'christmas': return 'Merry Christmas from MonieKing 🎄'
    case 'newyear':   return `Happy New Year ${now.getFullYear()} from MonieKing 🎆`
    case 'easter':    return 'Happy Easter from MonieKing 🐣'
  }
}

export const SEASON_DECOR: Record<ActiveSeason, { items: string[]; greeting: string; hint: string }> = {
  christmas: { items: ['🎁', '🎄', '🔔', '⭐', '🎀'], greeting: seasonGreeting('christmas'), hint: 'Twinkling lights, gentle snow, gifts and ornaments' },
  newyear:   { items: ['✨', '🎆', '🎉', '🥂', '🎇'], greeting: seasonGreeting('newyear'),   hint: 'Fireworks and confetti' },
  easter:    { items: ['🥚', '🐣', '🌷', '🐰', '🌼'], greeting: seasonGreeting('easter'),    hint: 'Painted eggs, bunting, chicks and flowers' },
}

/** Optional artwork slots. Files live in apps/web/public/seasonal/ and may be missing. */
export type SeasonalSlot = 'header' | 'wallet'
export const SEASONAL_IMAGES: Record<ActiveSeason, Partial<Record<SeasonalSlot, string>>> = {
  christmas: { header: '/seasonal/christmas-header.webp', wallet: '/seasonal/christmas-wallet.webp' },
  newyear:   { header: '/seasonal/newyear-header.webp' },
  easter:    { header: '/seasonal/easter-header.webp' },
}
