/**
 * A short original Christmas jingle (about 7 seconds), synthesised in the browser with soft bell tones —
 * no audio file to download. Played once per person per year, on the first login while the Christmas
 * theme is switched on.
 */
export interface JingleNote { beat: number; len: number; hz: number }

const C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880, B5 = 987.77, C6 = 1046.5
export const BEAT_SECONDS = 0.4

export const JINGLE_NOTES: JingleNote[] = [
  { beat: 0, len: 0.5, hz: E5 }, { beat: 0.5, len: 0.5, hz: G5 }, { beat: 1, len: 0.5, hz: C6 }, { beat: 1.5, len: 0.5, hz: G5 },
  { beat: 2, len: 1, hz: E5 }, { beat: 3, len: 1, hz: G5 },
  { beat: 4, len: 0.5, hz: D5 }, { beat: 4.5, len: 0.5, hz: F5 }, { beat: 5, len: 0.5, hz: A5 }, { beat: 5.5, len: 0.5, hz: F5 },
  { beat: 6, len: 1, hz: D5 }, { beat: 7, len: 1, hz: F5 },
  { beat: 8, len: 0.5, hz: E5 }, { beat: 8.5, len: 0.5, hz: G5 }, { beat: 9, len: 0.5, hz: C6 }, { beat: 9.5, len: 0.5, hz: E5 },
  { beat: 10, len: 0.5, hz: B5 }, { beat: 10.5, len: 0.5, hz: A5 }, { beat: 11, len: 1, hz: G5 },
  { beat: 12, len: 0.5, hz: E5 }, { beat: 12.5, len: 0.5, hz: G5 }, { beat: 13, len: 1, hz: C6 },
  { beat: 14, len: 2, hz: C6 }, { beat: 14, len: 2, hz: G5 }, { beat: 14, len: 2, hz: E5 }, { beat: 14, len: 2, hz: C5 },
]

const TAIL_SECONDS = 1.2
export function jingleDurationSeconds(): number {
  const end = Math.max(...JINGLE_NOTES.map((n) => n.beat + n.len))
  return end * BEAT_SECONDS + TAIL_SECONDS
}

const playedKey = (userId: string, year: number) => `mk-jingle-${userId}-${year}`

/** True when this person has not yet heard this year's jingle. Storage problems never block the app. */
export function shouldPlayJingle(userId: string | undefined, year: number, storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  if (!userId) return false
  try { return storage?.getItem(playedKey(userId, year)) !== '1' } catch { return true }
}
export function markJinglePlayed(userId: string, year: number, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { storage?.setItem(playedKey(userId, year), '1') } catch { /* ignore */ }
}
function safeStorage(): Storage | null { try { return window.localStorage } catch { return null } }

/** Starts the jingle. Resolves true if audio actually started (browsers may refuse until the person taps something). */
export async function playJingle(): Promise<boolean> {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctx) return false
    const ctx: AudioContext = new Ctx()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
    if (ctx.state !== 'running') { ctx.close().catch(() => undefined); return false }
    const master = ctx.createGain()
    master.gain.value = 0.16
    master.connect(ctx.destination)
    const t0 = ctx.currentTime + 0.05
    for (const n of JINGLE_NOTES) {
      const start = t0 + n.beat * BEAT_SECONDS
      const end = start + Math.max(n.len * BEAT_SECONDS, 0.35) + 0.5
      for (const [mult, vol] of [[1, 1], [2.01, 0.25], [3.99, 0.08]] as const) {
        const osc = ctx.createOscillator(), g = ctx.createGain()
        osc.type = 'sine'; osc.frequency.value = n.hz * mult
        g.gain.setValueAtTime(0.0001, start)
        g.gain.exponentialRampToValueAtTime(vol * 0.5, start + 0.015)
        g.gain.exponentialRampToValueAtTime(0.0001, end)
        osc.connect(g); g.connect(master)
        osc.start(start); osc.stop(end + 0.05)
      }
    }
    setTimeout(() => ctx.close().catch(() => undefined), (jingleDurationSeconds() + 0.5) * 1000)
    return true
  } catch { return false }
}
