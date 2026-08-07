import { cn, initials } from '@/lib/utils'

interface AvatarProps {
  name: string
  avatarUrl?: string | null
  size?: number
  className?: string
}

export function Avatar({ name, avatarUrl, size = 40, className }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn('rounded-full object-cover flex-shrink-0', className)}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className={cn('rounded-full bg-green-900 flex items-center justify-center font-bold text-amber-400 flex-shrink-0', className)}
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials(name)}
    </div>
  )
}
