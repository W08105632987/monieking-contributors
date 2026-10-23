import type { NetworkName } from '@/components/NetworkBadge'

export interface NetworkTheme {
  /** Brand colour used for accents, rings and the primary button. */
  main: string
  /** Text colour that stays readable on `main`. */
  on: string
  /** Page wash behind the content (works in light AND dark — it's a tint over the app surface). */
  wash: string
}

export const NETWORK_THEME: Record<NetworkName, NetworkTheme> = {
  MTN:       { main: '#FFCB05', on: '#1a1500', wash: 'linear-gradient(180deg, rgba(255,203,5,0.30) 0%, rgba(255,203,5,0.08) 38%, transparent 70%)' },
  Glo:       { main: '#00A551', on: '#ffffff', wash: 'linear-gradient(180deg, rgba(0,165,81,0.30) 0%, rgba(0,165,81,0.08) 38%, transparent 70%)' },
  Airtel:    { main: '#ED1C24', on: '#ffffff', wash: 'linear-gradient(180deg, rgba(237,28,36,0.26) 0%, rgba(237,28,36,0.07) 38%, transparent 70%)' },
  '9mobile': { main: '#0B6B3A', on: '#ffffff', wash: 'linear-gradient(180deg, rgba(11,107,58,0.38) 0%, rgba(11,107,58,0.10) 38%, transparent 70%)' },
}

export const NEUTRAL_THEME: NetworkTheme = {
  main: '#14532d', on: '#ffffff',
  wash: 'linear-gradient(180deg, rgba(20,83,45,0.14) 0%, transparent 50%)',
}
