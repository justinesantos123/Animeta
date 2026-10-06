import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Turns a fragment link into a real route.
 *
 * Links that arrive by email -- email verification, password reset -- carry their
 * target in the URL fragment rather than the query string, and resolve to
 * something like:
 *
 *   https://animeta.example/#/verify-email?token=abc
 *
 * The fragment is never sent to the server, so the browser requests "/" and gets
 * the app. This component then reads the fragment and navigates to it, without a
 * second request. A query-string link cannot work here: the zone answers every
 * non-asset path with a 307 to "/", which drops the query and the token with it,
 * so the link arrives as nothing at all.
 *
 * The fragment form keeps working once those rules are turned off, so there is
 * nothing to revert. Plain paths continue to work exactly as before; only the
 * `#/...` form is handled, so ordinary anchors are untouched.
 */
export default function HashRoutes() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = location.hash;
    // Only our own form: "#/something". A plain "#section" anchor is somebody
    // else's and must be left alone.
    if (!hash || hash.length < 2 || hash[1] !== '/') return;

    const target = hash.slice(1).replace(/#$/, '');
    if (!target || target === location.pathname + location.search) return;

    // replace, so the fragment does not linger and re-trigger on the next change.
    navigate(target, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  return null;
}