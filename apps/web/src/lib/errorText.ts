/**
 * Customer-safe error text. Mirrors backend/app/core/public_errors.py.
 *
 * Customers must never see provider / backend / technical wording such as
 * "Payment provider login failed (HTTP 503)", stack traces, SQL or URLs.
 * Anything that came from a server response or an Error object goes through
 * `safeText` / `friendlyError` before it is displayed.
 */

export const GENERIC_ERROR = 'Something went wrong. Please try again in a moment.'
export const UNAVAILABLE_ERROR = 'This service is temporarily unavailable. Please try again in a few minutes.'
export const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'
export const SLOW_ERROR =
  'This is taking longer than expected. Check your connection and try again. If it keeps happening, the request may have gone through, so check before retrying anything money-related.'
export const INVALID_INPUT_ERROR = 'Please check the details you entered and try again.'

const MAX_LEN = 240

const PATTERNS: RegExp[] = [
  /\bhttp\s*[1-5]\d\d\b/i,
  /\bhttp\/\d/i,
  /\bstatus(?:\s*code)?\s*[:=]?\s*[1-5]\d\d\b/i,
  /\b[1-5]\d\d\s+(?:bad gateway|service unavailable|gateway time-?out|internal server error|not found|unauthorized|forbidden)\b/i,
  /\bprovider\b/i,
  /\bvendor\b/i,
  /\bupstream\b/i,
  /\bgateway\b/i,
  /\b(?:monnify|techhub|youverify|termii|supabase|paystack|flutterwave)\b/i,
  /login failed/i,
  /\bcredentials?\b/i,
  /\bapi[\s_-]?key\b|\bsecret\b|\baccess[\s_-]?token\b|\bbearer\b/i,
  /\btraceback\b|most recent call last|\bfile "/i,
  /\binternal server error\b/i,
  /\b(?:select|insert|update|delete)\b.{0,80}\b(?:from|into|set|where)\b/i,
  /\bsql\w*\b|\bpsycopg\w*|\basyncpg\b|\bsqlalchemy\b|\bintegrityerror\b|\bviolates\b|\bconstraint\b/i,
  /https?:\/\/|\bwww\./i,
  /\b\w+(?:Error|Exception)\b/,
  /\bnon-json\b|\bjson\b|\bunexpected (?:login )?response\b|\braw body\b/i,
  /\btimed? ?out\b|\btimeout\b|\bconnection\b|\bsocket\b|\bssl\b|\bdns\b|\bnetwork error\b/i,
  /\b(?:null|undefined|nan)\b/i,
  /\[object \w+\]/i,
  /[{}[\]]{2,}|\{['"]/,
  /\b0x[0-9a-f]{4,}\b/i,
  /[A-Za-z]:\\|\/(?:usr|app|home|var|etc|node_modules)\//,
  /\bdetail\b\s*[:=]/i,
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{3,}\b/,
  /\bat\s+\S+\s+\(\S+:\d+:\d+\)/,
  /^request failed with status code/i,
]

export function looksTechnical(msg: unknown): boolean {
  if (typeof msg !== 'string') return true
  const text = msg.trim()
  if (!text || text.length > MAX_LEN || text.includes('\n')) return true
  return PATTERNS.some((re) => re.test(text))
}

/** `msg` if it is safe to show a customer, otherwise `fallback`. */
export function safeText(msg: unknown, fallback: string = GENERIC_ERROR): string {
  return looksTechnical(msg) ? fallback : (msg as string).trim()
}

/** Normalise a FastAPI `detail` (string | {message} | validation array) into safe text, or '' for kyc_required. */
function detailText(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return safeText(detail, fallback)
  if (Array.isArray(detail)) return INVALID_INPUT_ERROR
  if (detail && typeof detail === 'object') {
    const d = detail as { code?: unknown; message?: unknown }
    if (d.code === 'kyc_required') return ''   // the KYC box is already showing
    if (typeof d.message === 'string') return safeText(d.message, fallback)
  }
  return fallback
}

/**
 * Turn anything thrown (axios error, Error, string, unknown) into a message a
 * customer can see. Never returns raw technical text.
 */
export function friendlyError(error: unknown, fallback: string = GENERIC_ERROR): string {
  if (typeof error === 'string') return safeText(error, fallback)
  if (!error || typeof error !== 'object') return fallback
  const e = error as {
    response?: { status?: number; data?: any }
    code?: string
    message?: unknown
    isAxiosError?: boolean
  }
  const data = e.response?.data
  if (data !== undefined && data !== null) {
    const detail = typeof data === 'object' ? (data.detail ?? data.message) : undefined
    if (detail !== undefined) {
      const status = e.response?.status ?? 0
      return detailText(detail, status >= 500 ? UNAVAILABLE_ERROR : fallback)
    }
  }
  if (e.response) {
    return (e.response.status ?? 0) >= 500 ? UNAVAILABLE_ERROR : fallback
  }
  if (e.isAxiosError || e.code === 'ECONNABORTED' || e.code === 'ERR_NETWORK') {
    if (e.code === 'ECONNABORTED' || /timeout/i.test(String(e.message ?? ''))) return SLOW_ERROR
    return NETWORK_ERROR
  }
  return typeof e.message === 'string' ? safeText(e.message, fallback) : fallback
}
