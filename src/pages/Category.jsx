import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';
import TitleCard from '../components/TitleCard';
import NotFound from './NotFound';
import { TITLE_TYPES, titleTypeMeta, typePath } from '../lib/titleTypes';

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

  const items = useMemo(
    () =>
      titles
        .filter((t) => t.type === type)
        .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate))),
    [titles, type],
  );

  // Counts for the other categories, so the page doubles as a category index.
  const counts = useMemo(() => {
    const map = {};
    for (const t of titles) map[t.type] = (map[t.type] ?? 0) + 1;
    return map;
  }, [titles]);

  if (!meta) return <NotFound />;

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 md:pb-16">
      <nav aria-label="Breadcrumb" className="text-xs text-[var(--color-faint)]">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/browse" className="hover:text-[var(--color-text)]">
              Browse
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-[var(--color-muted)]">{meta.label}</li>
        </ol>
      </nav>

      <header className="mt-3 max-w-2xl">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">{meta.label}</h1>
          <span className="text-sm tabular-nums text-[var(--color-faint)]">{items.length}</span>
        </div>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">{meta.blurb}</p>
        <p className="mt-2 text-xs text-[var(--color-faint)]">
          {meta.gated
            ? 'The first episode plays free. An account is needed from episode 2 onwards.'
            : 'Plays without an account.'}
        </p>
      </header>

      {/* Every category stays one click away. */}
      <nav aria-label="Categories" className="mt-7 flex flex-wrap items-center gap-1.5">
        {TITLE_TYPES.filter((t) => counts[t.value] > 0 || t.value === meta.value).map((t) => (
          <Link
            key={t.value}
            to={typePath(t.value)}
            aria-current={t.value === meta.value ? 'page' : undefined}
            className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium transition ${
              t.value === meta.value
                ? 'bg-[var(--color-surface-3)] text-[var(--color-text)]'
                : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
            }`}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums text-[var(--color-faint)]">
              {counts[t.value] ?? 0}
            </span>
          </Link>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="mt-8 rounded-[var(--radius-control)] bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
          The catalog didn&rsquo;t load: {error}
        </p>
      ) : items.length === 0 ? (
        <p className="py-20 text-sm text-[var(--color-muted)]">
          Nothing in {meta.label} yet.{' '}
          <Link to="/browse" className="text-[var(--color-accent)] hover:underline">
            See everything
          </Link>
          .
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((t) => (
            <TitleCard key={t.slug} item={t} />
          ))}
        </div>
      )}
    </div>
  );
}