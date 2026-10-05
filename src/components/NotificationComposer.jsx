import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const INPUT =
  'w-full rounded-[var(--radius-control)] bg-surface px-3 py-2 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

const AUDIENCES = [
  { id: 'all', label: 'Everyone' },
  { id: 'users', label: 'Regular users' },
  { id: 'staff', label: 'Staff only' },
  { id: 'ids', label: 'Specific people' },
];

/**
 * Direct notification composer.
 *
 * Separate from announcements: an announcement is a public post that appears on
 * the announcements page, whereas this pushes an inbox item to chosen
 * recipients without publishing anything.
 */
export default function NotificationComposer({ onSent }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [audience, setAudience] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('');
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // Recipient list for the picker. Moderators may only message staff and
  // themselves, so the picker hides regular users for them.
  useEffect(() => {
    if (audience !== 'ids') return;
    let cancelled = false;
    api
      .listUsers()
      .then((d) => {
        if (cancelled) return;
        setPeople(
          isAdmin ? d.users : d.users.filter((u) => ['admin', 'moderator'].includes(u.role)),
        );
      })
      .catch((e) => !cancelled && setMessage({ ok: false, text: e.message }));
    return () => {
      cancelled = true;
    };
  }, [audience, isAdmin]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.email.toLowerCase().includes(q));
  }, [people, filter]);

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const d = await api.sendNotification({
        title,
        body,
        link: link.trim() || null,
        target: audience,
        userIds: audience === 'ids' ? selected : undefined,
      });
      setTitle('');
      setBody('');
      setLink('');
      setSelected([]);
      setMessage({ ok: true, text: `Sent to ${d.notified} recipient(s).` });
      onSent?.();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = title.trim() && body.trim() && (audience !== 'ids' || selected.length > 0);

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-[var(--radius-card)] bg-surface p-5 ring-1 ring-[var(--color-line-strong)]">
      <div>
        <h3 className="text-sm font-semibold">Send a notification</h3>
        <p className="mt-0.5 text-[11px] text-muted">
          Goes straight to inboxes. Nothing is published to the announcements page.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Send to</label>
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setAudience(a.id);
                setMessage(null);
              }}
              aria-pressed={audience === a.id}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                audience === a.id
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-muted ring-1 ring-[var(--color-line-strong)] hover:text-text'
              }`}
            >
              {a.label}
              {a.id === 'ids' && selected.length > 0 && ` (${selected.length})`}
            </button>
          ))}
        </div>
      </div>

      {audience === 'ids' && (
        <div className="rounded-[var(--radius-control)] bg-bg p-3 ring-1 ring-[var(--color-line-strong)]">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by email…"
            aria-label="Filter recipients"
            className={INPUT}
          />
          <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-1 py-3 text-center text-xs text-muted">No accounts to show.</li>
            )}
            {filtered.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    className="accent-[#7B61FF]"
                  />
                  <span className="min-w-0 flex-1 truncate">{p.email}</span>
                  <span className="text-[10px] text-muted">{p.role}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="mt-2 text-[11px] font-medium text-accent hover:underline"
            >
              Clear {selected.length} selected
            </button>
          )}
        </div>
      )}

      <div>
        <label htmlFor="send-title" className="mb-1 block text-xs font-medium text-muted">
          Title
        </label>
        <input
          id="send-title"
          required
          maxLength={140}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={INPUT}
          placeholder="Season 2 is live"
        />
      </div>

      <div>
        <label htmlFor="send-body" className="mb-1 block text-xs font-medium text-muted">
          Message
        </label>
        <textarea
          id="send-body"
          required
          rows={3}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={INPUT}
          placeholder="What do they need to know?"
        />
      </div>

      <div>
        <label htmlFor="send-link" className="mb-1 block text-xs font-medium text-muted">
          Link (optional, internal path)
        </label>
        <input
          id="send-link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="/title/solaris-requiem"
          className={INPUT}
        />
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-[var(--radius-control)] px-3 py-2 text-xs ring-1 ${
            message.ok
              ? 'bg-accent/15 text-accent ring-accent/30'
              : 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] ring-[var(--color-danger)]/30'
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !canSubmit}
        className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send notification'}
      </button>
    </form>
  );
}
