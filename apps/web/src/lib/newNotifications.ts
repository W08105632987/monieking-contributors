import type { AppNotification } from '@/types'

/**
 * Given the newest notifications from the server and the set of ids we have
 * already announced, return the unread ones that are new (oldest first) and
 * mark them as seen. Pure, so it is unit-tested without a browser.
 */
export function pickNewUnread(items: AppNotification[], seen: Set<string>): AppNotification[] {
  const fresh: AppNotification[] = []
  for (const n of items) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    if (!n.is_read) fresh.push(n)
  }
  return fresh.reverse()
}

/** Where tapping the in-app banner should go, per role. */
export function notificationsPathForRole(role: string | undefined): string {
  switch (role) {
    case 'customer': return '/customer/notifications'
    case 'officer': return '/officer/notifications'
    case 'director': return '/director/notifications'
    case 'service_worker': return '/worker/notifications'
    default: return '/'
  }
}
