import { useState, useRef } from 'react'
import { UploadCloud, CheckCircle2, X, FileText, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'

interface FileUploadFieldProps {
  label: string
  helperText?: string
  required?: boolean
  value?: string
  onChange: (url: string) => void
  accept?: string
}

export function FileUploadField({
  label,
  helperText,
  required = false,
  value,
  onChange,
  accept = 'image/jpeg,image/png,image/webp,application/pdf',
}: FileUploadFieldProps) {
  const [uploading, setUploading] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File exceeds maximum size of 5MB')
      return
    }

    setFileName(file.name)
    setUploading(true)

    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const base64 = reader.result as string
          const { data } = await api.post<{ url: string; filename: string }>('/manual-services/upload', {
            filename: file.name,
            file_base64: base64,
          })
          onChange(data.url)
          toast.success(`${label} uploaded!`)
        } catch {
          // If server upload fails, fallback to base64
          onChange(reader.result as string)
        } finally {
          setUploading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch {
      toast.error('Could not read file')
      setUploading(false)
    }
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setFileName(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-green-700 dark:text-night-300 text-xs font-semibold uppercase tracking-wider">
          {label} {required ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal lowercase">(optional)</span>}
        </label>
        {value && !uploading && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
          </span>
        )}
      </div>

      {helperText && (
        <p className="text-[11px] text-green-600/80 dark:text-night-400 leading-tight">
          {helperText}
        </p>
      )}

      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-3.5 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
          value
            ? 'border-emerald-500/60 bg-emerald-50/40 dark:bg-emerald-950/20'
            : 'border-green-200 dark:border-night-600 hover:border-green-400 bg-white/60 dark:bg-night-700/60'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="hidden"
        />

        {uploading ? (
          <div className="flex items-center gap-2 py-2 text-green-700 dark:text-night-200 text-xs font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-green-600" />
            <span>Uploading document...</span>
          </div>
        ) : value ? (
          <div className="flex items-center justify-between w-full px-2 py-1">
            <div className="flex items-center gap-2.5 truncate">
              <FileText className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <span className="text-xs font-mono font-medium text-green-900 dark:text-white truncate">
                {fileName || 'Document attached'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 hover:text-red-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 py-1">
            <UploadCloud className="w-5 h-5 text-green-600 dark:text-night-300" />
            <p className="text-xs font-medium text-green-800 dark:text-night-200">
              Click to choose file <span className="text-[11px] text-gray-400 font-normal">(Max 5MB)</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
