import { LogoLoader } from './LogoLoader'

export function PleaseHold({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white/95 dark:bg-night-900/95 backdrop-blur-sm">
      <LogoLoader size={48} />
      <p className="text-green-800 dark:text-white text-sm font-semibold px-6 text-center">{message}</p>
    </div>
  )
}