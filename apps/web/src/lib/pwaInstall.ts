// Chrome fires beforeinstallprompt exactly once per page load, only to
// listeners already attached at that moment — it does NOT re-fire later.
// If we only start listening after login (as InstallPrompt.tsx used to),
// we silently miss it whenever Chrome decides to fire it while the user
// is still on the login/register page. This module attaches the listener
// immediately on script load, before React even mounts, so the event is
// never missed regardless of auth state or timing.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let capturedEvent: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  capturedEvent = e as BeforeInstallPromptEvent
  listeners.forEach((fn) => fn())
})

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return capturedEvent
}

export function onInstallPromptCaptured(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function clearInstallPrompt(): void {
  capturedEvent = null
}