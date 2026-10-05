import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationsContext';
import { timeAgo } from '../utils/timeAgo';
import { useAuth } from '../context/AuthContext';

/**
 * The bell, split into two tabs.
 *
 * Ordinary notifications and support tickets are kept apart on purpose: a ticket
 * is somebody waiting for an answer, and a site-wide announcement is not. Mixing
 * them buries the one that needs a reply under the ones that only need reading.
 */
export default function NotificationBell() {
  const { user } = useAuth();
  const { items, unread, ticketUnread, open, setOpen, markRead, markGroupRead } =
    useNotifications();
  const [tab, setTab] = useState('normal');
  const navigate = useNavigate();
  const ref = useRef(null);

  const total = unread + ticketUnread;

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const { shown, tabUnread } = useMemo(() => {
    const inTab = (n) => (tab === 'tickets' ? n.kind === 'ticket' : n.kind !== 'ticket');
    const list = items.filter(inTab);
    return { shown: list, tabUnread: list.filter((n) => !n.readAt).length };
  }, [items, tab]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={total > 0 ? `Notifications, ${total} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] bg-surface text-muted ring-1 ring-[var(--color-line-strong)] transition hover:text-text"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
          <path d="M12 22a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0012 22zm7-6v-5a7 7 0 10-14 0v5l-2 2v1h18v-1l-2-2z" />
        </svg>
        {total > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-bold text-white">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-2xl ring-1 ring-[var(--color-line-strong)] sm:w-96">
          <div className="flex gap-1 border-b border-[var(--color-line-strong)] px-2 pt-2">
            {[
              { id: 'normal', label: 'Notifications', count: unread },
              { id: 'tickets', label: 'Tickets', count: ticketUnread },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition ${
                  tab === t.id
                    ? 'border-accent text-text'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="rounded-full bg-[var(--color-accent)] px-1.5 text-[10px] font-bold text-white">
                    {t.count > 9 ? '9+' : t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-2">
            <span className="text-[11px] text-muted">
              {tabUnread} unread in {tab === 'tickets' ? 'tickets' : 'notifications'}
            </span>
            {tabUnread > 0 && (
              <button
                type="button"
                onClick={() => markGroupRead(tab)}
                className="text-xs font-medium text-accent hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-96 divide-y divide-white/5 overflow-y-auto">
            {shown.length === 0 && (
              <li className="px-4 py-8 text-center text-xs text-muted">
                {tab === 'tickets' ? 'No ticket activity yet.' : 'Nothing yet.'}
              </li>
            )}

            {shown.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!n.readAt) markRead(n.id);
                    if (n.link) {
                      setOpen(false);
                      navigate(n.link);
                    }
                  }}
                  className={`block w-full px-4 py-3 text-left transition hover:bg-surface-2 ${
                    n.readAt ? '' : 'bg-accent/5'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                    )}
                    <div className={n.readAt ? 'pl-4' : ''}>
                      <p className="text-sm font-medium leading-snug">{n.title}</p>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>}
                      <p className="mt-1 text-[11px] text-muted">
                        {timeAgo(n.createdAt)}
                        {n.actor && ` · ${n.actor}`}
                        {n.kind === 'password_reset_request' && ' · needs a link'}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-[var(--color-line-strong)] px-4 py-2.5">
            {tab === 'tickets' ? (
              <Link
                to="/support"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-accent hover:underline"
              >
                Go to support
              </Link>
            ) : (
              <Link
                to="/announcements"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-accent hover:underline"
              >
                View all announcements
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
