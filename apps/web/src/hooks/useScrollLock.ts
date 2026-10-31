import { useEffect } from 'react'

/** Ref-counted so stacked modals don't unlock the page early. */
let locks = 0
let prevOverflow = ''
let prevPaddingRight = ''

function lock() {
  if (typeof document === 'undefined') return
  if (locks++ > 0) return
  const body = document.body
  const scrollbar = window.innerWidth - document.documentElement.clientWidth
  prevOverflow = body.style.overflow
  prevPaddingRight = body.style.paddingRight
  body.style.overflow = 'hidden'
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
}

function unlock() {
  if (typeof document === 'undefined') return
  if (locks === 0 || --locks > 0) return
  document.body.style.overflow = prevOverflow
  document.body.style.paddingRight = prevPaddingRight
}

export function useScrollLock(active: boolean = true) {
  useEffect(() => {
    if (!active) return
    lock()
    return unlock
  }, [active])
}
