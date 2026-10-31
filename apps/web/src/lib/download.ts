import { api } from '@/lib/api'
import { useDownloadStore } from '@/store/download.store'
import { friendlyError } from '@/lib/errorText'

/** "Ada Obi" -> "Ada Obi", strips characters a file name cannot hold. */
export function safeName(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** "NIN Slip - Ada Obi.pdf" — what the person sees in Downloads. Falls back sensibly when the name is unknown. */
export function personFileName(kind: string, person: string | null | undefined, ext = 'pdf'): string {
  const who = safeName(person ?? '')
  return `${kind}${who ? ` - ${who}` : ''}.${ext}`
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Runs a download/export while an in-app progress modal shows how far it has gone.
 * `work` reports progress with report(0..100) (or never, for a gentle automatic bar),
 * and returns the Blob to save.
 */
export async function runDownload(
  filename: string,
  work: (report: (pct: number | null) => void) => Promise<Blob>,
  label = 'Preparing your file',
): Promise<boolean> {
  const st = useDownloadStore.getState()
  st.set({ open: true, filename, label, progress: 4, phase: 'working', error: undefined })
  // Servers that stream without a length give no real numbers: creep towards 90% so it never looks frozen.
  let real = false
  const creep = setInterval(() => {
    const cur = useDownloadStore.getState().progress
    if (!real && cur != null && cur < 90) useDownloadStore.getState().set({ progress: cur + Math.max(1, (90 - cur) * 0.08) })
  }, 250)
  try {
    const blob = await work((pct) => {
      if (pct == null) return
      real = true
      useDownloadStore.getState().set({ progress: Math.max(useDownloadStore.getState().progress ?? 0, Math.min(99, pct)) })
    })
    useDownloadStore.getState().set({ progress: 100, label: 'Saving to your device' })
    saveBlob(blob, filename)
    useDownloadStore.getState().set({ phase: 'done', label: 'Downloaded' })
    await sleep(1400)
    useDownloadStore.getState().close()
    return true
  } catch (e: any) {
    useDownloadStore.getState().set({ phase: 'error', error: friendlyError(e, 'The download failed. Please try again.') })
    return false
  } finally {
    clearInterval(creep)
  }
}

/** GET a file from the API with a live progress bar. */
export function downloadFromApi(
  path: string, filename: string,
  opts: { params?: Record<string, unknown>; label?: string; timeout?: number } = {},
) {
  return runDownload(filename, async (report) => {
    const res = await api.get<Blob>(path, {
      responseType: 'blob', params: opts.params, timeout: opts.timeout ?? 70_000,
      onDownloadProgress: (e) => { if (e.total) report((e.loaded / e.total) * 100) },
    })
    return res.data
  }, opts.label)
}
