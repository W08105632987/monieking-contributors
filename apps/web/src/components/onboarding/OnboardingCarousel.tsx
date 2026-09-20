import { OnboardingScreen } from './OnboardingScreen'

/**
 * Thin wrapper so OnboardingScreen.tsx (the person's own component,
 * carried over as-is — see that file's header) doesn't need to know
 * anything about how this app mounts it. OnboardingScreen itself uses
 * `relative` positioning (it was built as a full page/route, not an
 * overlay) — this wrapper is what turns it into the same kind of
 * full-screen overlay the splash screen uses in App.tsx, without
 * editing a single line inside OnboardingScreen.tsx to do it.
 */
export function OnboardingCarousel() {
  return (
    <div className="onboarding-unscaled fixed inset-0 z-[900] overflow-hidden select-none">
      <OnboardingScreen />
    </div>
  )
}
