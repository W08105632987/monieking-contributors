import { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isCoinSoundMuted, setCoinSoundMuted, playCoin } from '@/lib/coinSound'

/** Small speaker button: tap to mute / unmute the "money received" coin sound. Plays a preview when turning on. */
export function CoinSoundToggle({ className }: { className?: string }) {
  const [muted, setMuted] = useState(() => isCoinSoundMuted())

  const toggle = () => {
    const next = !muted
    setMuted(next)
    setCoinSoundMuted(next)
    if (!next) playCoin({ force: true }) // preview
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={muted ? 'Turn on money received sound' : 'Turn off money received sound'}
      aria-pressed={!muted}
      title={muted ? 'Money sound off' : 'Money sound on'}
      className={cn('w-9 h-9 bg-green-100 dark:bg-night-600 rounded-xl flex items-center justify-center', className)}
    >
      {muted
        ? <VolumeX className="w-4 h-4 text-green-600 dark:text-night-200" />
        : <Volume2 className="w-4 h-4 text-green-600 dark:text-night-200" />}
    </button>
  )
}
