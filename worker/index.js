import { handleApi } from './api.js';

/**
 * Animeta Worker.
 *
 * Serves two things from one deployment:
 *   /api/*  -> the JSON API (D1-backed)
 *   /*      -> the built SPA from the ASSETS binding
 *
 * Assets use not_found_handling "none" rather than "single-page-application"
 * because SPA mode would swallow /api/* requests and return index.html for
 * them. SPA fallback is handled below instead.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Client-side routes (/title/x, /browse, /search, /watchlist) have no file
    // behind them and must get the SPA shell.
    //
    // The decision is made from the path rather than from what ASSETS returns.
    // ASSETS answers an unmatched navigation with a 307 to "/", not a 404, so
    // the old "if it 404s, serve index.html" fallback never fired: every direct
    // link and every refresh on a non-home page bounced back to the homepage.
    //
    // Slugs are produced by slugify, which strips everything but [a-z0-9-], so a
    // real route never contains a dot. An extension therefore means a file.
    if (!url.pathname.includes('.')) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }

    return env.ASSETS.fetch(request);
  },
};