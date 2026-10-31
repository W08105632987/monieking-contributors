import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import toast from '@/lib/notify'
import { getErrorMessage } from '@/lib/api'
import { koboToNaira, nairaToKobo } from '@/lib/utils'
import { FallbackError } from '@/components/ui/FallbackError'
import { adminGetSettings, adminPutSettings, adminResetBreaker } from '@/lib/verificationApi'
import { TIER_LABEL, TIERS, type SlipTier, type VerifyKind } from '@/lib/verification'

const card = 'bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mb-4'
const label = 'text-green-500 dark:text-night-300 text-xs font-semibold uppercase tracking-wide'
const input = 'w-full mt-1 rounded-xl border-2 border-green-100 dark:border-night-500 bg-white dark:bg-night-600 px-3 py-2.5 text-sm font-medium text-green-900 dark:text-white outline-none focus:border-green-400'

const FEE_LABELS: Record<string, string> = { nin: 'NIN: by NIN', phone: 'NIN: by phone', demographic: 'NIN: by name & date of birth', bvn: 'BVN: by BVN' }

interface Server {
  enabled: boolean; retention_hours: number; retention_minutes?: number; retention_never?: boolean; nin_auth_url: string
  lookup_tier: Record<VerifyKind, SlipTier>
  fees: Record<string, number>; slips: Record<string, number>; missing_fees: string[]
  services: Record<VerifyKind, { available: boolean; reason: string | null; retry_at: string | null }>
  server: { techhub_key_set: boolean; encryption_key_set: boolean }
}

const toNaira = (kobo: number) => (kobo > 0 ? String(koboToNaira(kobo)) : '')
const toKobo = (s: string) => (s.trim() === '' ? 0 : nairaToKobo(s))

export default function VerificationSettingsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['verify-admin'], queryFn: adminGetSettings as () => Promise<Server>, refetchInterval: 20_000 })

  const [enabled, setEnabled] = useState(false)
  const [retention, setRetention] = useState('24')
  const [retentionMins, setRetentionMins] = useState('0')
  const retentionTotal = (Number(retention || 0) * 60) + Number(retentionMins || 0)
  const retentionOk = Number(retentionMins || 0) <= 59 && retentionTotal >= 60 && retentionTotal <= 168 * 60
  const [keepForever, setKeepForever] = useState(false)
  const [authUrl, setAuthUrl] = useState('')
  const [tiers, setTiers] = useState<Record<string, string>>({ nin: 'regular', bvn: 'standard' })
  const [fees, setFees] = useState<Record<string, string>>({})
  const [slips, setSlips] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const d = q.data
    if (!d || loaded) return
    setEnabled(d.enabled); { const total = d.retention_minutes ?? d.retention_hours * 60; setRetention(String(Math.floor(total / 60))); setRetentionMins(String(total % 60)) }; setKeepForever(!!d.retention_never); setAuthUrl(d.nin_auth_url ?? '')
    setTiers({ ...d.lookup_tier })
    setFees(Object.fromEntries(Object.entries(d.fees).map(([k, v]) => [k, toNaira(v)])))
    setSlips(Object.fromEntries(Object.entries(d.slips).map(([k, v]) => [k, toNaira(v)])))
    setLoaded(true)
  }, [q.data, loaded])

  const save = useMutation({
    mutationFn: () => adminPutSettings({
      enabled,
      retention_minutes: retentionOk ? retentionTotal : 24 * 60,
      retention_never: keepForever,
      nin_auth_url: authUrl.trim(),
      lookup_tier: tiers,
      fees: Object.fromEntries(Object.keys(FEE_LABELS).map(k => [k, toKobo(fees[k] ?? '')])),
      slips: Object.fromEntries(
        (['nin', 'bvn'] as VerifyKind[]).flatMap(k => TIERS[k].map(t => [`${k}.${t}`, toKobo(slips[`${k}.${t}`] ?? '')])),
      ),
    }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['verify-admin'] }); qc.invalidateQueries({ queryKey: ['verify-status'] }) },
    onError: e => toast.error(getErrorMessage(e)),
  })
  const reset = useMutation({
    mutationFn: (k: VerifyKind) => adminResetBreaker(k),
    onSuccess: () => { toast.success('Marked as working again'); qc.invalidateQueries({ queryKey: ['verify-admin'] }) },
    onError: e => toast.error(getErrorMessage(e)),
  })

  const feesMissing = Object.keys(FEE_LABELS).filter(k => toKobo(fees[k] ?? '') <= 0)
  const d = q.data

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">NIN & BVN verification</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {q.isError ? (
          <FallbackError title="Couldn't load settings" onRetry={() => q.refetch()} isRetrying={q.isFetching} />
        ) : !d ? (
          <div className="h-40 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />
        ) : (
          <>
            <div className={card}>
              <p className={label}>Switch</p>
              <label className="flex items-center justify-between mt-2">
                <span className="text-green-900 dark:text-white text-sm font-semibold">Use the new verification</span>
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-5 h-5" />
              </label>
              <p className="text-green-500 dark:text-night-300 text-xs mt-2">
                Off: customers keep the existing NIN and BVN verification exactly as it is today. On: they get the new screens. It cannot be turned on until every fee below is set.
              </p>
              {!d.server.techhub_key_set && <p className="text-red-500 text-xs font-semibold mt-2">The Techhub key is not set on the server.</p>}
              {!d.server.encryption_key_set && <p className="text-red-500 text-xs font-semibold mt-1">The encryption key is not set on the server.</p>}
              {enabled && feesMissing.length > 0 && <p className="text-red-500 text-xs font-semibold mt-2">Set every fee before saving with this on.</p>}
            </div>

            <div className={card}>
              <p className={label}>Service health</p>
              {(['nin', 'bvn'] as VerifyKind[]).map(k => {
                const s = d.services[k]
                return (
                  <div key={k} className="flex items-center justify-between mt-2">
                    <span className="text-green-900 dark:text-white text-sm font-semibold">{k.toUpperCase()}: {d.enabled ? (s.available ? 'Working' : 'Down (retesting)') : 'Off'}</span>
                    {d.enabled && !s.available && (
                      <button onClick={() => reset.mutate(k)} disabled={reset.isPending} className="text-xs font-bold text-green-700 dark:text-night-100 underline">Mark as working</button>
                    )}
                  </div>
                )
              })}
              <p className="text-green-500 dark:text-night-300 text-xs mt-2">After 3 failures in a row a service shows "temporarily unavailable" and you get an alert. It retests every 5 minutes by itself.</p>
            </div>

            <div className={card}>
              <p className={label}>Verification fees (₦, charged when a record is found)</p>
              {Object.entries(FEE_LABELS).map(([k, l]) => (
                <div key={k} className="mt-2">
                  <span className="text-green-900 dark:text-white text-sm">{l}</span>
                  <input inputMode="decimal" value={fees[k] ?? ''} onChange={e => setFees(f => ({ ...f, [k]: e.target.value }))} placeholder="Not set" className={input} />
                </div>
              ))}
            </div>

            <div className={card}>
              <p className={label}>Slip prices (₦). Leave empty to hide that slip.</p>
              {(['nin', 'bvn'] as VerifyKind[]).map(k => TIERS[k].map(t => (
                <div key={`${k}.${t}`} className="mt-2">
                  <span className="text-green-900 dark:text-white text-sm">{k.toUpperCase()} {TIER_LABEL[t]} slip</span>
                  <input inputMode="decimal" value={slips[`${k}.${t}`] ?? ''} onChange={e => setSlips(s => ({ ...s, [`${k}.${t}`]: e.target.value }))} placeholder="Not set" className={input} />
                </div>
              )))}
            </div>

            <div className={card}>
              <p className={label}>Technical</p>
              <div className="mt-2">
                <span className="text-green-900 dark:text-white text-sm">Tier used for the NIN check</span>
                <select value={tiers.nin} onChange={e => setTiers(t => ({ ...t, nin: e.target.value }))} className={input}>
                  {TIERS.nin.map(t => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="mt-2">
                <span className="text-green-900 dark:text-white text-sm">Tier used for the BVN check</span>
                <select value={tiers.bvn} onChange={e => setTiers(t => ({ ...t, bvn: e.target.value }))} className={input}>
                  {TIERS.bvn.map(t => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="mt-2">
                <span className="text-green-900 dark:text-white text-sm">How long results are kept (1 hour to 168 hours)</span>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <label className="block text-xs text-green-700 dark:text-night-200">Hours
                    <input inputMode="numeric" value={retention} disabled={keepForever} onChange={e => setRetention(e.target.value.replace(/\D/g, ''))} className={`${input} disabled:opacity-40`} /></label>
                  <label className="block text-xs text-green-700 dark:text-night-200">Minutes
                    <input inputMode="numeric" value={retentionMins} disabled={keepForever} onChange={e => setRetentionMins(e.target.value.replace(/\D/g, ''))} className={`${input} disabled:opacity-40`} /></label>
                </div>
                {!keepForever && !retentionOk && <p className="text-red-500 text-xs mt-1">Enter between 1 hour and 168 hours, with minutes from 0 to 59.</p>}
                <p className="text-amber-600 dark:text-amber-300 text-xs mt-1">This same value can also be changed in Business Settings (Identity Verification). Both screens edit the same retention time.</p>
                <label className="mt-2 flex items-start gap-2 text-xs text-green-800 dark:text-night-100">
                  <input type="checkbox" className="mt-0.5" checked={keepForever} onChange={e => setKeepForever(e.target.checked)} />
                  <span><b>Never delete.</b> Keep every NIN and BVN result in the system forever. Results already wiped cannot be brought back. Stored results stay encrypted.</span>
                </label>
              </div>
              <div className="mt-2">
                <span className="text-green-900 dark:text-white text-sm">Official NIN-Auth link (https). Empty hides the button.</span>
                <input value={authUrl} onChange={e => setAuthUrl(e.target.value)} placeholder="https://…" className={input} />
              </div>
            </div>

            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || (!keepForever && !retentionOk)}
              className="w-full font-bold text-sm rounded-full py-3.5 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900 disabled:opacity-40"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
