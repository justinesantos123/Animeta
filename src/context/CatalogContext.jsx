import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';

const CatalogContext = createContext(null);

/**
 * Catalog + watchlist state.
 *
 * Watchlist needs to work signed-out (localStorage) *and* signed-in (D1), so
 * this merges both sources rather than making one mode the fallback.
 */
export function CatalogProvider({ children }) {
  const { user, ready: authReady } = useAuth();

  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [saved, setSaved] = useState([]); // slugs
  const [signedInSaved, setSignedInSaved] = useState([]); // slugs from D1

  const LOCAL_KEY = 'animeta:watchlist';

  const readLocal = useCallback(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }, []);

  const writeLocal = useCallback((slugs) => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(slugs));
    } catch {
      /* private mode */
    }
  }, []);

  // Catalog
  useEffect(() => {
    let cancelled = false;
    api
      .listTitles()
      .then((d) => {
        if (!cancelled) {
          setTitles(d.titles);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Watchlist: local on load, then merge with the account's list once we know who they are.
  useEffect(() => {
    setSaved(readLocal());
  }, [readLocal]);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setSignedInSaved([]);
      return;
    }
    let cancelled = false;
    api
      .watchlist()
      .then((d) => {
        if (!cancelled) setSignedInSaved(d.titles.map((t) => t.slug));
      })
      .catch(() => {
        if (!cancelled) setSignedInSaved([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authReady]);

  // Merge the two sources, de-duplicated.
  useEffect(() => {
    if (!user) return;
    const merged = [...new Set([...signedInSaved, ...saved])];
    if (merged.length !== signedInSaved.length) setSignedInSaved(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, signedInSaved]);

  const has = useCallback(
    (slug) => (user ? signedInSaved.includes(slug) : saved.includes(slug)),
    [user, signedInSaved, saved],
  );

  const toggle = useCallback(
    async (slug) => {
      // Optimistic in both modes, reconciled by the request result.
      if (user) {
        const was = signedInSaved.includes(slug);
        setSignedInSaved((p) => (was ? p.filter((s) => s !== slug) : [...p, slug]));
        try {
          if (was) await api.removeWatchlist(slug);
          else await api.addWatchlist(slug);
        } catch {
          setSignedInSaved((p) => (was ? [...p, slug] : p.filter((s) => s !== slug)));
        }
        return;
      }

      const was = saved.includes(slug);
      const next = was ? saved.filter((s) => s !== slug) : [...saved, slug];
      setSaved(next);
      writeLocal(next);
    },
    [user, signedInSaved, saved, writeLocal],
  );

  const savedTitles = useMemo(
    () => titles.filter((t) => (user ? signedInSaved.includes(t.slug) : saved.includes(t.slug))),
    [titles, user, signedInSaved, saved],
  );

  const featured = useMemo(() => titles.find((t) => t.featured) ?? titles[0] ?? null, [titles]);

  const value = useMemo(
    () => ({
      titles,
      loading,
      error,
      featured,
      has,
      toggle,
      savedTitles,
      isEmpty: !loading && titles.length === 0,
    }),
    [titles, loading, error, featured, has, toggle, savedTitles],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used inside CatalogProvider');
  return ctx;
}