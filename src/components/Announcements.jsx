import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../utils/timeAgo';
import NotificationComposer from './NotificationComposer';

const INPUT =
  'w-full rounded-[var(--radius-control)] bg-surface px-3 py-2 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

/** Inline edit form shared by "New" and "Edit". */
function AnnounceForm({ initial, submitLabel, onSubmit, onCancel, busy }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [audience, setAudience] = useState(initial?.audience ?? 'all');
  const [pinned, setPinned] = useState(Boolean(initial?.pinned));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title, body, audience, pinned });
      }}
      className="space-y-3 rounded-[var(--radius-card)] bg-surface p-5 ring-1 ring-[var(--color-line-strong)]"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Title</label>
        <input
          required
          maxLength={140}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={INPUT}
          placeholder="New season, server maintenance, beta opens…"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Update</label>
        <textarea
          required
          rows={4}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={INPUT}
          placeholder="Tell people what changed."
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="radio"
            name={`audience-${initial?.id ?? 'new'}`}
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
            name={`audience-${initial?.id ?? 'new'}`}
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

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-control)] bg-surface-2 px-4 py-2 text-sm font-semibold ring-1 ring-[var(--color-line-strong)]"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function PostCard({ a, onChanged }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isAdmin = user?.role === 'admin';
  const isAuthor = a.authorEmail && user?.email === a.authorEmail;
  const canManage = isAdmin || isAuthor;

  async function save(payload) {
    setBusy(true);
    setError(null);
    try {
      await api.updateAnnouncement(a.id, payload);
      setEditing(false);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this announcement?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAnnouncement(a.id);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <AnnounceForm
          initial={a}
          submitLabel="Save changes"
          busy={busy}
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <article
      className={`rounded-[var(--radius-card)] bg-surface p-4 ring-1 ${a.pinned ? 'ring-accent/40' : 'ring-[var(--color-line-strong)]'}`}
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
            {a.authorEmail || 'unknown'} · {timeAgo(a.publishedAt)}
            {a.edited && ' · edited'}
          </p>
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
              className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text transition hover:bg-[var(--color-surface-3)] disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-[var(--color-danger)] transition hover:bg-[var(--color-surface-3)] disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30">
          {error}
        </p>
      )}
    </article>
  );
}

/** Admin-only switch for the automatic "welcome back" inbox message. */
function AutoWelcomeToggle() {
  const { user } = useAuth();
  const [on, setOn] = useState(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    api
      .getSettings()
      .then((d) => {
        setOn(d.autoReturnNotifications);
        setDays(d.returnAfterDays);
      })
      .catch(() => setOn(null));
  }, [user]);

  if (user?.role !== 'admin' || on === null) return null;

  async function toggle() {
    setBusy(true);
    try {
      const d = await api.updateSettings({ autoReturnNotifications: !on });
      setOn(d.autoReturnNotifications);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-card)] bg-surface p-4 ring-1 ring-[var(--color-line-strong)]">
      <input
        id="auto-return"
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={toggle}
        className="mt-0.5 accent-[#7B61FF]"
      />
      <label htmlFor="auto-return" className="text-xs leading-relaxed">
        <span className="font-semibold">Automatic welcome-back</span>
        <span className="mt-0.5 block text-muted">
          When someone signs in after being away {days}+ days, send them an inbox notification
          automatically. Set this from the Dashboard tab, or use the composer below to message
          chosen people by hand.
        </span>
      </label>
    </div>
  );
}

/**
 * Staff announcement management. Posts can be created, edited and deleted:
 * authors manage their own, admins manage anyone's.
 */
export function AnnouncementManager({ onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

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

  async function create(payload) {
    setBusy(true);
    setNotice(null);
    try {
      const d = await api.createAnnouncement(payload);
      setNotice(
        `Posted. ${d.notified} ${d.notified === 1 ? 'person was' : 'people were'} notified.`,
      );
      await load();
      onChanged?.();
    } catch (e) {
      setNotice(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <AutoWelcomeToggle />
      <NotificationComposer onSent={onChanged} />
      <AnnounceForm submitLabel="Post announcement" busy={busy} onSubmit={create} />

      {notice && (
        <p
          role="status"
          className={`rounded-[var(--radius-control)] px-3 py-2 text-xs ring-1 ${
            notice.startsWith('Error')
              ? 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] ring-[var(--color-danger)]/30'
              : 'bg-accent/15 text-accent ring-accent/30'
          }`}
        >
          {notice}
        </p>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted">
          Posted {items.length > 0 && `(${items.length})`}
        </h2>

        {loading && (
          <p className="flex items-center gap-3 py-6 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading…
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30">
            {error}
          </p>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-[var(--radius-card)] bg-surface p-10 text-center ring-1 ring-[var(--color-line)]">
            <p className="text-sm text-muted">No announcements yet.</p>
          </div>
        )}

        <div className="space-y-3">
          {items.map((a) => (
            <PostCard key={a.id} a={a} onChanged={() => { load(); onChanged?.(); }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export { PostCard as AnnouncementCard };
