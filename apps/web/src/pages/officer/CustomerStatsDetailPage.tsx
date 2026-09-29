import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { CustomerStatsPanel } from '@/components/dashboard/CustomerStatsPanel'

export default function OfficerCustomerStatsDetailPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh flex flex-col bg-green-50 dark:bg-night-800">
      <header className="flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-night-800">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white dark:bg-night-700 border border-green-100 dark:border-night-500 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-green-700 dark:text-night-100" />
        </button>
        <h1 className="text-green-900 dark:text-white font-extrabold text-lg">Customer statistics</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-safe-nav">
        <CustomerStatsPanel scope={{ kind: 'my_zone' }} title="Your zone" />
      </div>
    </div>
  )
}
