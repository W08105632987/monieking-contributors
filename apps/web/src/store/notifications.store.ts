import { create } from 'zustand'
import type { AppNotification } from '@/types'

interface NotificationsState {
  notifications: AppNotification[]
  unreadCount: number
  setNotifications: (n: AppNotification[]) => void
  setUnreadCount: (count: number) => void
  markRead: (id: string) => void
  markAllRead: () => void
  addNotification: (n: AppNotification) => void
  reset: () => void
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  notifications: [],
  unreadCount: 0,
  setNotifications: (notifications) =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.is_read).length,
    }),
  setUnreadCount: (count) => set({ unreadCount: count }),
  markRead: (id) =>
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, is_read: true } : n,
      )
      return { notifications, unreadCount: notifications.filter((n) => !n.is_read).length }
    }),
  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    })),
  addNotification: (notification) =>
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadCount: notification.is_read ? state.unreadCount : state.unreadCount + 1,
    })),

  reset: () => set({ notifications: [], unreadCount: 0 }),
}))
