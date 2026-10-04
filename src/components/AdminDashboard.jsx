import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

const PRESENCE_ORDER = ['online', 'active', 'idle', 'offline', 'never'];

const PRESENCE = {
  online: { label: 'Online now', dot: 'bg-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300' },
  active: { label: 'Active', dot: 'bg-accent', chip: 'bg-accent/15 text-accent' },
  idle: { label: 'Idle', dot: 'bg-amber-400', chip: 'bg-amber-500/15 text-amber-300' },
  offline: { label: 'Offline', dot: 'bg-cta', chip: 'bg-cta/15 text-cta' },
  never: { label: 'Never signed in', dot: 'bg-white/30', chip: 'bg-white/10 text-muted' },
};

export function PresenceChip({ presence, daysOffline }) {
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
  return <span className={days > 30 ? 'text-cta' : days > 7 ? 'text-amber-300' : ''}>{days}d</span>;
}

function StatCard({ label, value, tone = 'default', sub }) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'bad'
          ? 'text-cta'
          : 'text-text';
  return (
    <div className="rounded-xl bg-surface p-4 ring-1 ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      <p role="alert" className="rounded-lg bg-cta/15 px-3 py-2 text-xs text-cta ring-1 ring-cta/30">
        {error}
      </p>
    );
  }

  if (!data) return null;

  const { counts, totals, mostActive, needsAttention, recentSignups, thresholds } = data;
  const engaged = counts.active + counts.online;

  return (
    <div className="space-y-6">
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
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface ring-1 ring-white/10">
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
        {/* Most active */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Most recently active</h2>
          <ul className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/10">
            {mostActive.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-muted">No activity recorded yet.</li>
            )}
            {mostActive.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{u.email}</span>
                {u.isOwner && (
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                    owner
                  </span>
                )}
                <DaysOffline days={u.daysOffline} presence={u.presence} />
              </li>
            ))}
          </ul>
        </section>

        {/* Needs attention */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Gone quiet</h2>
          <ul className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/10">
            {needsAttention.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-muted">
                Everyone is active. Nothing to chase.
              </li>
            )}
            {needsAttention.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{u.email}</span>
                <PresenceChip presence={u.presence} daysOffline={u.daysOffline} />
                <DaysOffline days={u.daysOffline} presence={u.presence} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Recent signups */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Newest accounts</h2>
        <ul className="overflow-hidden rounded-xl bg-surface ring-1 ring-white/10">
          {recentSignups.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-0"
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
              <span className="text-[11px] text-muted">
                {u.createdAt ? u.createdAt.slice(0, 10) : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] text-muted">
        Presence is recorded on authenticated requests, throttled to one update every 5 minutes.
        Refreshes every 60 seconds.
      </p>
    </div>
  );
}
