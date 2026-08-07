import { cn } from '@/lib/utils'

type BadgeVariant = 'green' | 'copper' | 'red' | 'gray' | 'dark'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variants: Record<BadgeVariant, string> = {
  green:  'badge-green',
  copper: 'badge-copper',
  red:    'badge-red',
  gray:   'badge-gray',
  dark:   'badge-dark',
}

export function Badge({ variant = 'green', children, className }: BadgeProps) {
  return (
    <span className={cn(variants[variant], className)}>
      {children}
    </span>
  )
}
