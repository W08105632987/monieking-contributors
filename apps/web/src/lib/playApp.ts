// The Google Play version of MonieKing is the same website opened inside an Android "Trusted Web Activity".
// Inside it we hide the identity (NIN / BVN / NIMC) services; everyone else sees exactly what they saw before.
//
// How we know we are inside the Play app:
//   - Android sets document.referrer to "android-app://<package>" when the app launches the site, and
//   - the Play wrapper opens the site at /?source=twa as a second signal.
// The answer is remembered for the rest of that app session only (sessionStorage), so the same person opening the
// website in a normal browser tab is never affected.

const KEY = 'mk_play_app'

function read(): string | null {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}
function write(v: string): void {
  try { sessionStorage.setItem(KEY, v) } catch { /* private mode: fall back to detection each time */ }
}

/** Call once, before the app renders. */
export function detectPlayApp(): void {
  try {
    const fromReferrer = (document.referrer || '').startsWith('android-app://')
    const fromParam = new URLSearchParams(window.location.search).get('source') === 'twa'
    if (fromReferrer || fromParam) write('1')
  } catch { /* ignore */ }
}

export function isPlayApp(): boolean {
  return read() === '1'
}

const HIDDEN_CATEGORIES = new Set(['nimc', 'bvn'])
const HIDDEN_PREFIXES = ['nin', 'bvn', 'ipe_clearance', 'ipe', 'nimc']

/** True for a service category ('nimc', 'bvn') or a service code / verify kind ('nin_modification', 'bvn', ...). */
export function isIdentityHiddenKey(key: string | undefined | null): boolean {
  const k = (key || '').toLowerCase().replace(/-/g, '_')
  if (!k) return false
  if (HIDDEN_CATEGORIES.has(k)) return true
  return HIDDEN_PREFIXES.some((p) => k === p || k.startsWith(p + '_'))
}

// The Play app is an ALLOW-LIST: only these service categories exist there (airtime/data and bills such as electricity
// and cable TV). Everything else in the identity-service catalog (NIN, BVN, TIN, CAC, attestation, vendor, ...) and any
// service added in the future stays out of the Play app unless it is added here on purpose.
const PLAY_ALLOWED_CATEGORIES = new Set(['airtime', 'bills'])

/** Inside the Play app keep only the allowed categories; everywhere else return the list untouched. */
export function withoutHiddenInPlayApp<T extends { code: string; category: string }>(list: T[], inPlay: boolean = isPlayApp()): T[] {
  if (!inPlay) return list
  return list.filter((s) => PLAY_ALLOWED_CATEGORIES.has(s.category))
}
