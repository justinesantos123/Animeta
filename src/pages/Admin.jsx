import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import UserAdmin from './UserAdmin';

const TABS = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'users', label: 'Users' },
];

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

const INPUT =
  'w-full rounded-lg bg-surface px-3 py-2 text-sm text-text ring-1 ring-white/10 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

/**
 * Admin console. Server-side authorization is the real gate (see worker/api.js);
 * this only hides the UI from non-admins.
 */
export default function Admin() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('catalog');
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(null);

  // Keep this page out of search indexes.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

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
      if (editing) await api.updateTitle(editing, payload);
      else await api.createTitle(payload);
      setMessage({ ok: true, text: editing ? 'Title updated.' : 'Title created.' });
      reset();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 pb-24">
      <h1 className="text-2xl font-extrabold">Admin console</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {user.email}</p>

      <div className="mt-6 flex gap-1 border-b border-white/10" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' ? (
        <div className="mt-6">
          <UserAdmin />
        </div>
      ) : (
        <div className="mt-6">
          <p className="mb-4 text-sm text-muted">
            {editing ? `Editing "${editing}"` : 'Add a title to the catalog'}
          </p>

          <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-surface p-6 ring-1 ring-white/10">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="t" className="mb-1 block text-xs font-medium text-muted">
                  Title
                </label>
                <input id="t" required value={form.title} onChange={set('title')} className={INPUT} />
              </div>

              <div>
                <label htmlFor="type" className="mb-1 block text-xs font-medium text-muted">
                  Type
                </label>
                <select id="type" value={form.type} onChange={set('type')} className={INPUT}>
                  <option value="series">Series</option>
                  <option value="movie">Movie</option>
                  <option value="anime">Anime</option>
                </select>
              </div>

              <div>
                <label htmlFor="rating" className="mb-1 block text-xs font-medium text-muted">
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
                <label htmlFor="syn" className="mb-1 block text-xs font-medium text-muted">
                  Synopsis
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
                <label htmlFor="genres" className="mb-1 block text-xs font-medium text-muted">
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
                <label htmlFor="runtime" className="mb-1 block text-xs font-medium text-muted">
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
                <label htmlFor="rel" className="mb-1 block text-xs font-medium text-muted">
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
                <label htmlFor="poster" className="mb-1 block text-xs font-medium text-muted">
                  Poster URL
                </label>
                <input id="poster" value={form.posterUrl} onChange={set('posterUrl')} className={INPUT} />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="backdrop" className="mb-1 block text-xs font-medium text-muted">
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
                <label htmlFor="video" className="mb-1 block text-xs font-medium text-muted">
                  Video URL (HLS .m3u8)
                </label>
                <input id="video" value={form.videoUrl} onChange={set('videoUrl')} className={INPUT} />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="subs" className="mb-1 block text-xs font-medium text-muted">
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
                className={`rounded-lg px-3 py-2 text-xs ring-1 ${
                  message.ok
                    ? 'bg-accent/15 text-accent ring-accent/30'
                    : 'bg-cta/15 text-cta ring-cta/30'
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
      )}
    </div>
  );
}
