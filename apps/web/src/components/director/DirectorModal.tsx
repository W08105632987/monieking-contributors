import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A calm centred dialog for director tools. Sits above everything, closes on Escape, blocks the page behind it. */
export function DirectorModal({ open, title, onClose, children, busy }: { open: boolean; title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, busy, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-4" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-night-700 p-5 pb-8 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-green-950 dark:text-white">{title}</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="rounded-full p-1.5 text-green-600 dark:text-night-200 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function PinField({ value, onChange, label = 'Your PIN', autoFocus }: { value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-green-700 dark:text-night-200">{label}</span>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={4} autoFocus={autoFocus} value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} aria-label={label}
        className="mt-1 w-full rounded-xl border border-green-200 dark:border-night-500 bg-white dark:bg-night-800 px-3 py-3 text-center text-lg tracking-[0.5em] text-green-950 dark:text-white outline-none focus:border-green-500" />
    </label>
  )
}

export function ActionButton({ children, onClick, disabled, busy, tone = 'green', type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; tone?: 'green' | 'red' | 'ghost'; type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy}
      className={cn('w-full rounded-2xl px-4 py-3 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50',
        tone === 'green' && 'bg-green-700 text-white', tone === 'red' && 'bg-red-600 text-white',
        tone === 'ghost' && 'border border-green-200 dark:border-night-500 text-green-800 dark:text-night-100 bg-transparent')}>
      {busy ? 'Please wait…' : children}
    </button>
  )
}

/** One inline result line instead of a toast: shows the latest message only, never stacks. */
export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: ReactNode }) {
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={cn('rounded-xl px-3 py-2 text-xs font-semibold',
      kind === 'ok' && 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
      kind === 'error' && 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
      kind === 'info' && 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300')}>{children}</p>
  )
}

export const PageShell = ({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) => (
  <div className="min-h-dvh bg-green-50 dark:bg-night-800">
    <header className="flex items-center gap-3 px-4 py-3">
      <button onClick={onBack} aria-label="Back" className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center text-green-700 dark:text-night-100">‹</button>
      <h1 className="text-green-900 dark:text-white font-bold text-lg">{title}</h1>
    </header>
    <div className="px-4 pb-32 space-y-3">{children}</div>
  </div>
)

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <section className={cn('rounded-2xl border border-green-100 dark:border-night-500 bg-white dark:bg-night-700 p-4', className)}>{children}</section>
)
