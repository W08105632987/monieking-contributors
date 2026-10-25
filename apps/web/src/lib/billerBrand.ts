/**
 * Brand look for billers: logo file (served from /billers/…), a vivid colour and
 * a deeper one for gradients. Matching is by the provider's name as Monnify
 * sends it, so "Ikeja Electric", "IKEDC" and "Ikeja Electricity Distribution
 * Company" all resolve to the same brand. Anything unknown gets a stable
 * colour of its own (same name -> same colour) and an initials badge, so a new
 * provider never shows up broken or blank.
 */
export interface BillerBrand {
  key: string
  label: string
  logo: string | null
  main: string
  deep: string
  on: string
  initials: string
}

interface BrandDef { key: string; label: string; logo: string | null; main: string; deep: string; on?: string; match: string[] }

const E = '/billers/electricity/'
const T = '/billers/tv/'

// Order matters: the first definition whose keyword is found wins.
const BRANDS: BrandDef[] = [
  // Electricity
  { key: 'ekedc',  label: 'Eko Electricity',          logo: E + 'ekedc.png',              main: '#2447C0', deep: '#0C246C', match: ['ekedc'] },
  { key: 'eko',    label: 'Eko Electricity',          logo: E + 'eko_electricity.png',    main: '#1B6BC4', deep: '#0A3A78', match: ['eko'] },
  { key: 'ikedc',  label: 'Ikeja Electric',           logo: E + 'ikedc.png',              main: '#1E6FD9', deep: '#0B3C8C', match: ['ikeja', 'ikedc'] },
  { key: 'aedc',   label: 'Abuja Electricity',        logo: E + 'aedc.png',               main: '#16A34A', deep: '#0C6C24', match: ['aedc', 'abuja'] },
  { key: 'bedc',   label: 'Benin Electricity',        logo: E + 'bedc.png',               main: '#1B6BC4', deep: '#0A3A78', match: ['bedc', 'benin'] },
  { key: 'ibedc',  label: 'Ibadan Electricity',       logo: E + 'ibedc.png',              main: '#2447C0', deep: '#0C2484', match: ['ibedc', 'ibadan'] },
  { key: 'jos',    label: 'Jos Electricity',          logo: E + 'jos_electricity.png',    main: '#2457C5', deep: '#0C3C9C', match: ['jos', 'jedc'] },
  { key: 'kaduna', label: 'Kaduna Electric',          logo: E + 'kaduna_electric.png',    main: '#16A34A', deep: '#0C6B1E', match: ['kaduna', 'kaedco'] },
  { key: 'kano',   label: 'Kano Electricity',         logo: E + 'kano_electricity.png',   main: '#1D4FA8', deep: '#0C3C84', match: ['kano', 'kedco'] },
  { key: 'phed',   label: 'Port Harcourt Electricity', logo: E + 'phed.png',             main: '#FCB40C', deep: '#C98400', on: '#1a1200', match: ['portharcourt', 'phed'] },
  { key: 'yedc',   label: 'Yola Electricity',         logo: E + 'yedc.png',               main: '#1B6FB0', deep: '#0C4A80', match: ['yola', 'yedc'] },
  { key: 'aep',    label: 'AEP',                      logo: E + 'aep.png',                main: '#1E4FA0', deep: '#0C3C84', match: ['aep'] },
  { key: 'genco',  label: 'Genco',                    logo: E + 'genco.png',              main: '#1E3A8A', deep: '#0C246C', match: ['genco'] },
  { key: 'ndp',    label: 'Niger Delta Power',        logo: E + 'niger_delta_power.png',  main: '#2E7D5B', deep: '#1B4D3A', match: ['nigerdelta', 'ndpl'] },
  { key: 'enugu',  label: 'Enugu Electricity',        logo: null,                         main: '#D97706', deep: '#92400E', match: ['enugu', 'eedc'] },
  { key: 'aba',    label: 'Aba Power',                logo: null,                         main: '#0D9488', deep: '#115E59', match: ['aba'] },
  // Cable TV
  { key: 'dstv',      label: 'DStv',      logo: T + 'dstv.png',      main: '#1D7BE0', deep: '#0A4AA6', match: ['dstv'] },
  { key: 'gotv',      label: 'GOtv',      logo: T + 'gotv.png',      main: '#E4262C', deep: '#A3131A', match: ['gotv'] },
  { key: 'startimes', label: 'StarTimes', logo: T + 'startimes.png', main: '#F59E0B', deep: '#B45309', on: '#1a1200', match: ['startimes', 'startime'] },
  { key: 'showmax',   label: 'Showmax',   logo: T + 'showmax.png',   main: '#E91E8C', deep: '#7A0F4D', match: ['showmax'] },
  { key: 'bein',      label: 'beIN Sports', logo: T + 'bein_sports.png', main: '#7C3AED', deep: '#4C1D95', match: ['bein'] },
  { key: 'nta',       label: 'NTA',       logo: T + 'nta.png',       main: '#DC2626', deep: '#7F1D1D', match: ['nta'] },
  { key: 'tvc',       label: 'TVC',       logo: T + 'tvc.png',       main: '#1E3A8A', deep: '#0C1F5C', match: ['tvc'] },
  // Exam bodies (no logo files yet — they get a coloured badge)
  { key: 'jamb',   label: 'JAMB',   logo: null, main: '#0F9D58', deep: '#0B6B3A', match: ['jamb'] },
  { key: 'waec',   label: 'WAEC',   logo: null, main: '#1D4ED8', deep: '#1E3A8A', match: ['waec'] },
  { key: 'neco',   label: 'NECO',   logo: null, main: '#B45309', deep: '#78350F', match: ['neco'] },
  { key: 'nabteb', label: 'NABTEB', logo: null, main: '#7C3AED', deep: '#4C1D95', match: ['nabteb'] },
]

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function hashHue(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h % 360
}

export function initialsOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function matches(def: BrandDef, spaced: string, squashed: string): boolean {
  return def.match.some(token => (token.length <= 4
    ? new RegExp(`\\b${token}\\b`).test(spaced)
    : squashed.includes(token)))
}

export function resolveBrand(name: string): BillerBrand {
  const spaced = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const squashed = spaced.replace(/ /g, '')
  const def = BRANDS.find(b => matches(b, spaced, squashed))
  if (def) {
    return { key: def.key, label: def.label, logo: def.logo, main: def.main, deep: def.deep, on: def.on ?? '#ffffff', initials: initialsOf(def.label) }
  }
  const hue = hashHue(squashed || name)
  return {
    key: `x-${squashed.slice(0, 24) || 'unknown'}`, label: name, logo: null,
    main: hslToHex(hue, 0.62, 0.42), deep: hslToHex(hue, 0.66, 0.24), on: '#ffffff', initials: initialsOf(name),
  }
}

/** Page wash: the whole screen fades into the chosen provider's colour (same idea as the network wash on Airtime). */
export function brandWash(brand: Pick<BillerBrand, 'main'>): string {
  return `linear-gradient(180deg, ${rgba(brand.main, 0.30)} 0%, ${rgba(brand.main, 0.08)} 38%, transparent 70%)`
}

export function brandGradient(brand: Pick<BillerBrand, 'main' | 'deep'>): string {
  return `linear-gradient(135deg, ${brand.main} 0%, ${brand.deep} 100%)`
}

/** The airtime/data networks as brands, so receipts can show them the same way. */
export function networkBrand(network: 'MTN' | 'Airtel' | 'Glo' | '9mobile', main: string, on: string): BillerBrand {
  const file = { MTN: 'mtn', Airtel: 'airtel', Glo: 'glo', '9mobile': '9mobile' }[network]
  return { key: `net-${file}`, label: network, logo: `/networks/${file}.png`, main, deep: main, on, initials: initialsOf(network) }
}
