import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';
import TitleCard from '../components/TitleCard';
import { TITLE_TYPES, titleTypeLabel, typePath } from '../lib/titleTypes';

/**
 * The full catalog, grouped by type.
 *
 * Browsing is deliberately open to signed-out visitors: every row is visible
 * and every detail page renders. Only playback of episodic titles is gated.
 */
export default function Browse() {
  const { titles, loading, error } = useCatalog();
  const [type, setType] = useState('all');

  const counts = useMemo(() => {
    const map = Object.fromEntries(TITLE_TYPES.map((t) => [t.value, 0]));
    for (const t of titles) {
      if (map[t.type] !== undefined) map[t.type] += 1;
    }
    return map;
  }, [titles]);

  const sections = useMemo(
    () =>
      TITLE_TYPES.map((meta) => ({
        ...meta,
        items: titles.filter((t) => t.type === meta.value),
      })).filter((s) => s.items.length > 0),
    [titles],
  );

  const shown = type === 'all' ? sections : sections.filter((s) => s.value === type);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <h1 className="text-xl font-bold">Could not load the catalog</h1>
        <p className="mt-2 text-sm text-muted">{error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 md:pb-16">
      <header>
        <h1 className="text-2xl font-extrabold md:text-3xl">Browse everything</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          All {titles.length} titles across movies, anime, series and AI-generated releases.
          Browsing is free — an account is only needed to watch episodes.
        </p>
      </header>

      {/* Type filter. Also acts as in-page navigation via the section ids. */}
      <nav
        aria-label="Filter by type"
        className="mt-6 flex flex-wrap items-center gap-2 border-b border-white/10 pb-3"
      >
        <FilterChip active={type === 'all'} onClick={() => setType('all')}>
          All
          <span className="ml-1 text-muted">{titles.length}</span>
        </FilterChip>
        {TITLE_TYPES.filter((meta) => counts[meta.value] > 0).map((meta) => (
          <FilterChip
            key={meta.value}
            active={type === meta.value}
            onClick={() => setType(meta.value)}
          >
            {titleTypeLabel(meta.value)}
            <span className="ml-1 text-muted">{counts[meta.value]}</span>
          </FilterChip>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">No titles in this category yet.</p>
      ) : (
        <div className="mt-8 space-y-12">
          {shown.map((section) => (
            <section
              key={section.value}
              id={`type-${section.value}`}
              aria-labelledby={`h-${section.value}`}
            >
              <div className="mb-4 flex flex-wrap items-baseline gap-3">
                <h2 id={`h-${section.value}`} className="text-lg font-bold">
                  <Link
                    to={typePath(section.value)}
                    className="hover:text-accent focus-visible:text-accent"
                  >
                    {titleTypeLabel(section.value)}
                  </Link>
                </h2>
                <span className="text-xs text-muted">
                  {section.items.length} {section.items.length === 1 ? 'title' : 'titles'}
                </span>
                {section.gated && (
                  <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    Sign-in to watch
                  </span>
                )}
                <Link
                  to={typePath(section.value)}
                  className="ml-auto text-xs text-accent hover:underline"
                >
                  See all {titleTypeLabel(section.value)}
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {section.items.map((t) => (
                  <TitleCard key={t.slug} item={t} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-12 text-xs text-muted">
        Looking for something specific?{' '}
        <Link to="/search" className="text-accent hover:underline">
          Use search
        </Link>{' '}
        to filter by genre and keyword.
      </p>
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-accent/20 text-accent' : 'bg-surface text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}