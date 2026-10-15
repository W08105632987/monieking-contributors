import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, ShieldCheck, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { getErrorMessage } from '@/lib/api'
import { formatNaira } from '@/lib/utils'
import { useWalletStore } from '@/store/wallet.store'
import { FallbackError } from '@/components/ui/FallbackError'
import { ResultSheet } from '@/components/verification/ResultSheet'
import { SlipChooser } from '@/components/verification/SlipChooser'
import {
  METHODS, availability, consentText, expiryText, feeFor, fieldsFor, hoursText, isNinKind, newRequestId,
  slipOptions, validateFields, type Lookup, type MethodDef, type SlipOption, type SlipTier, type VerifyMethod,
} from '@/lib/verification'
import {
  buySlip, createLookup, downloadSheet, downloadSlip, getLookup, verifyStatus,
} from '@/lib/verificationApi'

const inputCls =
  'w-full mt-1.5 rounded-xl border-2 border-green-100 dark:border-night-500 bg-white dark:bg-night-600 px-4 py-3 text-sm font-medium text-green-900 dark:text-white outline-none focus:border-green-400'
const labelCls = 'text-green-500 dark:text-night-300 text-xs font-semibold uppercase tracking-wide'

/**
 * NIN and BVN verification (Techhub). One page for both kinds and both portals:
 *   /customer/verify/:kind[/:lookupId]
 *   /officer/customers/:customerId/verify/:kind[/:lookupId]
 * Flow: pick a method -> that method's fields -> consent -> fee shown -> Verify -> result.
 */
export default function VerifyLookupPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { kind: kindParam, customerId, lookupId } = useParams<{ kind: string; customerId?: string; lookupId?: string }>()
  const kind = isNinKind(kindParam) ? kindParam : 'nin'
  const title = kind === 'nin' ? 'NIN verification' : 'BVN verification'
  const base = customerId ? `/officer/customers/${customerId}/verify/${kind}` : `/customer/verify/${kind}`

  const balance = useWalletStore(s => s.wallet?.balance_kobo)
  const status = useQuery({ queryKey: ['verify-status'], queryFn: verifyStatus, refetchInterval: 30_000 })

  const defs = METHODS[kind]
  const [method, setMethod] = useState<VerifyMethod | null>(defs.length === 1 ? defs[0].id : null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<Lookup | null>(null)
  const [slipOpen, setSlipOpen] = useState(false)
  const [busyTier, setBusyTier] = useState<SlipTier | null>(null)
  const [busyDl, setBusyDl] = useState(false)
  const [slowNote, setSlowNote] = useState(false)
  const requestId = useRef(newRequestId())

  // Reopen a stored result from history.
  const reopened = useQuery({
    queryKey: ['verify-lookup', lookupId],
    queryFn: () => getLookup(lookupId as string),
    enabled: Boolean(lookupId),
  })
  const shown = result ?? reopened.data ?? null

  // Start over when the kind changes (same component reused between /verify/nin and /verify/bvn).
  useEffect(() => {
    setMethod(METHODS[kind].length === 1 ? METHODS[kind][0].id : null)
    setValues({}); setConsent(false); setResult(null); setSlowNote(false)
    requestId.current = newRequestId()
  }, [kind])

  const avail = availability(status.data, kind)
  const retention = status.data?.retention_hours ?? 24
  const def: MethodDef | undefined = defs.find(d => d.id === method)
  const fee = method ? feeFor(status.data, method) : null
  const problem = method ? validateFields(method, kind, values) : 'Pick a method.'
  const lowBalance = !customerId && fee !== null && balance !== undefined && balance < fee
  const canSubmit = Boolean(method) && !problem && consent && fee !== null && !submitting && !lowBalance

  const pollUntilDone = async (id: string): Promise<Lookup> => {
    let l = await getLookup(id)
    for (let i = 0; i < 20 && l.status === 'pending'; i++) {
      await new Promise(r => setTimeout(r, 3000))
      l = await getLookup(id)
    }
    return l
  }

  const submit = async () => {
    if (!method || !canSubmit) return
    setSubmitting(true); setSlowNote(false)
    try {
      let l = await createLookup(
        { method, fields: fieldsFor(method, kind, values), consent, client_request_id: requestId.current },
        customerId,
      )
      if (l.status === 'pending') l = await pollUntilDone(l.id)
      requestId.current = newRequestId()      // a response arrived: the next tap is a new check
      setResult(l)
      qc.invalidateQueries({ queryKey: ['service-history'] })
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['verify-status'] })
    } catch (e: unknown) {
      const hadResponse = Boolean((e as { response?: unknown })?.response)
      if (hadResponse) requestId.current = newRequestId()
      else setSlowNote(true)                  // no answer: keep the id so a retry can never double-charge
      toast.error(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const doSheet = async (reveal: boolean) => {
    if (!shown) return
    setBusyDl(true)
    try { await downloadSheet(shown.id, reveal) } catch (e) { toast.error(getErrorMessage(e)) } finally { setBusyDl(false) }
  }

  const pickSlip = async (o: SlipOption) => {
    if (!shown) return
    setBusyTier(o.tier)
    try {
      await buySlip(shown.id, o.tier)
      await downloadSlip(shown.id, o.tier)
      setSlipOpen(false)
      qc.invalidateQueries({ queryKey: ['wallet'] })
      qc.invalidateQueries({ queryKey: ['service-history'] })
      qc.invalidateQueries({ queryKey: ['verify-lookup', shown.id] })
      if (result) setResult({ ...result, slips: Array.from(new Set([...(result.slips ?? []), o.tier])) })
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setBusyTier(null)
    }
  }

  const again = () => { setResult(null); setConsent(false); setValues({}); if (defs.length > 1) setMethod(null); if (lookupId) navigate(base, { replace: true }) }
  const tryAgainSameMethod = () => { setResult(null); setConsent(false) ; if (lookupId) navigate(base, { replace: true }) }

  const owned = shown?.slips ?? []
  const options = shown ? slipOptions(status.data, kind, owned) : []

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => (method && !shown && defs.length > 1 ? setMethod(null) : navigate(-1))}
          className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">{title}</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        {customerId && (
          <div className="bg-amber-50 dark:bg-night-600 rounded-2xl px-4 py-3 mt-1 mb-3">
            <p className="text-amber-700 dark:text-night-100 text-xs font-semibold">
              Running this check on the customer's behalf. It is charged to their wallet, and your name is recorded.
            </p>
          </div>
        )}

        {status.isError ? (
          <FallbackError title="Couldn't load this service" onRetry={() => status.refetch()} isRetrying={status.isFetching} />
        ) : status.isLoading || (lookupId && reopened.isLoading) ? (
          <div className="space-y-3 mt-2">{[1, 2].map(i => <div key={i} className="h-16 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)}</div>
        ) : shown ? (
          // ───────── Result ─────────
          shown.status === 'found' ? (
            shown.result ? (
              <>
                <p className="text-green-500 dark:text-night-300 text-xs mb-3 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> {expiryText(shown.expires_at)}
                </p>
                <ResultSheet
                  lookup={shown} kind={kind} ninAuthUrl={status.data?.nin_auth_url ?? null} busy={busyDl}
                  onDownloadSheet={doSheet} onOpenSlips={() => setSlipOpen(true)} slipsAvailable={options.length > 0}
                />
                <button onClick={again} className="w-full text-green-700 dark:text-night-100 font-semibold text-sm py-4">Run another check</button>
              </>
            ) : (
              <div className="bg-white dark:bg-night-700 rounded-2xl p-5 mt-2">
                <p className="text-green-900 dark:text-white font-bold">This result has expired</p>
                <p className="text-green-500 dark:text-night-300 text-sm mt-1">
                  For privacy, results are kept for {hoursText(retention)}. Run the check again to see it.
                </p>
                <button onClick={again} className="mt-4 w-full font-bold text-sm rounded-full py-3 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900">Run a new check</button>
              </div>
            )
          ) : shown.status === 'not_found' ? (
            <div className="bg-white dark:bg-night-700 rounded-2xl p-5 mt-2">
              <p className="text-green-900 dark:text-white font-bold">No record found</p>
              <p className="text-green-500 dark:text-night-300 text-sm mt-1">
                No record was found for these details. Check them and try again. You have not been charged.
              </p>
              <button onClick={tryAgainSameMethod} className="mt-4 w-full font-bold text-sm rounded-full py-3 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900">Try again</button>
              {defs.length > 1 && <button onClick={again} className="mt-2 w-full text-green-700 dark:text-night-100 font-semibold text-sm py-3">Use another method</button>}
            </div>
          ) : (
            <div className="bg-white dark:bg-night-700 rounded-2xl p-5 mt-2">
              <p className="text-green-900 dark:text-white font-bold">This check didn't complete</p>
              <p className="text-green-500 dark:text-night-300 text-sm mt-1">{shown.failure_reason ?? 'Something went wrong. You have not been charged.'}</p>
              <button onClick={tryAgainSameMethod} className="mt-4 w-full font-bold text-sm rounded-full py-3 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900">Try again</button>
            </div>
          )
        ) : avail !== 'available' ? (
          // ───────── Off / unavailable ─────────
          <div className="bg-white dark:bg-night-700 rounded-2xl p-5 mt-2">
            <p className="text-green-900 dark:text-white font-bold">Temporarily unavailable</p>
            <p className="text-green-500 dark:text-night-300 text-sm mt-1">
              {title} isn't available right now. Nobody is charged while it is down. Please try again a little later.
            </p>
          </div>
        ) : !method || !def ? (
          // ───────── Method cards ─────────
          <>
            <p className="text-green-500 dark:text-night-300 text-sm mb-3 mt-1">How do you want to look this up?</p>
            <div className="space-y-2.5">
              {defs.map(d => {
                const f = feeFor(status.data, d.id)
                return (
                  <button
                    key={d.id}
                    onClick={() => setMethod(d.id)}
                    className="w-full flex items-center justify-between gap-3 bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card px-4 py-4 text-left"
                  >
                    <span>
                      <span className="block text-green-900 dark:text-white font-bold text-sm">{d.title}</span>
                      <span className="block text-green-500 dark:text-night-300 text-xs mt-0.5">{d.blurb}</span>
                    </span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      {f !== null && <span className="text-green-700 dark:text-night-100 font-bold text-sm">{formatNaira(f)}</span>}
                      <ChevronRight className="w-4 h-4 text-green-400" />
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          // ───────── Form ─────────
          <>
            <div className="space-y-4 mt-1">
              <p className="text-green-900 dark:text-white font-bold">{def.title}</p>
              {def.fields.map(f => (
                <div key={f.key}>
                  <label className={labelCls}>{f.label} {f.required && <span className="text-red-400">*</span>}</label>
                  {f.type === 'gender' ? (
                    <select value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className={inputCls}>
                      <option value="">Not specified</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                    </select>
                  ) : (
                    <input
                      value={values[f.key] ?? ''}
                      onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                      type={f.type === 'date' ? 'date' : 'text'}
                      inputMode={f.type === 'digits' || f.type === 'phone' ? 'numeric' : undefined}
                      maxLength={f.type === 'digits' ? 11 : undefined}
                      autoComplete="off"
                      placeholder={f.hint}
                      max={f.type === 'date' ? new Date().toISOString().slice(0, 10) : undefined}
                      className={inputCls}
                    />
                  )}
                </div>
              ))}
            </div>

            <button onClick={() => setConsent(c => !c)} className="flex items-start gap-2 rounded-2xl p-3 mt-5 bg-green-100 dark:bg-night-600 text-left w-full">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-700 dark:text-night-100" />
              <span className="text-[11px] leading-relaxed text-green-800 dark:text-night-100">
                {consent ? '☑' : '☐'} {consentText(kind, retention)}
              </span>
            </button>

            <div className="bg-white dark:bg-night-700 rounded-2xl border border-green-100 dark:border-night-500 shadow-card p-4 mt-4">
              <p className={labelCls}>Fee</p>
              <p className="text-green-900 dark:text-white text-2xl font-extrabold">{fee !== null ? formatNaira(fee) : '—'}</p>
              <p className="text-green-400 dark:text-night-300 text-xs mt-1">
                Charged only when a record is found. {customerId ? "From the customer's wallet." : balance !== undefined ? `Wallet balance: ${formatNaira(balance)}.` : ''}
              </p>
              {lowBalance && <p className="text-red-500 text-xs font-semibold mt-2">Your wallet balance is too low. Fund your wallet first.</p>}
            </div>

            {slowNote && (
              <p className="text-amber-700 dark:text-amber-300 text-xs mt-3">
                We didn't get an answer in time. Tap Verify again: if the first try went through, you will see that result and will not be charged twice.
              </p>
            )}
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="w-full font-bold text-sm rounded-full py-3.5 mt-5 bg-amber-400 dark:bg-night-100 text-green-900 dark:text-night-900 disabled:opacity-40"
            >
              {submitting ? 'Verifying… please wait' : 'Verify'}
            </button>
            {!submitting && problem && Object.keys(values).length > 0 && <p className="text-red-500 text-xs mt-2">{problem}</p>}
          </>
        )}
      </div>

      {slipOpen && <SlipChooser options={options} busyTier={busyTier} onPick={pickSlip} onClose={() => setSlipOpen(false)} />}
    </div>
  )
}
