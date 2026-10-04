import { Link } from 'react-router-dom';
import { titles } from '../data/titles';
import TitleCard from '../components/TitleCard';
import { useWatchlist } from '../context/WatchlistContext';

export default function Watchlist() {
  const { ids } = useWatchlist();
  const saved = titles.filter((t) => ids.includes(t.id));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 pb-24 md:pb-16">
      <h1 className="text-2xl font-extrabold">My List</h1>
      <p className="mt-1 text-sm text-muted">
        {saved.length === 0
          ? 'Nothing saved yet.'
          : `${saved.length} ${saved.length === 1 ? 'title' : 'titles'} saved to this device.`}
      </p>

      {saved.length === 0 ? (
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
          {saved.map((t) => (
            <TitleCard key={t.id} item={t} />
          ))}
        </div>
      )}
    </div>
  );
}