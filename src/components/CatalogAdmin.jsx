import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { TITLE_TYPES, titleTypeLabel } from '../lib/titleTypes';
import EmbedPicker from './EmbedPicker';
import VideoUploader, { probeVideo } from './VideoUploader';
import { useAuth } from '../context/AuthContext';

/**
 * Catalog management: post a title, and see what is already posted.
 *
 * Three ways to supply the video, in order of preference:
 *   - Upload the file. This is the main path: the site is for AI anime and drama
 *     that people make themselves.
 *   - Paste a YouTube or Vimeo embed, for work that already lives elsewhere.
 *   - Type any stream URL, for a file hosted somewhere else.
 *
 * The `type` decides which category the title lands in, so the listing below
 * groups exactly the way the public catalog does.
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
  const { user } = useAuth();

  // Uploading is a separate permission from editing the catalog, so the uploader
  // is shown only to somebody who can actually use it. Hiding it is convenience:
  // the endpoint re-checks, and a moderator without this grant would get a 403.
  const canUpload =
    user?.role === 'admin' || (user?.permissions || []).includes('upload');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);

  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // The pasted embed, held as a provider plus an id. This is what gets saved:
  // never the pasted snippet.
const [embed, setEmbed] = useState(null);
  // An upload the uploader has finished sending, ready to attach to the title.
const [upload, setUpload] = useState(null);

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
    setEmbed(null);
    setUpload(null);
  };

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
        // Exactly one video source, chosen explicitly rather than inferred by
        // the worker: an upload wins over an embed, which wins over a URL.
        // Sending two and letting the server guess is how a title ends up
        // playing something other than what the poster chose.
        videoKind: upload ? 'upload' : embed ? 'embed' : 'file',
        uploadId: upload?.id ?? null,
        embedProvider: embed?.provider ?? null,
        embedId: embed?.videoId ?? null,
        videoUrl: upload || embed ? '' : form.videoUrl,
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
    // An edited embed is reloaded into the same state the picker fills, so saving
    // without touching the video does not silently drop it back to a stream URL.
    setEmbed(
      t.videoKind === 'embed' && t.embedProvider && t.embedId
        ? {
            provider: t.embedProvider,
            videoId: t.embedId,
            embedUrl: null,
            watchUrl: null,
          }
        : null,
    );
    // An edited upload is already attached, so re-saving without touching the
    // video must not detach it. The row is kept by id, not by re-uploading.
    setUpload(t.videoKind === 'upload' && t.uploadId ? { id: t.uploadId } : null);
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

        {/* Where the video comes from. Upload is first because this is a site for
            AI anime and drama people make themselves; the other two are for work
            that already lives somewhere else. Exactly one of the three is used. */}
        <div className="mb-4 space-y-4">
          {canUpload ? (
            <VideoUploader
              onUploaded={async (up, file) => {
                setUpload(up);
                setEmbed(null);
                // The poster captured while the file was local is uploaded
                // straight after the video, and used as the title's artwork. An
                // upload with no thumbnail is the single most obvious sign of a
                // half-finished catalog entry.
                const meta = await probeVideo(file);
                let posterUrl = null;

                if (meta.durationSecs != null) {
                  api.finaliseUpload(up.id, meta).catch(() => {});
                }
                if (meta.poster) {
                  // The endpoint returns { ok, posterUrl }; the form wants the
                  // path. Assigning the whole response is what put
                  // "[object Object]" in the poster field.
                  const res = await api.uploadPoster(up.id, meta.poster).catch(() => null);
                  posterUrl = res?.posterUrl ?? null;
                }

                setForm((f) => ({
                  ...f,
                  posterUrl: posterUrl ?? f.posterUrl,
                  // A poster frame is portrait-cropped from a landscape video,
                  // so it is only ever a thumbnail, never the hero backdrop.
                  backdropUrl: f.backdropUrl,
                }));

                setMessage({
                  ok: true,
                  text: posterUrl
                    ? `Uploaded ${up.filename} and captured a thumbnail. Fill in the details, then save.`
                    : `Uploaded ${up.filename}. No thumbnail could be read from this file, so add a poster URL.`,
                  warn: !posterUrl,
                });
              }}
              disabled={Boolean(embed)}
            />
          ) : (
            // Said rather than omitted: an empty space where the uploader was
            // looks like a bug, and the admin console should explain who can use
            // it and who decides.
            <div className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 ring-1 ring-[var(--color-line)]">
              <p className="text-xs font-medium text-[var(--color-muted)]">Your own video</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                Uploading is limited to admins and moderators. Ask an admin for the
                &ldquo;Upload video&rdquo; permission.
              </p>
            </div>
          )}

          {upload && (
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-[var(--color-accent)]/10 px-4 py-3 ring-1 ring-[var(--color-accent)]/30">
              <p className="min-w-0 truncate text-xs text-[var(--color-text)]">
                <span className="font-semibold">Ready to publish:</span> {upload.filename}
                {upload.bytes ? ` · ${(upload.bytes / 1024 / 1024).toFixed(1)}MB` : ''}
              </p>
              <button
                type="button"
                onClick={() => setUpload(null)}
                className="shrink-0 text-xs font-medium text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
              >
                Remove
              </button>
            </div>
          )}

          <EmbedPicker
            disabled={Boolean(upload)}
            onMessage={(msg) => {
              if (!msg) return;
              setMessage({ ok: msg.ok, text: msg.text, warn: msg.warn });
            }}
            onResolve={(d) => {
              // No message here: the picker reports the outcome itself, and two
              // components setting the same banner means the last write wins and
              // the wording flickers between them.
              setUpload(null);
              setForm((f) => ({
                ...f,
                // oEmbed gives a real title and thumbnail for a public video, so
                // the form is usually already complete.
                title: d.title || f.title,
                posterUrl: d.posterUrl || d.thumbnailUrl || f.posterUrl,
                videoUrl: '',
              }));
              setEmbed({
                provider: d.provider,
                videoId: d.videoId,
                embedUrl: d.embedUrl,
                watchUrl: d.watchUrl,
                title: d.title,
              });
            }}
          />
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
                disabled={Boolean(embed)}
                className={`${INPUT} disabled:opacity-50`}
                placeholder="https://…/master.m3u8"
              />
              {embed ? (
                // Makes the precedence visible rather than leaving staff to
                // wonder why their pasted URL is not what plays.
                <p className="mt-1 text-[11px] text-[var(--color-accent-strong)]">
                  Playing the {embed.provider} embed instead. Clear it below to use a stream URL.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-[var(--color-faint)]">
                  The playable file for the whole title. For an episodic type, add per-episode URLs
                  below instead.
                </p>
              )}
              {embed && (
                <button
                  type="button"
                  onClick={() => setEmbed(null)}
                  className="mt-1.5 text-[11px] font-medium text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
                >
                  Clear the embed
                </button>
              )}
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
// A warning is styled apart from a plain success: the operation worked, but
                  // something in the result needs a human's attention.
                  message.warn
                    ? 'bg-[var(--color-danger)]/12 text-[var(--color-muted)] ring-[var(--color-danger)]/30'
                    : message.ok
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
                      className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 last:border-b-0"
                    >
                      {/* Thumbnail, so a half-finished entry is obvious at a
                          glance rather than only in the detail page. */}
                      {t.posterUrl ? (
                        <img
                          src={t.posterUrl}
                          alt=""
                          aria-hidden="true"
                          className="h-14 w-10 shrink-0 rounded-[3px] object-cover ring-1 ring-[var(--color-line)]"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-14 w-10 shrink-0 items-center justify-center rounded-[3px] bg-[var(--color-surface-2)] text-[9px] text-[var(--color-faint)] ring-1 ring-[var(--color-line)]"
                        >
                          no art
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link
                            to={`/title/${t.slug}`}
                            className="truncate text-[13px] font-medium hover:underline"
                          >
                            {t.title}
                          </Link>
                          <span className="rounded-[3px] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                            {titleTypeLabel(t.type)}
                          </span>
                          {t.episodeCount > 0 && (
                            <span className="tabular-nums text-[11px] text-[var(--color-faint)]">
                              {t.episodeCount} eps
                            </span>
                          )}
                        </div>

                        {/* Description, clamped to two lines: enough to tell
                            what an entry is, not enough to turn the staff list
                            into a wall of text. */}
                        {t.synopsis ? (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
                            {t.synopsis}
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-[var(--color-faint)]">
                            No description
                          </p>
                        )}

                        {/* Where the video actually comes from. For an embed or
                            a URL the address is shown, because "which of my nine
                            pasted links is this" is the question this list
                            exists to answer. */}
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--color-faint)]">
                          {t.videoKind === 'upload' && t.uploadId ? (
                            <span className="text-[var(--color-accent-strong)]">
                              uploaded file
                            </span>
                          ) : t.videoKind === 'embed' && t.embedProvider ? (
                            <>
                              <span className="text-[var(--color-accent-strong)]">
                                {t.embedProvider} embed
                              </span>
                              <code className="max-w-[22rem] truncate">
                                https://{t.embedProvider}.com/watch?v={t.embedId}
                              </code>
                            </>
                          ) : t.videoUrl ? (
                            <>
                              <span>stream URL</span>
                              <code className="max-w-[22rem] truncate">{t.videoUrl}</code>
                            </>
                          ) : (
                            <span className="text-[var(--color-danger)]">
                              no video source
                            </span>
                          )}
                        </p>

                        {/* Release date and when it was posted. A title with no
                            release date is common and worth seeing. */}
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] tabular-nums text-[var(--color-faint)]">
                          <span>{t.releaseDate || 'no release date'}</span>
                          <span aria-hidden="true">·</span>
                          <span>posted {String(t.createdAt || '').slice(0, 10) || '—'}</span>
                        </p>
                      </div>

                      <span className="flex shrink-0 gap-1.5">
                        {/* An advert has no public page any more, so this is the only
                            way to watch one and confirm it plays. */}
                        {t.type === 'ads' && (
                          <Link
                            to={`/title/${t.slug}`}
                            className="rounded-[var(--radius-control)] bg-surface-2 px-2 py-1 text-xs text-[var(--color-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
                          >
                            Preview
                          </Link>
                        )}
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
  );}