import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="min-h-dvh flex flex-col bg-hero-gradient">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-copper-400 flex items-center justify-center text-3xl font-black text-green-900 mx-auto mb-3 shadow-copper">
            ₦
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">MonieKing</h1>
          <p className="text-green-300 text-sm mt-1">Contributors Platform</p>
        </div>
        <div className="w-full max-w-sm">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
