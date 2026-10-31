import { api } from '@/lib/api'

/** Max size the server accepts for a stored document. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

/** Reads a file in the browser, sends it to our storage and returns the stored file's link (never a data link). */
export async function uploadDocument(file: File): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('read'))
    r.readAsDataURL(file)
  })
  const { data } = await api.post<{ url: string; filename: string }>(
    '/manual-services/upload', { filename: file.name, file_base64: dataUrl }, { timeout: 60_000 },
  )
  return data.url
}
