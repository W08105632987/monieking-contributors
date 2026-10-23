import { useDialogStore, type DialogTone } from '@/store/dialog.store'

let seq = 0

interface Opts {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}

/**
 * In-app replacement for window.confirm(): resolves true when the person confirms.
 * Never shows the browser's "app.monieking.com says…" box.
 *   if (!(await ask('Delete this?', { tone: 'danger', confirmLabel: 'Delete' }))) return
 */
export function ask(message: string, opts: Opts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: ++seq, kind: 'confirm', message,
      title: opts.title ?? 'Are you sure?',
      confirmLabel: opts.confirmLabel ?? 'Yes, continue',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      tone: opts.tone ?? 'default',
      resolve,
    })
  })
}

/** In-app replacement for window.alert(). */
export function tell(message: string, opts: Omit<Opts, 'cancelLabel'> = {}): Promise<void> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: ++seq, kind: 'alert', message,
      title: opts.title ?? 'Heads up',
      confirmLabel: opts.confirmLabel ?? 'Got it',
      cancelLabel: '',
      tone: opts.tone ?? 'info',
      resolve: () => resolve(),
    })
  })
}
