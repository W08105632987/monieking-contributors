import { X } from 'lucide-react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-green-950/50 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-night-700 rounded-2xl shadow-card-lg w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-green-100 dark:border-night-500">
          <h2 className="text-green-900 dark:text-white font-bold text-base">{title}</h2>
          <button onClick={onClose} className="text-green-400 dark:text-night-300 hover:text-green-700 dark:hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}
