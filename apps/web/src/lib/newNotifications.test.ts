import { describe, it, expect } from 'vitest'
import { pickNewUnread, notificationsPathForRole } from './newNotifications'
import type { AppNotification } from '@/types'

const n = (id: string, is_read = false): AppNotification => ({
  id, user_id: 'u', title: `t${id}`, body: 'b', type: 'info' as AppNotification['type'],
  is_read, related_entity_id: null, created_at: '2026-10-07T00:00:00Z',
})

describe('pickNewUnread', () => {
  it('returns unread items not seen before, oldest first (server sends newest first)', () => {
    const seen = new Set<string>()
    const fresh = pickNewUnread([n('3'), n('2'), n('1')], seen)
    expect(fresh.map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(seen.size).toBe(3)
  })
  it('never announces the same notification twice (push + poll both fire)', () => {
    const seen = new Set<string>()
    expect(pickNewUnread([n('1')], seen)).toHaveLength(1)
    expect(pickNewUnread([n('1')], seen)).toHaveLength(0)
  })
  it('only announces what is new on the next check', () => {
    const seen = new Set<string>()
    pickNewUnread([n('1')], seen)
    expect(pickNewUnread([n('2'), n('1')], seen).map((x) => x.id)).toEqual(['2'])
  })
  it('marks read items as seen but does not announce them', () => {
    const seen = new Set<string>()
    expect(pickNewUnread([n('1', true)], seen)).toHaveLength(0)
    expect(seen.has('1')).toBe(true)
  })
})

describe('notificationsPathForRole', () => {
  it('maps each role to its notifications page', () => {
    expect(notificationsPathForRole('customer')).toBe('/customer/notifications')
    expect(notificationsPathForRole('officer')).toBe('/officer/notifications')
    expect(notificationsPathForRole('director')).toBe('/director/notifications')
    expect(notificationsPathForRole('service_worker')).toBe('/worker/notifications')
    expect(notificationsPathForRole(undefined)).toBe('/')
  })
})
