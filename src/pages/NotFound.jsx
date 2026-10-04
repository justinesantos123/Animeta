import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-24 text-center">
      <p className="text-5xl font-extrabold text-accent">404</p>
      <h1 className="mt-3 text-xl font-bold">This page took a wrong turn</h1>
      <p className="mt-2 text-sm text-muted">The title or page you were looking for isn't here.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
      >
        Back to home
      </Link>
    </div>
  );
}