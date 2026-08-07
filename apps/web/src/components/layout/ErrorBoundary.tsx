import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Catches any uncaught render-time error anywhere in the component tree
 * below it and shows a friendly recovery screen instead of a blank white
 * page. This is the client-side counterpart to MaintenancePage (which
 * handles the backend being unreachable) — this one handles a JS crash
 * in the frontend itself (e.g. a malformed API response shape, a bad
 * third-party render). Mounted once around the whole app in App.tsx.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: unknown) {
    // eslint-disable-next-line no-console
    console.error('Uncaught render error:', error, info)
  }

  handleReload = () => {
    this.setState({ hasError: false })
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-green-50 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4">
            <span className="text-3xl">😕</span>
          </div>
          <h1 className="text-green-900 font-extrabold text-xl mb-2">Something went wrong</h1>
          <p className="text-green-500 text-sm leading-relaxed max-w-xs mb-6">
            That wasn't supposed to happen. Your account and your money are unaffected — let's get you back to somewhere safe.
          </p>
          <button
            onClick={this.handleReload}
            className="flex items-center gap-2 bg-green-900 text-white font-bold text-sm rounded-full px-6 py-3 active:scale-95 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Reload MonieKing
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
