import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { dShort } from './ui'

export interface ChatNote { id: string; body: string; author: string; at: string; from_member: boolean; from_director: boolean; kind: string }

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })

function Bubble({ mine, author, body, at }: { mine: boolean; author: string; body: string; at: string }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 shadow-card ${mine ? 'rounded-br-md bg-green-700 text-white dark:bg-green-600' : 'rounded-bl-md border border-green-100 bg-white text-green-900 dark:border-night-500 dark:bg-night-700 dark:text-white'}`}>
        {!mine && <p className="mb-0.5 text-[11px] font-extrabold text-green-600 dark:text-night-300">{author}</p>}
        <p className="whitespace-pre-wrap break-words text-sm">{body}</p>
        <p className={`mt-1 text-right text-[10px] ${mine ? 'text-green-100' : 'text-green-500 dark:text-night-300'}`}>{dShort(at)} · {timeOf(at)}</p>
      </div>
    </div>
  )
}

/**
 * A WhatsApp-style conversation between a member and the directors.
 * `viewer` decides which side is "mine". The first bubble is the original complaint.
 */
export function ChatThread({ viewer, first, notes, onSend, sending, locked, lockedText, placeholder }: {
  viewer: 'member' | 'director'
  first: { author: string; body: string; at: string }
  notes: ChatNote[]
  onSend: (text: string) => void
  sending?: boolean
  locked?: boolean
  lockedText?: string
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [notes.length])
  const send = () => { const t = text.trim(); if (!t || sending) return; onSend(t); setText('') }
  const chat = notes.filter((n) => n.kind === 'message' || n.kind === 'response')
  return (
    <div className="flex flex-col">
      <div className="space-y-2 pb-3">
        <Bubble mine={viewer === 'member'} author={first.author} body={first.body} at={first.at} />
        {chat.map((n) => <Bubble key={n.id} mine={viewer === 'member' ? n.from_member : n.from_director} author={n.author} body={n.body} at={n.at} />)}
        <div ref={end} />
      </div>
      {locked ? (
        <p className="sticky bottom-0 rounded-xl bg-green-100 p-3 text-center text-xs font-semibold text-green-800 dark:bg-night-600 dark:text-night-100">{lockedText ?? 'This conversation is closed.'}</p>
      ) : (
        <div className="sticky bottom-0 -mx-4 flex items-end gap-2 border-t border-green-100 bg-green-50 px-4 py-2 dark:border-night-500 dark:bg-night-800">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000} placeholder={placeholder ?? 'Write a message'} aria-label="Write a message"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-green-200 bg-white px-3.5 py-2.5 text-sm text-green-900 outline-none focus:border-green-500 dark:border-night-400 dark:bg-night-700 dark:text-white" />
          <button onClick={send} disabled={!text.trim() || sending} aria-label="Send message" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-green-700 text-white shadow-card disabled:opacity-40 active:scale-95 dark:bg-green-600"><Send className="h-5 w-5" /></button>
        </div>
      )}
    </div>
  )
}
