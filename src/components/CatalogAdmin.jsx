import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { TITLE_TYPES, titleTypeLabel } from '../lib/titleTypes';

/**
 * Catalog management: post a title, and see what is already posted.
 *
 * Two ways in:
 *   - Paste a TMDB or IMDb id and let the server fill in title, description,
 *     artwork, genres, rating and runtime.
 *   - Type everything by hand.
 *
 * Either way the `type` decides which category the title lands in, so the
 * listing below shows the same grouping the public catalog uses.
 */

const EMPTY = {
  title: '',
  type: 'movie',
  synopsis: '',
  genres: '',
  rating: '',
  runtime: '',
  releaseDate: '',
  posterUrl: '',
  backdropUrl: '',
  videoUrl: '',
  subtitlesUrl: '',
};

const INPUT =
  'w-full rounded-[var(--radius-control)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-[var(--color-faint)] focus:ring-2 focus:ring-[var(--color-accent)]';

const LABEL = 'mb-1 block text-xs font-medium text-[var(--color-muted)]';

export default function CatalogAdmin() {
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);

  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const [externalId, setExternalId] = useState('');
  const [looking, setLooking] = useState(false);
  // Populated by the last lookup so the form can show what it resolved to.
  const [resolved, setResolved] = useState(null);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const load = useCallback(async () => {
    try {
      const d = await api.listTitlesAdmin();
      setTitles(d.titles || []);
    } catch (e) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setForm(EMPTY);
    setEditing(null);
    setExternalId('');
    setResolved(null);
  };

  /**
   * Resolve the pasted id, then fill the form. Only the fields TMDB actually
   * returns are overwritten, so a stream URL already pasted is never lost.
   */
  async function onLookup() {
    const id = externalId.trim();
    if (!id) {
      setMessage({ ok: false, text: 'Enter a TMDB or IMDb id first' });
      return;
    }
    setLooking(true);
    setMessage(null);
    try {
      const d = await api.tmdbLookup(id);
      const t = d.title;
      setForm((f) => ({
        ...f,
        title: t.title || f.title,
        // Only nudge the type when it is still the untouched default.
        type: f.type === EMPTY.type && t.type ? t.type : f.type,
        synopsis: t.synopsis || f.synopsis,
        genres: Array.isArray(t.genres) && t.genres.length ? t.genres.join(', ') : f.genres,
        rating: t.rating ?? f.rating,
        runtime: t.runtime || f.runtime,
        releaseDate: t.releaseDate || f.releaseDate,
        posterUrl: t.posterUrl || f.posterUrl,
        backdropUrl: t.backdropUrl || f.backdropUrl,
      }));
      setResolved(t);
      setMessage({
        ok: true,
        text: `Filled in "${t.title}". Add the stream URL below, then save.`,
      });
    } catch (e) {
      setResolved(null);
      setMessage({ ok: false, text: e.message });
    } finally {
      setLooking(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        ...form,
        rating: form.rating === '' ? null : Number(form.rating),
        genres: form.genres,
        releaseDate: form.releaseDate || null,
      };
      if (editing) {
        await api.updateTitle(editing, payload);
        setMessage({ ok: true, text: `Updated "${payload.title}"` });
      } else {
        await api.createTitle(payload);
        setMessage({
          ok: true,
          text: `"${payload.title}" is live in ${titleTypeLabel(form.type)}.`,
        });
      }
      reset();
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(t) {
    setEditing(t.slug);
    setForm({
      title: t.title || '',
      type: t.type,
      synopsis: t.synopsis || '',
      genres: (t.genres || []).join(', '),
      rating: t.rating ?? '',
      runtime: t.runtime || '',
      releaseDate: t.releaseDate || '',
      posterUrl: t.posterUrl || '',
      backdropUrl: t.backdropUrl || '',
      videoUrl: t.videoUrl || '',
      subtitlesUrl: t.subtitlesUrl || '',
    });
    setResolved(null);
    setExternalId('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onDelete(t) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${t.title}"? Its seasons and episodes go too.`)) return;
    setBusy(true);
    try {
      await api.deleteTitle(t.slug);
      if (editing === t.slug) reset();
      setMessage({ ok: true, text: `Deleted "${t.title}"` });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(
    () =>
      TITLE_TYPES.map((meta) => ({
        ...meta,
        items: titles.filter((t) => t.type === meta.value),
      })).filter((s) => s.items.length > 0),
    [titles],
  );

  return (
    <div className="space-y-8">
      {/* --- Post a title --- */}
      <section aria-labelledby="post-heading">
        <div className="section-head">
          <h2 id="post-heading" className="section-head__title">
            {editing ? `Editing "${editing}"` : 'Post a title'}
          </h2>
          <span className="section-head__meta">
            the type decides the category it appears in
          </span>
          {editing && (
            <button
              type="button"
              onClick={reset}
              className="ml-auto text-xs text-[var(--color-accent)] hover:underline"
            >
              Cancel
            </button>
          )}
        </div>

        {/* id lookup */}
        <div className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 ring-1 ring-[var(--color-line)]">
          <label htmlFor="ext-id" className={LABEL}>
            TMDB or IMDb id
          </label>
          <div className="flex flex-wrap items-start gap-2">
            <input
              id="ext-id"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onLookup();
                }
              }}
              className={`${INPUT} sm:max-w-xs`}
              placeholder="969681 or tt0133093"
              aria-describedby="ext-id-help"
            />
            <button
              type="button"
              onClick={onLookup}
              disabled={looking || busy}
              className="btn-secondary px-3.5 py-2 disabled:opacity-60"
            >
              {looking ? 'Looking up…' : 'Fill from TMDB'}
            </button>
          </div>
          <p id="ext-id-help" className="mt-1.5 text-[11px] text-[var(--color-faint)]">
            A TMDB id (969681), an IMDb id (tt0133093), or the page URL for either. Fills in the
            title, description, artwork, genres, rating and runtime. Nothing is saved until you
            press Save.
          </p>

          {resolved && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-[var(--color-line)] pt-3 text-xs sm:grid-cols-4">
              <Meta label="Resolved as" value={resolved.source} />
              <Meta
                label="Type"
                value={titleTypeLabel(resolved.type)}
                note={
                  resolved.episodes
                    ? `${resolved.seasons ?? '?'} seasons / ${resolved.episodes} eps`
                    : null
                }
              />
              <Meta label="Year" value={resolved.year || '—'} />
              <Meta label="Rating" value={resolved.rating ?? '—'} />
            </dl>
          )}
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="t" className={LABEL}>
                Title
              </label>
              <input id="t" required value={form.title} onChange={set('title')} className={INPUT} />
            </div>

            <div>
              <label htmlFor="type" className={LABEL}>
                Type / category
              </label>
              <select id="type" value={form.type} onChange={set('type')} className={INPUT}>
                {TITLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[var(--color-faint)]">
                {form.type === 'movie'
                  ? 'Plays without an account.'
                  : 'Episode 1 plays free; the rest needs an account.'}
              </p>
            </div>

            <div>
              <label htmlFor="rating" className={LABEL}>
                Rating (0-10)
              </label>
              <input
                id="rating"
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={form.rating}
                onChange={set('rating')}
                className={INPUT}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="syn" className={LABEL}>
                Description
              </label>
              <textarea
                id="syn"
                rows={3}
                value={form.synopsis}
                onChange={set('synopsis')}
                className={INPUT}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="genres" className={LABEL}>
                Genres (comma separated)
              </label>
              <input
                id="genres"
                value={form.genres}
                onChange={set('genres')}
                className={INPUT}
                placeholder="Sci-Fi, Mystery"
              />
            </div>

            <div>
              <label htmlFor="runtime" className={LABEL}>
                Runtime
              </label>
              <input
                id="runtime"
                value={form.runtime}
                onChange={set('runtime')}
                className={INPUT}
                placeholder="2h 04m"
              />
            </div>

            <div>
              <label htmlFor="rel" className={LABEL}>
                Release date
              </label>
              <input
                id="rel"
                type="date"
                value={form.releaseDate}
                onChange={set('releaseDate')}
                className={INPUT}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="video" className={LABEL}>
                Stream URL (.m3u8 or .mp4)
              </label>
              <input
                id="video"
                value={form.videoUrl}
                onChange={set('videoUrl')}
                className={INPUT}
                placeholder="https://…/master.m3u8"
              />
              <p className="mt-1 text-[11px] text-[var(--color-faint)]">
                The playable file for the whole title. For an episodic type, add per-episode URLs
                below instead.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="poster" className={LABEL}>
                Poster URL
              </label>
              <input
                id="poster"
                value={form.posterUrl}
                onChange={set('posterUrl')}
                className={INPUT}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="backdrop" className={LABEL}>
                Backdrop URL
              </label>
              <input
                id="backdrop"
                value={form.backdropUrl}
                onChange={set('backdropUrl')}
                className={INPUT}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="subs" className={LABEL}>
                Subtitles URL (.vtt)
              </label>
              <input
                id="subs"
                value={form.subtitlesUrl}
                onChange={set('subtitlesUrl')}
                className={INPUT}
              />
            </div>
          </div>

          {message && (
            <p
              role="status"
              className={`rounded-[var(--radius-control)] px-3 py-2 text-xs ring-1 ${
                message.ok
                  ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent-strong)] ring-[var(--color-accent)]/30'
                  : 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] ring-[var(--color-danger)]/30'
              }`}
            >
              {message.text}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="btn-primary disabled:opacity-60">
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Save to catalog'}
            </button>
            {editing && (
              <button type="button" onClick={reset} className="btn-secondary">
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      {/* --- What is already posted --- */}
      <section aria-labelledby="listing-heading">
        <div className="section-head">
          <h2 id="listing-heading" className="section-head__title">
            Posted titles
          </h2>
          <span className="section-head__meta">{titles.length} total</span>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">Loading…</p>
        ) : titles.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Nothing posted yet.</p>
        ) : (
          <div className="space-y-6">
            {grouped.map((section) => (
              <div key={section.value}>
                <h3 className="mb-2 flex items-baseline gap-2 text-xs font-medium text-[var(--color-faint)]">
                  <span>{titleTypeLabel(section.value)}</span>
                  <span className="tabular-nums">{section.items.length}</span>
                </h3>
                <ul className="overflow-hidden rounded-[var(--radius-card)] ring-1 ring-[var(--color-line)]">
                  {section.items.map((t) => (
                    <li
                      key={t.slug}
                      className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                      <span className="tabular-nums text-xs text-[var(--color-faint)]">
                        {t.type}
                      </span>
                      {t.episodeCount > 0 && (
                        <span className="tabular-nums text-xs text-[var(--color-faint)]">
                          {t.episodeCount} eps
                        </span>
                      )}
                      {!t.videoUrl && (
                        <span className="text-xs text-[var(--color-danger)]">no stream</span>
                      )}
                      <span className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(t)}
                          className="rounded-[var(--radius-control)] px-2 py-1 text-xs text-[var(--color-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(t)}
                          disabled={busy}
                          className="rounded-[var(--radius-control)] px-2 py-1 text-xs text-[var(--color-danger)] transition hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Meta({ label, value, note }) {
  return (
    <div>
      <dt className="text-[var(--color-faint)]">{label}</dt>
      <dd className="font-medium text-[var(--color-text)]">
        {value}
        {note && <span className="ml-1 font-normal text-[var(--color-faint)]">{note}</span>}
      </dd>
    </div>
  );
}