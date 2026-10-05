import { useMemo, useState } from 'react';
import { useCatalog } from '../context/CatalogContext';
import TitleCard from '../components/TitleCard';

export default function Search() {
  const { titles } = useCatalog();
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('All');
  const [type, setType] = useState('all');

  const ALL_GENRES = useMemo(
    () => ['All', ...new Set(titles.flatMap((t) => t.genres || []))],
    [titles],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return titles.filter((t) => {
      const genres = t.genres || [];
      const matchesQuery =
        !q ||
        t.title.toLowerCase().includes(q) ||
        (t.synopsis || '').toLowerCase().includes(q) ||
        genres.some((g) => g.toLowerCase().includes(q));
      const matchesGenre = genre === 'All' || genres.includes(genre);
      const matchesType = type === 'all' || t.type === type;
      return matchesQuery && matchesGenre && matchesType;
    });
  }, [titles, query, genre, type]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 pb-24 md:pb-16">
      <h1 className="text-2xl font-extrabold">Explore</h1>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, genres or synopses…"
          aria-label="Search titles"
          className="flex-1 rounded-lg bg-surface px-4 py-2.5 text-sm text-text ring-1 ring-white/10 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filter by type"
          className="rounded-lg bg-surface px-3 py-2.5 text-sm text-text ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-accent"
        >
<option value="all">All types</option>
          <option value="movie">Movies</option>
          <option value="series">Series</option>
          <option value="anime">Anime</option>
          <option value="ai">AI Generated</option>
        </select>
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        {ALL_GENRES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGenre(g)}
            aria-pressed={genre === g}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              genre === g
                ? 'bg-accent text-white'
                : 'bg-surface text-muted ring-1 ring-white/10 hover:text-text'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        {results.length} {results.length === 1 ? 'title' : 'titles'}
      </p>

      {results.length === 0 ? (
        <div className="rounded-xl bg-surface p-10 text-center ring-1 ring-white/5">
          <p className="text-sm text-muted">Nothing matched those filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {results.map((t) => (
            <TitleCard key={t.slug} item={t} />
          ))}
        </div>
      )}
    </div>
  );
}