import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { timeAgo } from '../utils/timeAgo';

const PRESENCE_ORDER = ['online', 'active', 'idle', 'offline', 'never'];

const PRESENCE = {
  online: { label: 'Online now', dot: 'bg-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300' },
  active: { label: 'Active', dot: 'bg-accent', chip: 'bg-accent/15 text-accent' },
  idle: { label: 'Idle', dot: 'bg-amber-400', chip: 'bg-amber-500/15 text-amber-300' },
  offline: { label: 'Offline', dot: 'bg-[var(--color-accent)]', chip: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)]' },
  never: { label: 'Never signed in', dot: 'bg-white/30', chip: 'bg-white/10 text-muted' },
};

// daysOffline is accepted so callers can pass a row straight through; the
// label comes from PRESENCE alone.
export function PresenceChip({ presence }) {
  const cfg = PRESENCE[presence] ?? PRESENCE.never;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}

/** "today", "3d ago", "never" - compact form for the users table. */
export function DaysOffline({ days, presence }) {
  if (presence === 'never' || days === null || days === undefined) {
    return <span className="text-muted">never</span>;
  }
  if (days === 0) return <span className="text-emerald-300">today</span>;
  return <span className={days > 30 ? 'text-[var(--color-danger)]' : days > 7 ? 'text-amber-300' : ''}>{days}d</span>;
}

function StatCard({ label, value, tone = 'default', sub }) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'bad'
          ? 'text-[var(--color-danger)]'
          : 'text-text';
  return (
    <div className="rounded-[var(--radius-card)] bg-surface p-4 ring-1 ring-[var(--color-line-strong)]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <p className="flex items-center gap-3 py-8 text-sm text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        Loading activity…
      </p>
    );
  }

  if (error) {
    return (
      <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30">
        {error}
      </p>
    );
  }

  if (!data) return null;

  const { counts, totals, mostActive, needsAttention, recentSignups, thresholds, returning } = data;
  const engaged = counts.active + counts.online;
  const tickets = data.tickets || { open: 0, closed: 0 };

  return (
    <div className="space-y-6">
      {/* Support is a tab rather than another panel on the overview: the two are
          about different work, and the ticket numbers are what get looked at
          first thing in the morning. */}
      <div className="flex gap-1 border-b border-[var(--color-line-strong)]" role="tablist">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'tickets', label: 'Tickets', count: tickets.open },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-300">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'tickets' ? (
        <section>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* Pending first and in the warning tone: an unanswered ticket is the
                one number here that is somebody waiting on us. */}
            <StatCard
              label="Pending tickets"
              value={tickets.open}
              tone={tickets.open > 0 ? 'warn' : 'good'}
            />
            <StatCard label="Closed tickets" value={tickets.closed} tone="good" />
            <StatCard label="Total raised" value={tickets.open + tickets.closed} />
          </div>

          <p className="mt-4 text-sm text-muted">
            {tickets.open === 0
              ? 'Nothing is waiting on staff.'
              : `${tickets.open} ticket${tickets.open === 1 ? '' : 's'} waiting for a reply.`}
          </p>
        </section>
      ) : (
        <>
      {/* Presence split */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Presence</h2>
          <p className="text-[11px] text-muted">
            Active = seen within {thresholds.activeDays}d · Idle = {thresholds.activeDays}–
            {thresholds.idleDays}d · Offline = over {thresholds.idleDays}d
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total users" value={counts.total} />
          <StatCard label="Online now" value={counts.online} tone="good" />
          <StatCard label="Active" value={counts.active} tone="good" />
          <StatCard label="Idle" value={counts.idle} tone="warn" />
          <StatCard label="Offline" value={counts.offline} tone="bad" />
          <StatCard label="Never signed in" value={counts.never} />
        </div>

        {/* Share bar */}
        {counts.total > 0 && (
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface ring-1 ring-[var(--color-line-strong)]">
            {PRESENCE_ORDER.map((k) =>
              counts[k] > 0 ? (
                <div
                  key={k}
                  className={PRESENCE[k].dot}
                  style={{ width: `${(counts[k] / counts.total) * 100}%` }}
                  title={`${PRESENCE[k].label}: ${counts[k]}`}
                />
              ) : null,
            )}
          </div>
        )}

        <p className="mt-2 text-[11px] text-muted">
          {engaged} of {counts.total} account(s) active in the last {thresholds.activeDays} days (
          {counts.total ? Math.round((engaged / counts.total) * 100) : 0}% engagement).
        </p>
      </section>

      {/* Library totals */}
      <section>
        <h2 className="text-sm font-semibold">Platform</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="New this week" value={totals.newThisWeek} tone="good" />
          <StatCard label="New this month" value={totals.newThisMonth} />
          <StatCard label="Titles" value={totals.titles} />
          <StatCard label="Watchlist adds" value={totals.watchlist} />
          <StatCard label="Playback records" value={totals.playback} />
          <StatCard
            label="Unread notifs"
            value={totals.unreadNotifications}
            tone={totals.unreadNotifications > 0 ? 'warn' : 'default'}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coming back after a long absence */}
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Back after a month</h2>
            <p className="text-[11px] text-muted">
              Returned after {thresholds.returnAfterDays}+ days away
              {data.autoReturnNotifications ? ' · auto-welcome on' : ' · auto-welcome off'}
            </p>
          </div>
          <ul className="mt-3 overflow-hidden rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line-strong)]">
            {returning.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-muted">
                Nobody has come back from a long absence yet.
              </li>
            )}
            {returning.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{u.email}</span>
                <span className="rounded bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                  away {u.gapDays}d
                </span>
                <span className="w-24 shrink-0 text-right text-[11px] text-muted">
                  back {timeAgo(`${u.returnedOn}T00:00:00Z`)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Most active */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Most recently active</h2>
          <ul className="overflow-hidden rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line-strong)]">
            {mostActive.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-muted">No activity recorded yet.</li>
            )}
            {mostActive.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{u.email}</span>
                {u.isOwner && (
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                    owner
                  </span>
                )}
                <span className="text-[11px] text-muted">{timeAgo(u.lastSeenAt)}</span>
                <DaysOffline days={u.daysOffline} presence={u.presence} />
              </li>
            ))}
          </ul>
        </section>

        {/* Needs attention */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Gone quiet</h2>
          <ul className="overflow-hidden rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line-strong)]">
            {needsAttention.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-muted">
                Everyone is active. Nothing to chase.
              </li>
            )}
            {needsAttention.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{u.email}</span>
                <PresenceChip presence={u.presence} />
                <span className="w-16 shrink-0 text-right text-[11px] text-muted">
                  {timeAgo(u.lastSeenAt)}
                </span>
                <DaysOffline days={u.daysOffline} presence={u.presence} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Recent signups */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Newest accounts</h2>
        <ul className="overflow-hidden rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line-strong)]">
          {recentSignups.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{u.email}</span>
              <span
                className={`text-[11px] ${
                  u.role === 'admin'
                    ? 'text-accent'
                    : u.role === 'moderator'
                      ? 'text-amber-300'
                      : 'text-muted'
                }`}
              >
                {u.role}
              </span>
              <span className="text-[11px] text-muted">joined {timeAgo(u.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] text-muted">
        Presence is recorded on authenticated requests, throttled to one update every 5 minutes.
        Refreshes every 60 seconds.
      </p>
        </>
      )}
    </div>
  );
}
