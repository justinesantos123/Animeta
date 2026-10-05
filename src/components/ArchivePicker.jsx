import { useState } from 'react';
import { api } from '../api';

/**
 * Demo catalog: playable public-domain films from the Internet Archive.
 *
 * These resolve to real, playable MP4s, so the gate, the player and
 * continue-watching all exercise end to end. Every result shows the licence the
 * item itself declares, and anything not explicitly marked public domain or
 * Creative Commons is labelled as unstated rather than presented as free.
 */
export default function ArchivePicker({ onAdded, onError }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState(null);

  async function search(e) {
    e?.preventDefault();
    setBusy(true);
    onError?.(null);
    try {
      const d = await api.archiveLookup({ q: query.trim() });
      setResults(d.results || []);
      setSearched(true);
    } catch (err) {
      onError?.(err.message);
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  async function add(item) {
    setAdding(item.identifier);
    onError?.(null);
    try {
      const d = await api.createTitle({
        title: item.title,
        type: 'movie',
        synopsis: item.synopsis || '',
        genres: 'Public Domain',
        rating: null,
        runtime: formatRuntime(item.durationSeconds),
        releaseDate: item.year ? `${item.year}-01-01` : null,
        posterUrl: item.posterUrl,
        backdropUrl: item.posterUrl,
        videoUrl: item.videoUrl,
        videoSource: 'archive',
      });
      onAdded?.(d.title);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 ring-1 ring-[var(--color-line)]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">Demo catalog</h3>
        <span className="text-[11px] text-[var(--color-faint)]">playable now</span>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-faint)]">
        Searches the Internet Archive for public-domain films and resolves a direct, playable file.
        Free to serve, no API key, and the gate and player work on these exactly as they would on
        any other title.
      </p>

      <form onSubmit={search} className="mt-3 flex flex-wrap items-start gap-2">
        <input
          id="archive-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-[var(--radius-control)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-[var(--color-faint)] focus:ring-2 focus:ring-[var(--color-accent)] sm:max-w-56"
          placeholder="night of the living dead"
          aria-label="Search public-domain films"
        />
        <button type="submit" disabled={busy} className="btn-secondary px-3.5 py-2 disabled:opacity-60">
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {searched && !busy && results.length === 0 && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Nothing playable came back. Try a shorter title.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {results.map((item) => (
            <li
              key={item.identifier}
              className="flex items-center gap-3 rounded-[var(--radius-control)] bg-[var(--color-bg)] px-2.5 py-2 ring-1 ring-[var(--color-line)]"
            >
              <img
                src={item.posterUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="h-14 w-10 shrink-0 rounded-[3px] object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {item.title}
                  {item.year ? <span className="ml-1.5 text-[var(--color-faint)]">{item.year}</span> : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-faint)]">
                  <LicenceBadge licence={item.licence} />
                  {item.durationSeconds ? <span>{formatRuntime(item.durationSeconds)}</span> : null}
                  {item.sizeBytes ? <span>{Math.round(item.sizeBytes / 1048576)} MB</span> : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => add(item)}
                disabled={adding === item.identifier}
                className="btn-primary shrink-0 px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {adding === item.identifier ? 'Adding…' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LicenceBadge({ licence }) {
  const key = licence?.key ?? 'unstated';
  const tone =
    key === 'unstated' || key === 'other'
      ? 'text-[var(--color-faint)]'
      : 'text-[var(--color-accent-strong)]';

  const label =
    key === 'public-domain'
      ? 'Public domain'
      : key === 'unstated'
        ? 'Licence not stated'
        : (licence?.label ?? 'Licence not stated');

  return (
    <span className={`rounded-[3px] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-medium ${tone}`}>
      {label}
    </span>
  );
}

/** 4419 -> "1h 13m" */
function formatRuntime(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}