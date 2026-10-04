import { Routes, Route } from 'react-router-dom';
import { TopNav, BottomNav } from './components/Nav';
import { WatchlistProvider } from './context/WatchlistContext';
import Home from './pages/Home';
import Search from './pages/Search';
import Watchlist from './pages/Watchlist';
import TitleDetail from './pages/TitleDetail';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <WatchlistProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <TopNav />

      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/title/:id" element={<TitleDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="border-t border-white/5 bg-surface/40 pb-24 pt-10 md:pb-10">
        <div className="mx-auto max-w-7xl px-4 text-xs text-muted">
          <p className="text-sm font-bold">
            <span className="text-accent">ANI</span>
            <span className="text-text">META</span>
          </p>
          <p className="mt-2 max-w-md">
            A cinematic streaming interface demo. All titles and artwork are placeholders; video is
            served from public HLS test streams.
          </p>
        </div>
      </footer>

      <BottomNav />
    </WatchlistProvider>
  );
}