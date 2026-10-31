/**
 * Coin / cash-register chime for money entering the wallet.
 *
 * Synthesised with Web Audio (no asset to ship). Shares the AudioContext and
 * the first-tap unlock from notificationFeedback. Has its own mute switch,
 * default ON. Only credits ever call this: debits never do.
 *
 * Limit: a web app cannot run code, so cannot play this custom sound, while
 * it is fully closed. In that case the phone plays its own push sound.
 */
import { getAudioContext } from '@/lib/notificationFeedback'
import { createCreditTracker } from '@/lib/creditTracker'

const MUTE_KEY = 'monieking-coin-sound-muted'

export function isCoinSoundMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export function setCoinSoundMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* private mode */ }
}

function tone(c: AudioContext, type: OscillatorType, freq: number, start: number, dur: number, peak: number): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

/** Plays the chime now (respecting mute). Never throws. */
export function playCoin(opts: { force?: boolean } = {}): void {
  if (!opts.force && isCoinSoundMuted()) return
  const c = getAudioContext()
  if (!c) return
  try {
    if (c.state === 'suspended') void c.resume().catch(() => {})
    const t = c.currentTime + 0.01
    // "ka-ching": two bright metallic hits (B5 then E6) with a high shimmer tail
    tone(c, 'triangle', 987.8, t, 0.16, 0.2)
    tone(c, 'sine', 1975.5, t, 0.16, 0.08)
    tone(c, 'triangle', 1318.5, t + 0.09, 0.7, 0.22)
    tone(c, 'sine', 2637, t + 0.09, 0.6, 0.1)
    tone(c, 'sine', 3951, t + 0.2, 0.35, 0.05)
    tone(c, 'sine', 5274, t + 0.28, 0.3, 0.03)
    try { navigator.vibrate?.([60, 40, 60]) } catch { /* unsupported */ }
  } catch { /* audio is a nicety, never break the app over it */ }
}

const tracker = createCreditTracker()

/**
 * Report the wallet balance (kobo) you see. Safe to call from any number of
 * components: one shared baseline means one rise = one sound.
 * Returns the credited amount in kobo (0 when nothing came in).
 */
export function registerBalance(kobo: number): number {
  const credited = tracker.registerBalance(kobo)
  if (credited > 0 && tracker.claim()) playCoin()
  return credited
}

/** A "Wallet funded" push arrived while the app is open. */
export function creditFromPush(): void {
  if (tracker.claim()) playCoin()
}

/** Forget the baseline (logout / account switch). */
export function resetCreditTracker(): void {
  tracker.reset()
}
