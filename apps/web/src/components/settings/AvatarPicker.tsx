import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, getErrorMessage } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'

interface AvatarPickerProps {
  name: string
  avatarUrl: string | null
  onUploaded: (newUrl: string) => void
}

export function AvatarPicker({ name, avatarUrl, onUploaded }: AvatarPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Please choose an image under 3MB')
      return
    }

    setUploading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const { data } = await api.post<{ avatar_url: string | null }>('/users/me/avatar', { image_base64: dataUrl })
      if (data.avatar_url) onUploaded(data.avatar_url)
      toast.success('Profile picture updated')
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Could not upload image')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="relative inline-block">
      <Avatar name={name} avatarUrl={avatarUrl} size={64} className="text-xl" />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center active:scale-90 transition-all"
        aria-label="Change profile picture"
      >
        <Camera className="w-3.5 h-3.5 text-green-900" />
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      {uploading && <p className="text-green-400 text-[10px] text-center mt-1">Uploading…</p>}
    </div>
  )
}
