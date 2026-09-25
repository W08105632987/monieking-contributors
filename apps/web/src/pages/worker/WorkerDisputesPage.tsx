import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ChevronRight, RefreshCw, ShieldAlert, MessageSquare } from 'lucide-react'
import { api } from '@/lib/api'
import { BottomNav } from '@/components/layout/BottomNav'
import { WorkerHeader } from '@/components/worker/WorkerHeader'
import type { Dispute } from '@/types'

export default function WorkerDisputesPage() {
  const navigate = useNavigate()

  const { data: disputes, isLoading } = useQuery({
    queryKey: ['worker-disputes'],
    queryFn: async () => {
      const res = await api.get('/disputes/worker/mine')
      return res.data as Dispute[]
    },
    refetchInterval: 15000,
  })

  return (
    <div className="min-h-dvh flex flex-col bg-surface dark:bg-night-900 pb-24 text-green-950 dark:text-white">
      <WorkerHeader title="Customer Disputes" subtitle="Disputes raised on jobs you handled" />

      <main className="flex-1 px-4 py-4 space-y-4 max-w-lg mx-auto w-full">
        {/* Info Banner */}
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="leading-relaxed">
            When a customer disputes a service you resolved, you can communicate directly with them, provide supporting slips or explanations, or escalate to a Director if needed.
          </p>
        </div>

        {/* Dispute List */}
        {isLoading ? (
          <div className="py-12 text-center text-xs text-green-600 dark:text-night-400">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-green-600" />
            Loading disputes...
          </div>
        ) : !disputes || disputes.length === 0 ? (
          <div className="py-14 px-4 text-center rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <h3 className="font-bold text-sm text-green-950 dark:text-white">
              Zero Active Disputes
            </h3>
            <p className="text-xs text-green-700 dark:text-night-400 max-w-xs mx-auto">
              Great job! None of your resolved jobs currently have any open customer disputes.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d) => (
              <div
                key={d.id}
                onClick={() => navigate(`/disputes/${d.id}`)}
                className="p-4 rounded-2xl bg-white dark:bg-night-800 border border-green-100 dark:border-night-700 shadow-sm hover:shadow transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-green-950 dark:text-white">
                      {d.customer_name}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        d.status === 'resolved'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : d.status === 'escalated'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {d.status}
                    </span>
                  </div>

                  <p className="text-xs text-green-700 dark:text-night-300">
                    Reason: {d.reason.replace(/_/g, ' ')}
                  </p>

                  <span className="text-[10px] text-green-500 dark:text-night-400 block">
                    Created {new Date(d.created_at).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center gap-1 text-green-600 dark:text-night-400">
                  <MessageSquare className="w-4 h-4" />
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
