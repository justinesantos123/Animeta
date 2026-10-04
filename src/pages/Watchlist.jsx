import { Link } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';
import TitleCard from '../components/TitleCard';

export default function Watchlist() {
  const { savedTitles } = useCatalog();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 pb-24 md:pb-16">
      <h1 className="text-2xl font-extrabold">My List</h1>
      <p className="mt-1 text-sm text-muted">
        {savedTitles.length === 0
          ? 'Nothing saved yet.'
          : `${savedTitles.length} ${savedTitles.length === 1 ? 'title' : 'titles'} saved.`}
      </p>

      {savedTitles.length === 0 ? (
        <div className="mt-8 rounded-xl bg-surface p-12 text-center ring-1 ring-white/5">
          <p className="text-sm text-muted">Browse titles and add them to build your list.</p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Browse titles
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {savedTitles.map((t) => (
            <TitleCard key={t.slug} item={t} />
          ))}
        </div>
      )}
    </div>
  );
}