export function LogoLoader({ size = 64 }: { size?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <span
        className="absolute inset-0 rounded-full border-4 border-green-100 dark:border-night-500 border-t-green-700 dark:border-t-copper-400 animate-spin"
      />
      <div
        className="bg-green-900 rounded-2xl flex items-center justify-center"
        style={{ width: size * 0.55, height: size * 0.55 }}
      >
        <span className="text-copper-400 font-extrabold" style={{ fontSize: size * 0.28 }}>₦</span>
      </div>
    </div>
  )
}