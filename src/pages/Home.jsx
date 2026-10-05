import { Link } from 'react-router-dom';
import { titleTypeLabel, TITLE_TYPES, typePath } from '../lib/titleTypes';
import { useCatalog } from '../context/CatalogContext';
import TitleCard from '../components/TitleCard';
import ContinueWatching from '../components/ContinueWatching';

export default function Home() {
  const { titles, loading, error, featured, isEmpty } = useCatalog();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="flex items-center gap-3 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
          Loading catalog
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <h1 className="text-lg font-semibold">The catalog didn&rsquo;t load</h1>
        <p className="mt-1.5 text-sm text-muted">{error}</p>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <h1 className="text-lg font-semibold">Nothing published yet</h1>
        <p className="mt-1.5 max-w-md text-sm text-muted">
          Every title here is uploaded by our team. Nothing has been published so far.
        </p>
      </div>
    );
  }

// Two genuinely different orderings. The previous version sliced the same
// array three ways, so the same covers appeared under three headings.
const newest = [...titles]
  .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))
  .slice(0, 10);
const topRated = [...titles].sort((a, b) => Number(b.rating) - Number(a.rating)).slice(0, 10);

  return (
    <div className="pb-24 md:pb-16">
      {featured && (
        <section className="relative">
          <img
            src={featured.backdropUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Two-stop scrim: opaque enough at the base for text contrast,
              transparent at the top so the artwork still reads. */}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)]/80 to-[var(--color-bg)]/25" />
          <div className="relative mx-auto flex min-h-[26rem] max-w-7xl flex-col justify-end px-4 pb-10 pt-24 md:min-h-[30rem] md:pb-14">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
              Featured {titleTypeLabel(featured.type)}
            </p>
            <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-[1.1] tracking-[-0.02em] md:text-5xl">
              {featured.title}
            </h1>
            <p className="clamp-3 mt-3 max-w-xl text-sm text-[var(--color-muted)] md:text-[15px]">
              {featured.synopsis}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-faint)]">
              <span className="font-semibold tabular-nums text-[var(--color-text)]">
                {Number(featured.rating).toFixed(1)}
              </span>
              <span aria-hidden="true">/</span>
              <span className="tabular-nums">{featured.releaseDate?.slice(0, 4)}</span>
              <span aria-hidden="true">/</span>
              <span>{featured.runtime}</span>
              <span aria-hidden="true">/</span>
              <span>{featured.genres.slice(0, 3).join(', ')}</span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link to={`/title/${featured.slug}`} className="btn-primary">
                Watch now
              </Link>
              <Link to="/browse" className="btn-secondary">
                Browse all
              </Link>
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto max-w-7xl px-4 pt-10 md:pt-14">
        <ContinueWatching />

        <section aria-labelledby="newest-heading" className="mt-14 first:mt-0">
          <div className="section-head">
            <h2 id="newest-heading" className="section-head__title">
              Newest releases
            </h2>
            <span className="section-head__meta">by release date</span>
            <Link
              to="/browse"
              className="ml-auto text-xs text-[var(--color-accent)] hover:underline"
            >
              All titles
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {newest.map((t, i) => (
              <TitleCard key={t.slug} item={t} priority={i < 5} />
            ))}
          </div>
        </section>

        {topRated.length > 0 && (
          <section aria-labelledby="rated-heading" className="mt-14">
            <div className="section-head">
              <h2 id="rated-heading" className="section-head__title">
                Highest rated
              </h2>
              <span className="section-head__meta">across the catalog</span>
            </div>
            {/* A rail rather than a second grid: repeating titles under a
                different ordering is expected, and a half-empty grid row
                reads as a bug. */}
            <ul className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4">
              {topRated.map((t) => (
                <li key={t.slug} className="w-40 shrink-0 sm:w-44">
                  <TitleCard item={t} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Category entry points, so the four categories are one click from home
            rather than only from the nav and Browse. */}
        <section aria-labelledby="categories-heading" className="mt-14">
          <div className="section-head">
            <h2 id="categories-heading" className="section-head__title">
              Browse by category
            </h2>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {categoriesWithCounts(titles).map((c) => (
              <Link
                key={c.value}
                to={c.to}
                className="group flex items-baseline justify-between rounded-[var(--radius-card)] bg-surface px-4 py-3.5 ring-1 ring-[var(--color-line)] transition hover:bg-[var(--color-surface-2)] hover:ring-[var(--color-line-strong)]"
              >
                <span className="text-sm font-medium">{c.label}</span>
                <span className="text-xs tabular-nums text-[var(--color-faint)]">{c.count}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** The four categories with live counts, using shared label + path helpers. */
function categoriesWithCounts(titles) {
  return TITLE_TYPES.map((t) => ({
    value: t.value,
    label: t.label,
    to: typePath(t.value),
    count: titles.filter((x) => x.type === t.value).length,
  })).filter((c) => c.count > 0);
}