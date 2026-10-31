import { useEffect } from 'react'

/** Ref-counted so stacked modals don't unlock the page early. */
let locks = 0

function lock() {
  if (typeof document === 'undefined') return
  if (locks++ > 0) return
  const body = document.body
  const scrollbar = window.innerWidth - document.documentElement.clientWidth
  body.style.overflow = 'hidden'
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
}

function unlock() {
  if (typeof document === 'undefined') return
  if (locks === 0 || --locks > 0) return
  // Always back to the stylesheet default. Restoring a remembered value could put 'hidden' back and freeze scrolling.
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
}

export function useScrollLock(active: boolean = true) {
  useEffect(() => {
    if (!active) return
    lock()
    return unlock
  }, [active])
}

/** Safety net: if the page is ever left locked with nothing open (e.g. a crashed modal), call this to free it. */
export function releaseStaleScrollLock() {
  if (typeof document === 'undefined' || locks > 0) return
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
}
