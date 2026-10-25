/** Reading a token out loud with the browser's own speech engine (no network, no cost). */
export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel()
}

/** Returns a function that stops the speech early. */
export function speak(text: string, handlers: { onStart?: () => void; onEnd?: () => void } = {}): () => void {
  if (!speechSupported()) { handlers.onEnd?.(); return () => {} }
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-NG'      // the browser falls back to the closest English voice it has
  utterance.rate = 0.8          // slower than normal: someone is writing this down
  utterance.onstart = () => handlers.onStart?.()
  utterance.onend = () => handlers.onEnd?.()
  utterance.onerror = () => handlers.onEnd?.()
  synth.speak(utterance)
  return () => synth.cancel()
}
