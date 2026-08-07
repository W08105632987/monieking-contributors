import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface TopBarProps {
  title?: string
  showBack?: boolean
  right?: ReactNode
  transparent?: boolean
  className?: string
}

export function TopBar({ title, showBack, right, transparent, className }: TopBarProps) {
  const navigate = useNavigate()

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex items-center justify-between px-4 h-14 pt-safe',
        transparent
          ? 'bg-transparent'
          : 'bg-white/90 backdrop-blur-md border-b border-green-100',
        className,
      )}
    >
      <div className="w-10">
        {showBack ? (
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-green-50 text-green-700 hover:bg-green-100 active:scale-95 transition-all"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-9 h-9 bg-green-900 rounded-xl flex items-center justify-center">
            <span className="text-amber-400 font-extrabold text-base">₦</span>
          </div>
        )}
      </div>

      {title ? (
        <h1 className="text-base font-bold text-green-900 text-center flex-1 mx-2 truncate">
          {title}
        </h1>
      ) : (
        <div className="flex-1 mx-2">
          <span className="text-green-900 font-extrabold text-lg tracking-tight">Monie</span><span className="text-amber-500 font-extrabold text-lg tracking-tight">King</span>
        </div>
      )}

      <div className="w-10 flex justify-end">
        {right ?? <div className="w-9" />}
      </div>
    </header>
  )
}
