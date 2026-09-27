import { useCallback, startTransition } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'

/**
 * Custom navigate hook that wraps navigation in React 18 `startTransition`.
 * This marks page-transition suspense as non-urgent, keeping the outgoing
 * page visible while new lazy-loaded route chunks are downloaded, preventing
 * full-screen blank/spinner flashes.
 */
export function useAppNavigate() {
  const navigate = useNavigate()

  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      startTransition(() => {
        if (typeof to === 'number') {
          navigate(to)
        } else {
          navigate(to, options)
        }
      })
    },
    [navigate],
  )
}
