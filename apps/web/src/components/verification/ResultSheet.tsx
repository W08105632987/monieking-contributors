import { useState } from 'react'
import { Eye, EyeOff, FileDown, ExternalLink, BadgeCheck } from 'lucide-react'
import { BrandBlobLogo } from '@/components/brand/BrandBlobLogo'
import { formatDateTime } from '@/lib/utils'
import { DISCLAIMER, initialsOf, maskId, type Lookup, type VerifyKind } from '@/lib/verification'

const Row = ({ label, value }: { label: string; value?: string | null }) => (
  <div className="flex justify-between gap-4 py-2 border-b border-green-100 dark:border-night-500 last:border-0">
    <span className="text-green-500 dark:text-night-300 text-xs font-semibold uppercase tracking-wide">{label}</span>
    <span className="text-green-900 dark:text-white text-sm font-semibold text-right break-words">{value || '—'}</span>
  </div>
)

interface Props {
  lookup: Lookup
  kind: VerifyKind
  ninAuthUrl: string | null
  busy: boolean
  onDownloadSheet: (reveal: boolean) => void
  onOpenSlips: () => void
  slipsAvailable: boolean
}

/** MonieKing branded result: logo only, photo (or initials), masked id with a reveal tap. */
export function ResultSheet({ lookup, kind, ninAuthUrl, busy, onDownloadSheet, onOpenSlips, slipsAvailable }: Props) {
  const [reveal, setReveal] = useState(false)
  const r = lookup.result
  if (!r) return null
  const idValue = kind === 'nin' ? r.nin : r.bvn
  return (
    <div>
      <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4">
        <div className="flex items-center justify-between mb-3">
          <BrandBlobLogo height={44} />
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
            <BadgeCheck className="w-4 h-4" /> Verified
          </span>
        </div>
        <div className="flex items-center gap-4 mb-3">
          {lookup.photo_b64 ? (
            <img src={`data:image/jpeg;base64,${lookup.photo_b64}`} alt="" className="w-20 h-24 rounded-xl object-cover bg-green-100" />
          ) : (
            <div className="w-20 h-24 rounded-xl bg-green-100 dark:bg-night-600 flex items-center justify-center text-green-700 dark:text-night-100 text-2xl font-extrabold">
              {initialsOf(r.full_name)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-green-900 dark:text-white font-extrabold text-lg leading-tight break-words">{r.full_name}</p>
            <button
              onClick={() => setReveal(v => !v)}
              className="mt-1 flex items-center gap-1.5 text-green-700 dark:text-night-100 text-sm font-mono"
              aria-label={reveal ? `Hide ${kind.toUpperCase()}` : `Show ${kind.toUpperCase()}`}
            >
              {reveal ? idValue : maskId(idValue)}
              {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <Row label="Gender" value={r.gender ? r.gender[0] + r.gender.slice(1).toLowerCase() : null} />
        <Row label="Date of birth" value={r.date_of_birth} />
        <Row label="Phone" value={r.phone_number} />
        <Row label="Address" value={r.address} />
        <Row label="Verified" value={formatDateTime(lookup.created_at)} />
        <Row label="Reference" value={`MK-VF-${lookup.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`} />
        <p className="text-green-500 dark:text-night-300 text-[11px] leading-relaxed mt-3">{DISCLAIMER[kind]}</p>
      </div>

      <div className="space-y-2.5 mt-4">
        <button
          disabled={busy}
          onClick={() => onDownloadSheet(reveal)}
          className="w-full flex items-center justify-center gap-2 font-bold text-sm rounded-full py-3.5 bg-green-600 text-white disabled:opacity-40"
        >
          <FileDown className="w-4 h-4" /> Download sheet (free)
        </button>
        {slipsAvailable && (
          <button
            disabled={busy}
            onClick={onOpenSlips}
            className="w-full font-bold text-sm rounded-full py-3.5 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900 disabled:opacity-40"
          >
            Download slip
          </button>
        )}
        {kind === 'nin' && ninAuthUrl && (
          <a
            href={ninAuthUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 font-bold text-sm rounded-full py-3.5 border-2 border-green-200 dark:border-night-500 text-green-800 dark:text-night-100"
          >
            <ExternalLink className="w-4 h-4" /> Get official slip (NIN-Auth)
          </a>
        )}
      </div>
    </div>
  )
}
