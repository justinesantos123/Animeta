import { Link, useParams } from 'react-router-dom';
import { getById, titles } from '../data/titles';
import VideoPlayer from '../components/VideoPlayer';
import TitleCard from '../components/TitleCard';
import { useWatchlist } from '../context/WatchlistContext';

export default function TitleDetail() {
  const { id } = useParams();
  const item = getById(id);
  const { has, toggle } = useWatchlist();

  if (!item) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <h1 className="text-xl font-bold">Title not found</h1>
        <Link to="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  const saved = has(item.id);
  const related = titles.filter((t) => t.id !== item.id).slice(0, 5);

  return (
    <div className="pb-24 md:pb-16">
      {/* Backdrop hero */}
      <section className="relative">
        <img
          src={item.backdropUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/20" />
        <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-8 md:pt-24">
          <h1 className="max-w-3xl text-2xl font-extrabold md:text-4xl">{item.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span className="font-semibold text-accent">{item.rating.toFixed(1)}</span>
            <span>{item.releaseDate}</span>
            <span>{item.runtime}</span>
            <span className="uppercase tracking-wide">{item.type}</span>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-8 px-4">
        <VideoPlayer
          src={item.videoUrl}
          poster={item.backdropUrl}
          subtitlesUrl={item.subtitlesUrl}
          title={item.title}
        />

        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-lg font-bold">{item.title}</h2>
          <button
            type="button"
            onClick={() => toggle(item.id)}
            aria-pressed={saved}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              saved
                ? 'bg-surface-2 text-accent ring-1 ring-accent/50'
                : 'bg-surface text-text ring-1 ring-white/10 hover:bg-surface-2'
            }`}
          >
            {saved ? '✓ In watchlist' : '+ Add to watchlist'}
          </button>
        </div>

        <p className="max-w-3xl text-sm leading-relaxed text-muted">{item.synopsis}</p>

        <div className="flex flex-wrap gap-2">
          {item.genres.map((g) => (
            <span
              key={g}
              className="rounded-full bg-surface px-3 py-1 text-xs text-muted ring-1 ring-white/10"
            >
              {g}
            </span>
          ))}
        </div>

        <section aria-labelledby="related-heading">
          <h2 id="related-heading" className="mb-4 text-lg font-bold">
            Related Titles
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {related.map((t) => (
              <TitleCard key={t.id} item={t} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}