import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function AnnouncementList({ staffView = false, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.listStaffAnnouncements();
      setItems(d.announcements);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this announcement?')) return;
    setBusyId(id);
    try {
      await api.deleteAnnouncement(id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-3 py-8 text-sm text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        Loading announcements…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-cta/15 px-3 py-2 text-xs text-cta ring-1 ring-cta/30">
          {error}
        </p>
      )}

      {items.length === 0 && (
        <div className="rounded-xl bg-surface p-10 text-center ring-1 ring-white/5">
          <p className="text-sm text-muted">
            {staffView ? 'No announcements yet. Post the first one above.' : 'No announcements yet.'}
          </p>
        </div>
      )}

      {items.map((a) => (
        <article
          key={a.id}
          className={`rounded-xl bg-surface p-4 ring-1 ${a.pinned ? 'ring-accent/40' : 'ring-white/10'}`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
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
                <h3 className="truncate text-sm font-semibold">{a.title}</h3>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">{a.body}</p>
              <p className="mt-3 text-[11px] text-muted">
                {a.authorEmail || 'unknown'} · {fmt(a.publishedAt)}
              </p>
            </div>

            {staffView && (
              <button
                type="button"
                disabled={busyId === a.id}
                onClick={() => remove(a.id)}
                className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-cta transition hover:brightness-125 disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

/** Composer shown to admins and moderators. */
export function AnnouncementComposer({ onPosted }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const d = await api.createAnnouncement({ title, body, audience, pinned });
      setTitle('');
      setBody('');
      setPinned(false);
      setMessage({
        ok: true,
        text: `Posted. ${d.notified} ${
          d.notified === 1 ? 'person was' : 'people were'
        } notified.`,
      });
      onPosted?.();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-lg bg-surface px-3 py-2 text-sm text-text ring-1 ring-white/10 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl bg-surface p-5 ring-1 ring-white/10">
      <div>
        <label htmlFor="ann-title" className="mb-1 block text-xs font-medium text-muted">
          Title
        </label>
        <input
          id="ann-title"
          required
          maxLength={140}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={input}
          placeholder="New season, server maintenance, beta opens…"
        />
      </div>

      <div>
        <label htmlFor="ann-body" className="mb-1 block text-xs font-medium text-muted">
          Update
        </label>
        <textarea
          id="ann-body"
          required
          rows={4}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={input}
          placeholder="Tell people what changed."
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="radio"
            name="audience"
            value="all"
            checked={audience === 'all'}
            onChange={() => setAudience('all')}
            className="accent-[#7B61FF]"
          />
          Everyone
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="radio"
            name="audience"
            value="staff"
            checked={audience === 'staff'}
            onChange={() => setAudience('staff')}
            className="accent-[#7B61FF]"
          />
          Staff only
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="accent-[#7B61FF]"
          />
          Pin to top
        </label>
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-xs ring-1 ${
            message.ok
              ? 'bg-accent/15 text-accent ring-accent/30'
              : 'bg-cta/15 text-cta ring-cta/30'
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
      >
        {busy ? 'Posting…' : 'Post announcement'}
      </button>
    </form>
  );
}
