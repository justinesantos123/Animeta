import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const EMPTY = {
  title: '',
  type: 'series',
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

/**
 * Minimal admin console for catalog CRUD (Phase 1 scope: titles only).
 * Auth is enforced server-side; this just hides the UI from non-admins.
 */
export default function Admin() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (ready && !user) navigate('/auth', { replace: true });
  }, [ready, user, navigate]);

  if (!ready || !user || user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <p className="text-sm text-muted">Checking access…</p>
      </div>
    );
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function startEdit(t) {
    setEditing(t.slug);
    setForm({
      title: t.title ?? '',
      type: t.type ?? 'series',
      synopsis: t.synopsis ?? '',
      genres: (t.genres || []).join(', '),
      rating: String(t.rating ?? ''),
      runtime: t.runtime ?? '',
      releaseDate: t.releaseDate ?? '',
      posterUrl: t.posterUrl ?? '',
      backdropUrl: t.backdropUrl ?? '',
      videoUrl: t.videoUrl ?? '',
      subtitlesUrl: t.subtitlesUrl ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY);
    setMessage(null);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);

    const payload = {
      title: form.title,
      type: form.type,
      synopsis: form.synopsis,
      genres: form.genres
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      rating: Number(form.rating) || 0,
      runtime: form.runtime || null,
      releaseDate: form.releaseDate || null,
      posterUrl: form.posterUrl || null,
      backdropUrl: form.backdropUrl || null,
      videoUrl: form.videoUrl || null,
      subtitlesUrl: form.subtitlesUrl || null,
    };

    try {
      if (editing) {
        await api.updateTitle?.(editing, payload);
      } else {
        await api.createTitle(payload);
      }
      setMessage({ ok: true, text: editing ? 'Title updated.' : 'Title created.' });
      reset();
      // Reload so the catalog reflects the change.
      window.location.reload();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-lg bg-surface px-3 py-2 text-sm text-text ring-1 ring-white/10 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 pb-24">
      <h1 className="text-2xl font-extrabold">Catalog admin</h1>
      <p className="mt-1 text-sm text-muted">
        {editing ? `Editing “${editing}”` : 'Add a title to the catalog'}
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl bg-surface p-6 ring-1 ring-white/10">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Title</label>
            <input required value={form.title} onChange={set('title')} className={input} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Type</label>
            <select value={form.type} onChange={set('type')} className={input}>
              <option value="series">Series</option>
              <option value="movie">Movie</option>
              <option value="anime">Anime</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Rating (0-10)</label>
            <input
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={form.rating}
              onChange={set('rating')}
              className={input}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Synopsis</label>
            <textarea rows={3} value={form.synopsis} onChange={set('synopsis')} className={input} />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Genres (comma separated)</label>
            <input value={form.genres} onChange={set('genres')} className={input} placeholder="Sci-Fi, Mystery" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Runtime</label>
            <input value={form.runtime} onChange={set('runtime')} className={input} placeholder="2h 04m" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Release date</label>
            <input type="date" value={form.releaseDate} onChange={set('releaseDate')} className={input} />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Poster URL</label>
            <input value={form.posterUrl} onChange={set('posterUrl')} className={input} />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Backdrop URL</label>
            <input value={form.backdropUrl} onChange={set('backdropUrl')} className={input} />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Video URL (HLS .m3u8)</label>
            <input value={form.videoUrl} onChange={set('videoUrl')} className={input} />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Subtitles URL (.vtt)</label>
            <input value={form.subtitlesUrl} onChange={set('subtitlesUrl')} className={input} />
          </div>
        </div>

        {message && (
          <p
            role="status"
            className={`rounded-lg px-3 py-2 text-xs ring-1 ${
              message.ok ? 'bg-accent/15 text-accent ring-accent/30' : 'bg-cta/15 text-cta ring-cta/30'
            }`}
          >
            {message.text}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create title'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold ring-1 ring-white/10"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}