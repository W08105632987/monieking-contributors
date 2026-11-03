import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { post, useCoopAction } from './api'
import { ChatThread, type ChatNote } from './chat'
import { Skel } from './ui'

/** Two-way conversation on a dividend dispute. Both sides keep talking until a director resolves it. */
export function DividendDisputeThread({ disputeId, viewer, firstAuthor }: { disputeId: string; viewer: 'member' | 'director'; firstAuthor: string }) {
  const { data, refetch } = useQuery<any>({
    queryKey: ['coop', 'dividend-dispute', disputeId], refetchInterval: 6000,
    queryFn: async () => (await api.get(`/coop/dividend-disputes/${disputeId}`)).data,
  })
  const send = useCoopAction((t: string) => post(`/coop/dividend-disputes/${disputeId}/messages`, { body: t }), { onSuccess: () => { refetch() } })
  if (!data) return <Skel h="h-32" />
  const notes: ChatNote[] = data.messages.map((m: any) => ({
    id: m.id, body: m.body, author: m.from, at: m.at, kind: 'message',
    from_member: m.role === 'member', from_director: m.role === 'director',
  }))
  return (
    <div className="max-h-[52vh] overflow-y-auto pr-1">
      <ChatThread viewer={viewer} first={{ author: firstAuthor, body: data.opened_message, at: data.created_at }} notes={notes}
        onSend={(t) => send.mutate(t)} sending={send.isPending}
        locked={!data.can_reply} lockedText={data.resolution ? `Resolved: ${data.resolution}` : 'This dispute is resolved.'}
        placeholder={viewer === 'member' ? 'Reply to the directors' : 'Reply to the member'} />
    </div>
  )
}
