import { useEffect, useState } from 'react';
import { AnnouncementList } from '../components/Announcements';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';

export default function Announcements() {
  const { user } = useAuth();
  const { refresh } = useNotifications();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isStaff = user && ['admin', 'moderator'].includes(user.role);

  async function load() {
    try {
      const d = await fetch('/api/announcements', { credentials: 'same-origin' }).then((r) => r.json());
      if (!r.ok) throw new Error(d.error || 'Could not load announcements');
      setItems(d.announcements);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function fmt(iso) {
    if (!iso) return '';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24">
      <h1 className="text-2xl font-extrabold">Announcements</h1>
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
        <p role="alert" className="mt-6 rounded-lg bg-cta/15 px-3 py-2 text-xs text-cta ring-1 ring-cta/30">
          {error}
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="mt-8 rounded-xl bg-surface p-12 text-center ring-1 ring-white/5">
          <p className="text-sm text-muted">No announcements yet.</p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {items.map((a) => (
          <article
            key={a.id}
            className={`rounded-xl bg-surface p-4 ring-1 ${
              a.pinned ? 'ring-accent/40' : 'ring-white/10'
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
              {a.authorEmail || 'unknown'} · {fmt(a.publishedAt)}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
