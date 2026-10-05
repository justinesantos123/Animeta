import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { timeAgo } from '../utils/timeAgo';

const STATUS_TABS = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

/**
 * Support tickets, for either side of the conversation.
 *
 * `mode` decides the framing, not the permissions: the API returns a member's own
 * tickets and staff see the queue based on the session, so there is no way to
 * reach somebody else's ticket by choosing a different mode here.
 *
 *   member  their own tickets, with a form to open one
 *   staff   the queue, with the requester's address and a close action
 */
export default function TicketsPanel({ mode = 'member', canClose = false }) {
  const isStaff = mode === 'staff';

  const [status, setStatus] = useState('open');
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ open: 0, closed: 0, total: 0 });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listTickets(status);
      setTickets(d.tickets);
      setCounts(d.counts);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-read after anything that mutates the open ticket. Closing or replying
  // changes its status, and leaving the copy already loaded on screen would show
  // a stale status until the member navigated away. Done explicitly rather than
  // in an effect on the id, so selecting a ticket fetches it exactly once.
  const refreshSelected = useCallback(async (id) => {
    if (!id) return;
    try {
      const d = await api.getTicket(id);
      setSelected(d);
    } catch {
      setSelected(null);
    }
  }, []);

  async function afterMutation(id) {
    await load();
    await refreshSelected(id);
  }

  const tabCounts = useMemo(
    () => ({ open: counts.open, closed: counts.closed, all: counts.total }),
    [counts],
  );

  return (
    <div className="space-y-5">
      {!isStaff && (
        <NewTicket
          open={composing}
          onOpen={() => setComposing(true)}
          onCancel={() => setComposing(false)}
          onCreated={async (id) => {
            setComposing(false);
            await load();
            await refreshSelected(id);
          }}
          setError={setError}
        />
      )}

      <div className="flex gap-1 border-b border-[var(--color-line-strong)]" role="tablist">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={status === t.id}
            onClick={() => setStatus(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
              status === t.id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[11px] tabular-nums text-faint">{tabCounts[t.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30"
        >
          {error}
        </p>
      )}

      <div className={selected ? 'grid gap-5 lg:grid-cols-[20rem_1fr]' : ''}>
        <div className={selected ? 'lg:max-h-[36rem] lg:overflow-y-auto' : ''}>
          {loading && tickets.length === 0 && (
            <p className="py-6 text-sm text-muted">Loading tickets…</p>
          )}
          {!loading && tickets.length === 0 && (
            <p className="rounded-[var(--radius-card)] bg-surface px-4 py-8 text-center text-sm text-muted ring-1 ring-[var(--color-line-strong)]">
              {status === 'open'
                ? isStaff
                  ? 'No tickets are waiting.'
                  : 'You have no open tickets.'
                : 'Nothing here.'}
            </p>
          )}

          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => refreshSelected(t.id)}
                  className={`w-full rounded-[var(--radius-card)] px-4 py-3 text-left ring-1 transition ${
                    selected?.ticket?.id === t.id
                      ? 'bg-accent/10 ring-accent/40'
                      : 'bg-surface ring-[var(--color-line-strong)] hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-snug">{t.subject}</p>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        t.status === 'open'
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-white/10 text-muted'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                  {isStaff && t.requesterEmail && (
                    <p className="mt-1 truncate text-[11px] text-muted">{t.requesterEmail}</p>
                  )}
                  <p className="mt-1 text-[11px] text-faint">
                    {t.messageCount} message{t.messageCount === 1 ? '' : 's'} ·{' '}
                    {timeAgo(t.lastMessageAt)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected && (
          <Thread
            data={selected}
            isStaff={isStaff}
            canClose={canClose}
            onReplied={() => afterMutation(selected.ticket.id)}
            onClosed={() => afterMutation(selected.ticket.id)}
            onBack={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

/** The reply box and close action for one ticket. */
function Thread({ data, isStaff, canClose, onReplied, onClosed, onBack }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ticket = data.ticket;

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.replyTicket(ticket.id, message);
      setMessage('');
      await onReplied();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    setError(null);
    try {
      await api.closeTicket(ticket.id);
      await onClosed();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line-strong)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line-strong)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{ticket.subject}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {ticket.status === 'closed' ? 'Closed' : 'Open'} · {ticket.messageCount} message
            {ticket.messageCount === 1 ? '' : 's'}
            {isStaff && ticket.requesterEmail ? ` · ${ticket.requesterEmail}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canClose && ticket.status !== 'closed' && (
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text transition hover:bg-surface-3 disabled:opacity-50"
            >
              Mark resolved
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="rounded-[var(--radius-control)] px-2 py-1 text-xs text-muted transition hover:text-text"
          >
            Close
          </button>
        </div>
      </div>

      <ul className="max-h-80 divide-y divide-white/5 overflow-y-auto">
        {(data.messages || []).map((m) => (
          <li
            key={m.id}
            className={`px-4 py-3 ${m.side === 'staff' ? 'bg-accent/5' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-text">
                {m.side === 'staff' ? 'Staff' : isStaff && m.authorEmail ? m.authorEmail : 'You'}
              </p>
              <p className="text-[11px] text-faint">{timeAgo(m.createdAt)}</p>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
              {m.body}
            </p>
            {/* Only staff may post links, so the record shows plainly when one is
                present rather than the message looking silently different. */}
            {m.hasLink && (
              <p className="mt-1 text-[10px] uppercase tracking-wide text-faint">
                contains a link
              </p>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={send} className="border-t border-[var(--color-line-strong)] p-4">
        <label htmlFor="ticket-reply" className="mb-1 block text-xs font-medium text-muted">
          {isStaff ? 'Reply to the member' : 'Add a reply'}
        </label>
        <textarea
          id="ticket-reply"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          required
          className="w-full rounded-[var(--radius-control)] bg-bg px-3 py-2 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
          placeholder={
            isStaff
              ? 'Answer their question…'
              : 'Add anything that helps staff answer…'
          }
        />
        {/* Stated here as well as enforced server-side. The server is the real
            gate; this exists so the rule is not a surprise when the send is
            refused. */}
        <p className="mt-1.5 text-[11px] text-muted">
          {isStaff
            ? 'Links are allowed in staff replies.'
            : 'Links are not allowed in tickets. Describe the problem in words.'}
        </p>

        {error && (
          <p
            role="alert"
            className="mt-2 rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
        >
          {busy ? 'Sending…' : ticket.status === 'closed' ? 'Reply and reopen' : 'Send reply'}
        </button>
      </form>
    </div>
  );
}

/** The "ask for help" form. Members only. */
function NewTicket({ open, onOpen, onCancel, onCreated, setError }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
      >
        Ask staff for help
      </button>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api.createTicket({ subject, message });
      setSubject('');
      setMessage('');
      await onCreated(d.ticket.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[var(--radius-card)] bg-surface p-4 ring-1 ring-[var(--color-line-strong)]"
    >
      <h3 className="text-sm font-semibold">Ask staff for help</h3>
      <p className="mt-1 text-[11px] text-muted">
        Tell us what is wrong and staff will reply here. Links are not allowed in a ticket — that
        keeps it about your account rather than anywhere else.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="ticket-subject" className="mb-1 block text-xs font-medium text-muted">
            Subject
          </label>
          <input
            id="ticket-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            maxLength={120}
            className="w-full rounded-[var(--radius-control)] bg-bg px-3 py-2 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
            placeholder="Cannot play episode 2"
          />
        </div>
        <div>
          <label htmlFor="ticket-message" className="mb-1 block text-xs font-medium text-muted">
            What is happening?
          </label>
          <textarea
            id="ticket-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            rows={4}
            className="w-full rounded-[var(--radius-control)] bg-bg px-3 py-2 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
            placeholder="As much detail as you have: what you tried, and what happened."
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send to staff'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold text-muted transition hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}