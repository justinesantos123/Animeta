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

    const res = await env.ASSETS.fetch(request);

    // Client-side routes (/title/x, /search, /watchlist) have no matching file.
    // Serve the SPA shell instead, but leave real asset requests alone.
    if (res.status === 404) {
      const looksLikeFile = url.pathname.includes('.');
      if (!looksLikeFile) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
      }
    }

    return res;
  },
};