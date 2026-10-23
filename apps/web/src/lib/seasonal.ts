export interface SeasonalConfig { christmas: boolean; new_year: boolean; easter: boolean }
export type Season = 'christmas' | 'newyear' | 'easter' | null

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

export const SEASON_DECOR: Record<Exclude<Season, null>, { items: string[]; greeting: string }> = {
  christmas: { items: ['❄️', '🎁', '🎄', '🔔', '⭐', '❄️', '🎀'], greeting: 'Merry Christmas from MonieKing 🎄' },
  newyear:   { items: ['✨', '🎆', '🎉', '🥂', '✨', '🎇'], greeting: 'Happy New Year from MonieKing 🎆' },
  easter:    { items: ['🥚', '🐣', '🌷', '🐰', '🥚', '🌼'], greeting: 'Happy Easter from MonieKing 🐣' },
}
