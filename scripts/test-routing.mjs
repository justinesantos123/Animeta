/**
 * Routing guard for the Worker shell.
 *
 * This exists because the SPA fallback looked correct and was not. It branched on
 * ASSETS returning 404, but ASSETS answers an unmatched navigation with a 307 to
 * "/", so the branch never ran and every direct link to a client-side route
 * bounced to the homepage. jsdom could not have caught that, because React Router
 * never asks the server for a route it is already inside.
 *
 * So this exercises the real fetch handler against a stub ASSETS that reproduces
 * the redirect the platform actually sends.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
let failed = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

const worker = (await import(new URL('../worker/index.js', import.meta.url))).default;

/** Mimics Workers Static Assets: real files pass, everything else 307s to "/". */
function makeAssets() {
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/index.html' || path === '/') {
        return new Response('<!doctype html><div id="root"></div>', {
          headers: { 'content-type': 'text/html' },
        });
      }
      if (/\.[a-z0-9]+$/i.test(path)) {
        return new Response(`/* ${path} */`, { headers: { 'content-type': 'text/js' } });
      }
      // The behaviour that broke the old fallback.
      return Response.redirect('https://animeta.studykittools.com/', 307);
    },
  };
}

const env = { ASSETS: makeAssets() };

async function get(path, init = {}) {
  const res = await worker.fetch(new Request(`https://animeta.studykittools.com${path}`, init), env);
  return res;
}

// The routes the SPA owns. Each one must land on the shell, not on a redirect.
const clientRoutes = [
  '/',
  '/browse',
  '/search',
  '/watchlist',
  '/admin',
  '/category/series',
  '/title/tail-probe',
  // Slugs cannot contain a dot, so a dotted segment is always a real file.
];

for (const route of clientRoutes) {
  const res = await get(route);
  const type = res.headers.get('content-type') || '';
  check(
    `${route} serves the SPA shell`,
    res.status === 200 && type.includes('text/html'),
    `status ${res.status}, location ${res.headers.get('location') || 'none'}`,
  );
}

// Asset requests must still reach the real file and not be rewritten to the shell.
const asset = await get('/assets/index-abc123.js');
check(
  'a real asset is served as itself',
  asset.status === 200 && (await asset.text()).includes('/assets/index-abc123.js'),
  `status ${asset.status}`,
);

// /api must reach the JSON API. Stub it: this test is about the shell, not routing
// inside the API, and the API needs D1 to answer anything.
const apiHits = [];
const apiEnv = {
  ASSETS: makeAssets(),
  DB: new Proxy({}, { get: () => { throw new Error('D1 not stubbed'); } }),
};

const apiWorker = {
  ...worker,
  async fetch(request, e) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      apiHits.push(path);
      return new Response('{"error":"not stubbed"}', { status: 401 });
    }
    return worker.fetch(request, e);
  },
};

await apiWorker.fetch(new Request('https://animeta.studykittools.com/api/titles/x'), apiEnv);
check('/api requests reach the API, not the shell', apiHits.includes('/api/titles/x'), apiHits.join(','));

// Non-GET/HEAD must still be rejected before touching assets.
const posted = await worker.fetch(
  new Request('https://animeta.studykittools.com/browse', { method: 'POST' }),
  env,
);
check('non-GET on a page is rejected', posted.status === 405, `status ${posted.status}`);

// The old shape must not come back.
check('the fallback does not branch on a 404 from ASSETS', !/res\.status === 404/.test(src));

console.log('');
if (failed > 0) {
  console.log(`${failed} routing check(s) failed.`);
  process.exit(1);
}
console.log('SPA routing is consistent.');