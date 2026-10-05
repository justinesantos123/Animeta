import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';

const NotificationsContext = createContext(null);

const POLL_MS = 30000;

export function NotificationsProvider({ children }) {
  const { user, ready } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  // Split here rather than in the bell: "mark all read" has to act on one group
  // or the other, and if the split only existed at render time the button would
  // mark both.
  const [ticketUnread, setTicketUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setUnread(0);
      setTicketUnread(0);
      return;
    }
    try {
      const d = await api.listNotifications();
      setItems(d.notifications);
      setUnread(d.unread);
      setTicketUnread(d.ticketUnread ?? 0);
    } catch {
      /* offline or signed out mid-poll - keep the last known state */
    }
  }, [user]);

  useEffect(() => {
    if (!ready) return undefined;
    refresh();
    if (!user) return undefined;
    timerRef.current = setInterval(refresh, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [ready, user, refresh]);

  const markRead = useCallback(
    async (id) => {
      // Optimistic so the badge reacts immediately.
      const target = items.find((n) => n.id === id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
      if (target?.kind === 'ticket') setTicketUnread((u) => Math.max(0, u - 1));
      else setUnread((u) => Math.max(0, u - 1));
      await api.markNotificationRead(id).catch(() => refresh());
    },
    [items, refresh],
  );

  /** Marks one group read, leaving the other alone. */
  const markGroupRead = useCallback(
    async (kind) => {
      const now = new Date().toISOString();
      const matches = (n) => (kind === 'ticket' ? n.kind === 'ticket' : n.kind !== 'ticket');
      setItems((prev) => prev.map((n) => (matches(n) && !n.readAt ? { ...n, readAt: now } : n)));
      if (kind === 'ticket') setTicketUnread(0);
      else setUnread(0);
      await api.markAllNotificationsRead(kind).catch(() => refresh());
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnread(0);
    setTicketUnread(0);
    await api.markAllNotificationsRead('all').catch(() => refresh());
  }, [refresh]);

  const value = useMemo(
    () => ({
      items,
      unread,
      ticketUnread,
      open,
      setOpen,
      refresh,
      markRead,
      markGroupRead,
      markAllRead,
    }),
    [items, unread, ticketUnread, open, refresh, markRead, markGroupRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}