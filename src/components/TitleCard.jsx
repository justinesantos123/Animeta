import { Link } from 'react-router-dom';

export default function TitleCard({ item }) {
  return (
    <Link
      to={`/title/${item.id}`}
      className="group relative block overflow-hidden rounded-xl bg-surface ring-1 ring-white/5 transition duration-200 hover:ring-accent/60 focus-visible:ring-2"
    >
      <div className="relative aspect-2/3 overflow-hidden">
        <img
          src={item.posterUrl}
          alt={`${item.title} poster`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />

        {/* Play affordance: hover on pointer devices, always visible otherwise. */}
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cta/90 shadow-lg shadow-cta/30">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-white" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </div>

        <span className="absolute left-2 top-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-accent">
          {item.rating.toFixed(1)}
        </span>

        <span className="absolute right-2 top-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          {item.type}
        </span>
      </div>

      <div className="p-3">
        <h3 className="truncate text-sm font-semibold text-text">{item.title}</h3>
        <p className="mt-0.5 truncate text-xs text-muted">{item.genres.join(' · ')}</p>
      </div>
    </Link>
  );
}