/**
 * Keeps the app usable while the phone keyboard is open.
 *
 * THE PROBLEM: on most phones the keyboard covers the bottom of the screen but the page does not know. Bottom sheets stay
 * where they were (hidden behind the keys) and the person has to scroll the sheet up by hand to reach the field.
 *
 * WHAT THIS DOES (one place, every sheet and page benefits):
 *  1. Measures how much the keyboard covers (`--kb-inset`) and the visible height (`--vvh`) on every change.
 *  2. While the keyboard is open the `kb-open` class is set; index.css lifts every full-screen overlay by that amount, so
 *     bottom sheets rise ABOVE the keyboard instead of hiding behind it.
 *  3. When a field is tapped it is scrolled into the middle of what is still visible, after the keyboard has finished
 *     sliding up.
 * Chrome on Android also gets `interactive-widget=resizes-content` (index.html), where the browser shrinks the page itself;
 * the measured inset is then ~0 so nothing is adjusted twice.
 */

/** How many pixels the keyboard covers at the bottom of the screen. */
export function computeKeyboardInset(layoutHeight: number, visibleHeight: number, visibleTop: number): number {
  const covered = layoutHeight - visibleHeight - visibleTop
  return covered > 0 ? Math.round(covered) : 0
}

/** Below this many covered pixels it is browser chrome (address bar), not a keyboard. */
export const KEYBOARD_MIN_INSET = 80

const EDITABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]'

export function initKeyboardLayout(): void {
  if (typeof window === 'undefined') return
  const vv = window.visualViewport
  const root = document.documentElement
  const update = () => {
    const inset = vv ? computeKeyboardInset(window.innerHeight, vv.height, vv.offsetTop) : 0
    root.style.setProperty('--kb-inset', `${inset}px`)
    root.style.setProperty('--vvh', `${vv ? Math.round(vv.height) : window.innerHeight}px`)
    // Only while a text field has focus: pinch-zoom or browser chrome must never leave the page stuck in 'keyboard' mode.
    const typing = !!document.activeElement && (document.activeElement as HTMLElement).matches?.(EDITABLE)
    root.classList.toggle('kb-open', inset > KEYBOARD_MIN_INSET && typing)
  }
  update()
  vv?.addEventListener('resize', update)
  vv?.addEventListener('scroll', update)
  window.addEventListener('orientationchange', update)

  let timer: number | undefined
  document.addEventListener('focusout', () => window.setTimeout(update, 50))
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null
    if (!el || !el.matches?.(EDITABLE)) return
    window.clearTimeout(timer)
    // wait for the keyboard to finish sliding up, then bring the field into the middle of the visible area
    timer = window.setTimeout(() => {
      if (document.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 320)
  })
}
