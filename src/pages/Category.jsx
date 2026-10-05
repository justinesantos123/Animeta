import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';
import TitleCard from '../components/TitleCard';
import NotFound from './NotFound';
import { TITLE_TYPES, titleTypeMeta, titleTypeLabel, typePath } from '../lib/titleTypes';

/**
 * One page per catalog category: /category/anime, /category/movie,
 * /category/series, /category/ai.
 *
 * Open to signed-out visitors, like the rest of the catalog. Only the playback
 * of gated categories needs an account, which the title page handles.
 */
export default function Category() {
  const { type } = useParams();
  const { titles, loading, error } = useCatalog();

  const meta = useMemo(() => titleTypeMeta(type), [type]);
  const items = useMemo(() => titles.filter((t) => t.type === type), [titles, type]);

  // Counts for the other categories, so the page can act as a category index.
  const counts = useMemo(() => {
    const map = {};
    for (const t of titles) map[t.type] = (map[t.type] ?? 0) + 1;
    return map;
  }, [titles]);

  if (!meta) return <NotFound />;

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 md:pb-16">
      <nav aria-label="Breadcrumb" className="text-xs text-muted">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/browse" className="hover:text-text">
              Browse
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-text">{meta.label}</li>
        </ol>
      </nav>

      <header className="mt-3">
        <h1 className="text-2xl font-extrabold md:text-3xl">{meta.label}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{meta.blurb}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">
            {items.length} {items.length === 1 ? 'title' : 'titles'}
          </span>
          {meta.gated ? (
            <span className="rounded bg-accent/15 px-2 py-0.5 font-semibold text-accent">
              Sign-in to watch
            </span>
          ) : (
            <span className="rounded bg-surface px-2 py-0.5 text-muted ring-1 ring-white/10">
              Plays without an account
            </span>
          )}
        </p>
      </header>

      {/* Every category stays one click away. */}
      <nav
        aria-label="Categories"
        className="mt-6 flex flex-wrap items-center gap-2 border-b border-white/10 pb-3"
      >
        {TITLE_TYPES.filter((t) => counts[t.value] > 0 || t.value === meta.value).map((t) => (
          <Link
            key={t.value}
            to={typePath(t.value)}
            aria-current={t.value === meta.value ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              t.value === meta.value
                ? 'bg-accent/20 text-accent'
                : 'bg-surface text-muted hover:text-text'
            }`}
          >
            {t.label}
            <span className="ml-1 text-muted">{counts[t.value] ?? 0}</span>
          </Link>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="mt-8 rounded-lg bg-cta/15 px-3 py-2 text-sm text-cta">
          Could not load the catalog: {error}
        </p>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">
          Nothing in {meta.label} yet. Try{' '}
          <Link to="/browse" className="text-accent hover:underline">
            the full catalog
          </Link>
          .
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((t) => (
            <TitleCard key={t.slug} item={t} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Exported for the browse page, which links into each category. */
export function categoryLink(type, titles) {
  const n = titles.filter((t) => t.type === type).length;
  return { to: typePath(type), label: titleTypeLabel(type), count: n };
}