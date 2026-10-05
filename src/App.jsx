import { Routes, Route } from 'react-router-dom';
import { TopNav, BottomNav } from './components/Nav';
import WelcomeBanner from './components/WelcomeBanner';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { CatalogProvider } from './context/CatalogContext';
import { NotificationsProvider } from './context/NotificationsContext';
import Home from './pages/Home';
import Browse from './pages/Browse';
import Category from './pages/Category';
import Search from './pages/Search';
import Watchlist from './pages/Watchlist';
import TitleDetail from './pages/TitleDetail';
import AuthPage from './pages/AuthPage';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Announcements from './pages/Announcements';
import Admin from './pages/Admin';
import Profile from './pages/Profile';
import NotFound from './pages/NotFound';
import { Navigate } from 'react-router-dom';

export default function App() {
  return (
    <AuthProvider>
      <CatalogProvider>
        <NotificationsProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>

        <TopNav />
        <WelcomeBanner />

        <main id="main">
          {/* Anything below can fail without blanking the whole page. */}
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/category/:type" element={<Category />} />
              <Route path="/search" element={<Search />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/announcements" element={<Announcements />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/kaedeentrans" element={<Admin />} />
              {/* Old path kept working so existing bookmarks do not dead-end. */}
              <Route path="/admin" element={<Navigate to="/kaedeentrans" replace />} />
              <Route path="/title/:slug" element={<TitleDetail />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </main>

        <footer className="border-t border-[var(--color-line)] bg-surface/40 pb-24 pt-10 md:pb-10">
          <div className="mx-auto max-w-7xl px-4 text-xs text-muted">
            <p className="text-sm font-bold">
              <span className="text-accent">ANI</span>
              <span className="text-text">META</span>
            </p>
            <p className="mt-2 max-w-md">
              Early access build. The catalog is filled in by our admins and moderators, who upload
              each video themselves.
            </p>
          </div>
        </footer>

        <BottomNav />
        </NotificationsProvider>
      </CatalogProvider>
    </AuthProvider>
  );
}