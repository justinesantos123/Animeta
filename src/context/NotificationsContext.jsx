import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';

const NotificationsContext = createContext(null);

const POLL_MS = 30000;

export function NotificationsProvider({ children }) {
  const { user, ready } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setUnread(0);
      return;
    }
    try {
      const d = await api.listNotifications();
      setItems(d.notifications);
      setUnread(d.unread);
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
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
      setUnread((u) => Math.max(0, u - 1));
      await api.markNotificationRead(id).catch(() => refresh());
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnread(0);
    await api.markAllNotificationsRead().catch(() => refresh());
  }, [refresh]);

  const value = useMemo(
    () => ({ items, unread, open, setOpen, refresh, markRead, markAllRead }),
    [items, unread, open, refresh, markRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}