import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { FallbackError } from '@/components/ui/FallbackError'
import type { TemplateListRow } from '@/lib/templateBuilderApi'
import { cardCls, smallBtn } from '@/components/builder/builderUi'

function Chip({ children, tone = 'grey' }: { children: string; tone?: 'green' | 'amber' | 'grey' | 'red' }) {
  const t = {
    green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    grey: 'bg-gray-100 text-gray-700 dark:bg-night-600 dark:text-night-100',
  }[tone]
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${t}`}>{children}</span>
}

export default function ServiceBuilderPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['service-templates', 'admin-all'],
    queryFn: async () => (await api.get<TemplateListRow[]>('/service-templates/admin/all')).data,
  })
  const archive = useMutation({
    mutationFn: async ({ code, archived }: { code: string; archived: boolean }) =>
      (await api.post(`/service-templates/${code}/admin/archive`, { archived })).data,
    onSuccess: (_d, v) => {
      toast.success(v.archived ? 'Archived. Orders and history are kept.' : 'Restored.')
      qc.invalidateQueries({ queryKey: ['service-templates'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const active = data.filter((t) => !t.archived)
  const archived = data.filter((t) => t.archived)

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center" aria-label="Back">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-bold text-lg">Service builder</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav space-y-3">
        <p className="text-green-600 dark:text-night-300 text-sm">
          Edit the form and prices of each service. Changes go live for new orders as soon as you publish, and you can go back to any earlier version.
        </p>
        {isError ? (
          <FallbackError title="Couldn't load the services" onRetry={() => refetch()} isRetrying={isFetching} />
        ) : isLoading ? (
          [1, 2, 3].map((i) => <div key={i} className="h-20 bg-white dark:bg-night-700 rounded-2xl animate-pulse" />)
        ) : (
          <>
            {active.map((t) => (
              <div key={t.service_code} className={`${cardCls} flex items-center gap-3`}>
                <button className="flex-1 min-w-0 text-left" onClick={() => navigate(`/director/service-builder/${t.service_code}`)}>
                  <p className="font-bold text-green-950 dark:text-white truncate">{t.title}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <Chip tone={t.is_enabled ? 'green' : 'red'}>{t.is_enabled ? 'On' : 'Off'}</Chip>
                    <Chip tone={t.live ? 'amber' : 'grey'}>{t.live ? 'New form live' : 'Original form'}</Chip>
                    {t.version != null && <Chip>{`Version ${t.version}`}</Chip>}
                    {t.kind === 'api' && <Chip>Provider-connected</Chip>}
                  </div>
                </button>
                <button
                  className={smallBtn}
                  onClick={() => { if (window.confirm(`Archive ${t.title}? It is hidden, never deleted. You must switch it off first.`)) archive.mutate({ code: t.service_code, archived: true }) }}
                >Archive</button>
                <ChevronRight className="w-4 h-4 text-green-400" />
              </div>
            ))}
            {archived.length > 0 && (
              <>
                <p className="text-xs font-bold uppercase tracking-wider text-green-700 dark:text-night-200 pt-2">Archived</p>
                {archived.map((t) => (
                  <div key={t.service_code} className={`${cardCls} flex items-center gap-3 opacity-80`}>
                    <p className="flex-1 font-bold text-green-950 dark:text-white truncate">{t.title}</p>
                    <button className={smallBtn} onClick={() => archive.mutate({ code: t.service_code, archived: false })}>Restore</button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
