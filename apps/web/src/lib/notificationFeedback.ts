/**
 * Sound + vibration for an in-app notification.
 *
 * The chime is synthesised with the Web Audio API (two soft rising notes), so
 * there is no audio file to ship or license. Browsers only allow audio after
 * the user has interacted with the page once; installUnlock() resumes the
 * audio context on the first tap/key so later chimes are allowed.
 * navigator.vibrate exists on Android browsers only. iOS has no web vibration.
 *
 * Users can mute the chime + vibration (Profile -> "Notification sound").
 * Push itself stays compulsory; only this in-app feedback is mutable.
 */
const MUTE_KEY = 'monieking-notif-sound-muted'

export function isSoundMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export function setSoundMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* private mode */ }
}

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx ??= new Ctor()
    return ctx
  } catch {
    return null
  }
}

/** Call once at app start: the first user gesture unlocks audio for later chimes. */
export function installAudioUnlock(): () => void {
  const unlock = () => {
    const c = getCtx()
    if (c && c.state === 'suspended') void c.resume().catch(() => {})
  }
  const events = ['pointerdown', 'keydown', 'touchstart'] as const
  events.forEach((e) => window.addEventListener(e, unlock, { once: true, passive: true }))
  return () => events.forEach((e) => window.removeEventListener(e, unlock))
}

function note(c: AudioContext, freq: number, start: number, dur: number): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // soft attack + exponential decay = a clean "ding" rather than a beep
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.22, start + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

export function playChime(): void {
  if (isSoundMuted()) return
  const c = getCtx()
  if (!c) return
  try {
    if (c.state === 'suspended') void c.resume().catch(() => {})
    const t = c.currentTime + 0.01
    note(c, 880, t, 0.28)          // A5
    note(c, 1318.5, t + 0.13, 0.5) // E6
  } catch { /* audio is a nicety, never break the app over it */ }
}

export function vibrateDevice(): void {
  if (isSoundMuted()) return
  try { navigator.vibrate?.([120, 70, 120]) } catch { /* unsupported */ }
}

export function notificationFeedback(): void {
  playChime()
  vibrateDevice()
}
