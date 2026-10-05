import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../utils/timeAgo';

export default function Announcements() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isStaff = user && ['admin', 'moderator'].includes(user.role);

  // useCallback so the effect below does not need to disable its dep check.
  const load = useCallback(async () => {
    try {
      // Use the api client: an earlier hand-rolled fetch here referenced `r`
      // outside the .then callback where it was scoped, throwing at runtime.
      const d = await api.listAnnouncements();
      setItems(d.announcements);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const byStaff = new Set(['admin', 'moderator']);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24">
      <h1 className="text-2xl font-bold">Announcements</h1>
      <p className="mt-1 text-sm text-muted">
        {isStaff
          ? 'Everything posted here, including staff-only notices.'
          : 'Updates from the Animeta team.'}
      </p>

      {loading && (
        <p className="mt-8 flex items-center gap-3 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Loading…
        </p>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30">
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="mt-8 rounded-[var(--radius-card)] bg-surface p-12 text-center ring-1 ring-[var(--color-line)]">
          <p className="text-sm text-muted">No announcements yet.</p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {items.map((a) => (
          <article
            key={a.id}
            className={`rounded-[var(--radius-card)] bg-surface p-4 ring-1 ${
              a.pinned ? 'ring-accent/40' : 'ring-[var(--color-line-strong)]'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {a.pinned && (
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  pinned
                </span>
              )}
              {a.audience === 'staff' && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                  staff only
                </span>
              )}
              <h2 className="text-sm font-semibold">{a.title}</h2>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">{a.body}</p>
            <p className="mt-3 text-[11px] text-muted">
              {a.authorEmail || 'unknown'} · {timeAgo(a.publishedAt)}
              {a.edited && ' · edited'}
              {byStaff.has(user?.role) && ' · manage in the staff console'}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
