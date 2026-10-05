import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { timeAgo } from '../utils/timeAgo';

const STATUS_TABS = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

/**
 * How often an open conversation re-reads itself.
 *
 * This is polling, not push. The Worker has no pub/sub, so anything genuinely
 * real-time would mean a Durable Object holding a websocket per conversation --
 * more machinery than a support queue of this size justifies, and a new binding
 * to operate. Polling gets messages on screen in about this long, which for two
 * people talking is indistinguishable from live. Deliberately not faster: at
 * three seconds the queue costs little and nothing spams the account.
 */
const POLL_MS = 3000;

/** The queue itself refreshes less often than an open conversation. */
const QUEUE_POLL_MS = 8000;

/**
 * Support tickets, for either side of the conversation.
 *
 * `mode` decides the framing, not the permissions: the API returns a member's own
 * tickets and staff see the queue based on the session, so there is no way to
 * reach somebody else's ticket by choosing a different mode here.
 *
 * `ticketId` and `onSelect` keep the open conversation in the URL. That is what
 * makes a refresh land back in the ticket rather than the list, which matters
 * most when somebody is part-way through reading a reply.
 *
 *   member  their own tickets, with a form to open one
 *   staff   the queue, with the requester's address and the accept/resolve actions
 */
export default function TicketsPanel({
  mode = 'member',
  ticketId = null,
  onSelect,
  canManage = false,
}) {
  const isStaff = mode === 'staff';

  const [status, setStatus] = useState('open');
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ open: 0, closed: 0, total: 0 });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);

  // The URL is the source of truth for which ticket is open, so the initial read
  // comes from it rather than from state that a reload would empty.
  const select = useCallback(
    (id) => {
      setSelected(null);
      if (onSelect) onSelect(id);
    },
    [onSelect],
  );

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const d = await api.listTickets(status);
      setTickets(d.tickets);
      setCounts(d.counts);
      setError(null);
    } catch (e) {
      // A failed background refresh must not replace a working page with an
      // error, so it is only surfaced on the first, explicit load.
      if (!quiet) setError(e.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  // Load whatever the URL names. On a reload this is the only thing that puts the
  // reader back in their conversation.
  useEffect(() => {
    if (!ticketId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    api
      .getTicket(ticketId)
      .then((d) => {
        if (!cancelled) setSelected(d);
      })
      .catch(() => {
        // The id may be stale or belong to somebody else. Falling back to the
        // list is better than leaving an empty pane.
        if (!cancelled) setSelected(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  // The queue keeps itself current, but only while it is on screen: a hidden tab
  // polling every eight seconds is cost with no reader.
  useEffect(() => {
    if (typeof document === 'undefined' || document.hidden) return undefined;
    const id = setInterval(() => load({ quiet: true }), QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Re-read after anything that mutates the open ticket. Closing, replying or
  // accepting changes it, and leaving the copy already loaded on screen would show
  // a stale status until the member navigated away. Done explicitly rather than
  // in an effect on the id, so selecting a ticket fetches it exactly once.
  //
  // `quiet` is what the live poll uses: a message arriving does not want to
  // replace the whole thread, only to append.
  const refreshSelected = useCallback(async (id, { quiet = false } = {}) => {
    if (!id) return;
    try {
      const d = await api.getTicket(id);
      setSelected(d);
    } catch {
      if (!quiet) setSelected(null);
    }
  }, []);

  // The id of the conversation on screen, tracked separately so the live poll can
  // depend on it without depending on the whole fetched object -- otherwise a new
  // message would restart the interval on every tick and never fire.
  const openId = selected?.ticket?.id ?? null;

  useEffect(() => {
    if (!openId) return undefined;
    const id = setInterval(() => refreshSelected(openId, { quiet: true }), POLL_MS);
    return () => clearInterval(id);
  }, [openId, refreshSelected]);

  // Picking up a ticket changes it for everybody, so both sides re-read.
  const onAccepted = async (id) => {
    await load({ quiet: true });
    await refreshSelected(id);
  };

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
            // Opens the new ticket, and puts it in the URL so a refresh keeps it.
            select(id);
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

      {/* Mobile: the list and the conversation are separate screens, not one
          column. Stacked, opening a ticket left the thread below the whole
          queue on a phone, so answering somebody meant scrolling past every
          other ticket first. From lg up they sit side by side, which is where
          both fit at once. */}
      <div className={selected ? 'lg:grid lg:grid-cols-[20rem_1fr] lg:gap-5' : ''}>
        <div
          className={selected ? 'hidden lg:block lg:max-h-[36rem] lg:overflow-y-auto' : ''}
        >
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
                  onClick={() => select(t.id)}
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
                  {/* Who is on it, shown on the row so two staff scanning the
                      queue can see what is already being answered without
                      opening anything. */}
                  {isStaff && (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      {t.acceptedByEmail
                        ? `with ${t.acceptedByUsername || t.acceptedByEmail}`
                        : 'unclaimed'}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected && (
          <Thread
            data={selected}
            isStaff={isStaff}
            canManage={canManage}
            onReplied={() => afterMutation(selected.ticket.id)}
            onClosed={() => afterMutation(selected.ticket.id)}
            onAccepted={() => onAccepted(selected.ticket.id)}
            onReopened={() => afterMutation(selected.ticket.id)}
            onBack={() => select(null)}
          />
        )}
      </div>
    </div>
  );
}

/** The conversation, its actions, and the reply box for one ticket. */
function Thread({ data, isStaff, canManage, onReplied, onClosed, onAccepted, onReopened, onBack }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const ticket = data.ticket;
  const messages = data.messages || [];

  // Auto-scroll, but only when the reader is already at the bottom. Yanking the
  // view down while somebody is reading further up is worse than a new message
  // not being visible instantly.
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [messages.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.replyTicket(ticket.id, message);
      setMessage('');
      // Follow our own message down, so the reply is seen rather than left above
      // the fold.
      pinnedRef.current = true;
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

  async function accept() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const d = await api.acceptTicket(ticket.id);
      setNotice(
        d.reassigned
          ? `Reassigned to you. ${ticket.acceptedByEmail || 'Somebody else'} was on it.`
          : 'You are on this ticket now.',
      );
      await onAccepted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.reopenTicket(ticket.id);
      setNotice('Reopened. The member can reply again.');
      await onReopened();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function askToReopen() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.requestTicketReopen(ticket.id, message.trim());
      setMessage('');
      setNotice('Asked staff to reopen this. They will reply here when it is back.');
      await onReopened();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const closed = ticket.status === 'closed';
  const blocked = ticket.chatBlockedReason;
  const canReply = ticket.canReply && !closed;

  return (
    <div className="rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line-strong)]">
      {/* Only on a phone, where the list is off screen and this is the only way
          back to it. */}
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-1.5 border-b border-[var(--color-line-strong)] px-4 py-2.5 text-left text-xs font-semibold text-accent lg:hidden"
      >
        <span aria-hidden="true">←</span> All tickets
      </button>

      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-line-strong)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{ticket.subject}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {ticket.status === 'closed' ? 'Closed' : 'Open'} · {ticket.messageCount} message
            {ticket.messageCount === 1 ? '' : 's'}
            {isStaff && ticket.requesterEmail ? ` · ${ticket.requesterEmail}` : ''}
          </p>
          {isStaff && (
            <p className="mt-1 text-[11px]">
              {ticket.acceptedByEmail ? (
                <span className="text-accent">
                  On it: {ticket.acceptedByUsername || ticket.acceptedByEmail}
                </span>
              ) : (
                <span className="text-amber-300">Nobody has picked this up yet</span>
              )}
            </p>
          )}
          {/* A member waiting on staff to reopen is the most actionable thing on
              the screen, so it is stated at the top rather than in the queue. */}
          {isStaff && ticket.reopenRequestedAt && (
            <p className="mt-1 text-[11px] text-amber-300">
              {ticket.reopenRequestedByEmail
                ? `${ticket.reopenRequestedByEmail} asked to reopen this`
                : 'The member asked to reopen this'}
              {ticket.reopenNote ? ` — ${ticket.reopenNote}` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Accept. Offered while the ticket is unclaimed or held by somebody
              else, and replaced by a plain label once it is yours -- a button
              that does nothing is worse than no button. */}
          {isStaff && ticket.acceptedBy !== undefined && (
            ticket.canAccept ? (
              <button
                type="button"
                onClick={accept}
                disabled={busy}
                className="rounded-[var(--radius-control)] bg-accent px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
              >
                {ticket.acceptedByEmail ? 'Take over' : 'Accept'}
              </button>
            ) : (
              <span className="rounded-[var(--radius-control)] bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">
                Accepted
              </span>
            )
          )}
          {/* Resolving is any moderator holding the tickets grant, not admin
              only: whoever can answer somebody can close the case afterwards. */}
          {canManage && !closed && (
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text transition hover:bg-surface-3 disabled:opacity-50"
            >
              Mark resolved
            </button>
          )}
          {canManage && closed && (
            <button
              type="button"
              onClick={reopen}
              disabled={busy}
              className="rounded-[var(--radius-control)] bg-accent px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
            >
              Reopen
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="hidden rounded-[var(--radius-control)] px-2 py-1 text-xs text-muted transition hover:text-text lg:inline"
          >
            Close
          </button>
        </div>
      </div>

      {notice && (
        <p className="border-b border-[var(--color-line)] bg-accent/10 px-4 py-2 text-[11px] text-accent">
          {notice}
        </p>
      )}

      <ul ref={scrollRef} className="max-h-[22rem] divide-y divide-white/5 overflow-y-auto lg:max-h-80">
        {messages.map((m) => (
          <li
            key={m.id}
            className={`px-4 py-3 ${m.side === 'staff' ? 'bg-accent/5' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-xs font-semibold text-text">
                {m.side === 'staff'
                  ? isStaff && m.authorEmail
                    ? m.authorEmail
                    : 'Staff'
                  : isStaff && m.authorEmail
                    ? m.authorEmail
                    : 'You'}
              </p>
              <p className="shrink-0 text-[11px] text-faint">{timeAgo(m.createdAt)}</p>
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
        {messages.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-muted">No messages yet.</li>
        )}
      </ul>

      {/* Closed, or somebody else has it. The box is replaced rather than
          disabled: a greyed-out field with no explanation reads as a bug, and
          this is a rule the reader needs to know the reason for. The server
          enforces the same thing, so this is clarity, not the gate. */}
      {closed ? (
        <div className="border-t border-[var(--color-line-strong)] p-4">
          <p className="rounded-[var(--radius-control)] bg-bg px-3 py-2.5 text-xs leading-relaxed text-muted ring-1 ring-[var(--color-line-strong)]">
            This case is closed, so the conversation is paused. Nobody can post here until it is
            reopened.
          </p>

          {/* Reopening is the staff action here; the member's counterpart is the
              request form further down. The header already carries a Reopen
              control where Mark resolved sits, so this block explains the pause
              rather than offering the same button twice. */}
          {ticket.canReopen && (
            <p className="mt-2 text-[11px] text-muted">
              Reopen it above to bring this back and let the conversation continue.
            </p>
          )}

          {!isStaff && ticket.canRequestReopen && (
            <form onSubmit={askToReopen} className="mt-3">
              {ticket.reopenRequested ? (
                <p className="rounded-[var(--radius-control)] bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-300 ring-1 ring-amber-500/30">
                  You have asked staff to reopen this. They will bring it back and reply here.
                </p>
              ) : (
                <>
                  <label
                    htmlFor="reopen-note"
                    className="mb-1 block text-xs font-medium text-muted"
                  >
                    Why do you need it reopened? (optional)
                  </label>
                  <textarea
                    id="reopen-note"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={2}
                    maxLength={300}
                    className="w-full rounded-[var(--radius-control)] bg-bg px-3 py-2 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
                    placeholder="What is still wrong?"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="mt-2 w-full rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
                  >
                    {busy ? 'Sending…' : 'Ask staff to reopen'}
                  </button>
                </>
              )}
            </form>
          )}

          {error && (
            <p
              role="alert"
              className="mt-2 rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30"
            >
              {error}
            </p>
          )}
        </div>
      ) : blocked ? (
        <div className="border-t border-[var(--color-line-strong)] p-4">
          <p className="rounded-[var(--radius-control)] bg-bg px-3 py-2.5 text-xs leading-relaxed text-muted ring-1 ring-[var(--color-line-strong)]">
            {blocked}
          </p>
          {error && (
            <p
              role="alert"
              className="mt-2 rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30"
            >
              {error}
            </p>
          )}
        </div>
      ) : (
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
            disabled={busy || !canReply}
            className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Send reply'}
          </button>
        </form>
      )}
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