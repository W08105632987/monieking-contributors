import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { formatNaira } from '@/lib/utils'

interface PackageItem { id: string; name: string; icon: string | null }
interface Stats { total_qualified: number; total_collected: number }

export default function FoodCloseYearPage() {
  const navigate = useNavigate()
  const [yearLabel, setYearLabel] = useState(String(new Date().getFullYear()))
  const [costs, setCosts] = useState<Record<string, string>>({})
  const [adjustmentKobo, setAdjustmentKobo] = useState('')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [confirming, setConfirming] = useState(false)

  const { data: items } = useQuery({
    queryKey: ['food-package-items-all'],
    queryFn: async () => (await api.get<PackageItem[]>('/food-collections/package-items')).data,
  })
  const { data: stats } = useQuery({
    queryKey: ['food-oversight-stats'],
    queryFn: async () => (await api.get<Stats>('/food-collections/oversight/stats')).data,
  })

  const perPersonCostKobo = useMemo(
    () => Object.values(costs).reduce((sum, v) => sum + (Math.round(parseFloat(v || '0') * 100) || 0), 0),
    [costs],
  )
  const totalCollected = stats?.total_collected ?? 0
  const adjustmentKoboValue = Math.round((parseFloat(adjustmentKobo) || 0) * 100)
  const estimatedTotalCostKobo = perPersonCostKobo * totalCollected + adjustmentKoboValue

  const closeMutation = useMutation({
    mutationFn: async () => {
      const item_costs = (items || [])
        .filter(it => costs[it.id])
        .map(it => ({ item_id: it.id, unit_cost_kobo: Math.round(parseFloat(costs[it.id] || '0') * 100) }))
      return api.post('/food-collections/year/close', {
        year_label: yearLabel,
        item_costs,
        adjustment_kobo: adjustmentKoboValue,
        adjustment_note: adjustmentNote || null,
      })
    },
    onSuccess: () => {
      toast.success(`${yearLabel} closed`)
      navigate(`/director/food/archives/${yearLabel}`)
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Could not close the year'),
  })

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white dark:bg-night-700 border border-green-200 dark:border-night-500 rounded-xl flex items-center justify-center active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Close Year's Distribution</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav space-y-4">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-amber-900 dark:text-amber-200 text-xs leading-relaxed">
            This is permanent. Once closed, this year's figures become a read-only record and the live
            oversight table resets for the next cycle. Everyone who hasn't collected yet will be recorded
            as "not collected" for this year.
          </p>
        </div>

        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 space-y-3">
          <label className="block text-green-500 dark:text-night-200 text-xs font-bold">Year label</label>
          <input
            value={yearLabel}
            onChange={e => setYearLabel(e.target.value)}
            className="w-full bg-green-50 dark:bg-night-600 rounded-xl px-3 py-2.5 text-sm text-green-900 dark:text-white font-bold"
          />
        </div>

        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 space-y-3">
          <p className="text-green-900 dark:text-white font-bold text-sm">Cost per item, per person collected</p>
          <p className="text-green-400 dark:text-night-300 text-[11px]">
            Everyone who collected received the identical package — enter what one unit of each item actually cost.
          </p>
          {(items || []).map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3">
              <span className="text-green-700 dark:text-night-200 text-sm flex items-center gap-2 min-w-0">
                <span>{item.icon || '🍽️'}</span>
                <span className="truncate">{item.name}</span>
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-green-400 text-xs">₦</span>
                <input
                  type="number"
                  value={costs[item.id] || ''}
                  onChange={e => setCosts(c => ({ ...c, [item.id]: e.target.value }))}
                  placeholder="0.00"
                  className="w-24 bg-green-50 dark:bg-night-600 rounded-lg px-2 py-1.5 text-sm text-green-900 dark:text-white text-right"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white dark:bg-night-700 rounded-2xl p-4 space-y-3">
          <p className="text-green-900 dark:text-white font-bold text-sm">Other costs / adjustments</p>
          <p className="text-green-400 dark:text-night-300 text-[11px]">Spoilage, logistics, bulk discounts — anything the per-item list doesn't cover. Can be negative.</p>
          <div className="flex items-center gap-1">
            <span className="text-green-400 text-xs">₦</span>
            <input
              type="number"
              value={adjustmentKobo}
              onChange={e => setAdjustmentKobo(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-green-50 dark:bg-night-600 rounded-lg px-3 py-2 text-sm text-green-900 dark:text-white"
            />
          </div>
          <input
            value={adjustmentNote}
            onChange={e => setAdjustmentNote(e.target.value)}
            placeholder="Reason for this adjustment (required if non-zero)"
            className="w-full bg-green-50 dark:bg-night-600 rounded-lg px-3 py-2 text-xs text-green-900 dark:text-white"
          />
        </div>

        <div className="bg-green-900 dark:bg-night-100 rounded-2xl p-4 space-y-2">
          <Row label="Total collected" value={String(totalCollected)} light />
          <Row label="Est. total cost" value={formatNaira(estimatedTotalCostKobo)} light />
        </div>

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="w-full bg-red-500 text-white font-bold text-sm py-3.5 rounded-xl active:scale-95 transition-all mb-4"
          >
            Close {yearLabel}'s Distribution
          </button>
        ) : (
          <div className="space-y-2 mb-4">
            <p className="text-red-500 text-xs font-bold text-center">This can't be undone. Are you sure?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} className="flex-1 bg-green-50 dark:bg-night-600 text-green-700 dark:text-night-200 font-bold text-sm py-3 rounded-xl">
                Cancel
              </button>
              <button
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
                className="flex-1 bg-red-500 text-white font-bold text-sm py-3 rounded-xl disabled:opacity-50"
              >
                {closeMutation.isPending ? 'Closing…' : 'Yes, Close It'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, light }: { label: string; value: string; light?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={light ? 'text-green-200 dark:text-night-500 text-xs font-semibold' : 'text-green-500 text-xs font-semibold'}>{label}</span>
      <span className={light ? 'text-white dark:text-night-900 font-extrabold text-sm' : 'text-green-900 font-extrabold text-sm'}>{value}</span>
    </div>
  )
}
