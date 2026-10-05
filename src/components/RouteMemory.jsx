import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Remembers where the reader was, so a reload does not lose the page.
 *
 * Normally a refresh re-requests the current path and the SPA comes back up in
 * the same place, and this component does nothing. It exists because of a
 * misconfiguration on the zone: Cloudflare's Automatic Speculation Rules answer
 * every non-asset path with a 307 to "/", so a hard refresh on /support/abc
 * lands on the homepage and the reader loses their place -- which for somebody
 * part-way through a support conversation is the worst possible moment to lose
 * it.
 *
 * So when we are bounced back to "/" and we remember being somewhere specific
 * recently, we go back there. This is a workaround for a redirect that should not
 * be happening, not a general navigation system, and it should be removable once
 * the rules are turned off.
 *
 * Scoped deliberately:
 *   - only /support and the staff console, so it cannot hijack ordinary pages
 *   - only within the half hour, so a reload tomorrow does not resurrect
 *     yesterday's page
 */

const KEY = 'animeta:last-place';
const MAX_AGE_MS = 30 * 60 * 1000;
const RESTORABLE = ['/support', '/kaedeentrans'];

function isRestorable(pathname) {
  return RESTORABLE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function RouteMemory() {
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);

  // The full path INCLUDING the query. The staff console keeps the open tab and
  // the open ticket in search params, so storing only the pathname brought back
  // the console and dropped the conversation -- which is the whole thing.
  const here = `${location.pathname}${location.search}`;

  // Save as the reader moves around.
  useEffect(() => {
    if (isRestorable(location.pathname)) {
      try {
        window.sessionStorage.setItem(KEY, here);
        window.sessionStorage.setItem(`${KEY}:at`, String(Date.now()));
      } catch {
        /* private mode, or storage full. Losing the memory is harmless. */
      }
    }
  }, [here, location.pathname]);

  // Put them back once, if we were bounced home.
  useEffect(() => {
    if (restored.current) return;
    if (location.pathname !== '/') {
      restored.current = true;
      return;
    }

    let saved = null;
    let at = 0;
    try {
      saved = window.sessionStorage.getItem(KEY);
      at = Number(window.sessionStorage.getItem(`${KEY}:at`) || 0);
    } catch {
      saved = null;
    }
    if (!saved || !isRestorable(saved.split('?')[0])) return;
    if (!at || Date.now() - at > MAX_AGE_MS) return;

    restored.current = true;
    navigate(saved, { replace: true });
  }, [location.pathname, navigate]);

  return null;
}