// Smoke test: load the production bundle in jsdom and assert React mounted.
// Catches runtime errors (missing imports, bad hooks) that Vite happily builds.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const DIST = new URL('../dist', import.meta.url).pathname.replace(/^\//, '').replace(/^\w:/, (m) => m);
const distDir = new URL('../dist/', import.meta.url).pathname.replace(/^\//, '');

const html = readFileSync(join(distDir, 'index.html'), 'utf8');
const bundleName = readdirSync(join(distDir, 'assets')).find((f) => f.endsWith('.js'));
if (!bundleName) {
  console.error('FAIL: no JS bundle in dist/. Run `npm run build` first.');
  process.exit(1);
}
const bundle = readFileSync(join(distDir, 'assets', bundleName), 'utf8');

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => errors.push(e.message));
virtualConsole.on('error', (...a) => errors.push(a.map(String).join(' ')));

const routes = [
  '/announcements',
  '/',
  '/auth',
  '/forgot-password',
  '/reset-password?token=abc',
  '/search',
  '/watchlist',
  '/kaedeentrans',
  '/admin',
  '/title/solaris-requiem',
];
let failed = 0;

for (const route of routes) {
  errors.length = 0;

  const dom = new JSDOM(html, {
    url: `https://animeta.test${route}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });

  const { window } = dom;

  // Route the mock by URL. A single catch-all body let pages render their
  // loading state forever, so runtime errors inside async loaders went unseen.
  // jsdom exposes no Response constructor. Returning `new window.Response(...)`
  // threw inside the mock, and every page swallowed that into its
  // signed-out/empty state, so these routes "passed" while rendering nothing.
  const json = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  window.fetch = async (input) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    const path = url.replace(/^https:\/\/animeta\.test/, '').split('?')[0];

    if (path === '/api/titles') return json({ titles: [] });
    if (path.startsWith('/api/titles/')) return json({ title: null, seasons: [], episodes: [] });
    if (path === '/api/announcements') return json({ announcements: [] });
    if (path === '/api/announcements/staff') return json({ announcements: [] });
    if (path === '/api/admin/users') return json({ users: [], ownerEmail: null, mailConfigured: false });
    if (path === '/api/admin/dashboard') {
      return json({
        generatedAt: '2026-10-05 12:00:00',
        counts: { total: 0, online: 0, active: 0, idle: 0, offline: 0, never: 0 },
        totals: { watchlist: 0, episodes: 0, lastActiveDays: 0 },
        mostActive: [],
        needsAttention: [],
        recentSignups: [],
        returning: [],
        autoReturnNotifications: true,
        thresholds: { returnAfterDays: 30, notifyAfterDays: 14 },
      });
    }
    if (path === '/api/auth/me') return json({ user: null });
    if (path === '/api/notifications') return json({ notifications: [], unread: 0 });
    if (path === '/api/settings') return json({ autoReturnNotifications: true, returnAfterDays: 30 });
    return json({});
  };

  // An exception thrown inside an async loader rejects the promise instead of
  // propagating, so jsdom never sees it. Capture these explicitly.
  window.__rejections = [];
  window.addEventListener('unhandledrejection', (e) => {
    window.__rejections.push(String(e.reason && e.reason.message ? e.reason.message : e.reason));
  });
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
  window.scrollTo = () => {};

  try {
    window.eval(bundle);
  } catch (e) {
    errors.push(e.message);
  }

  // React renders asynchronously.
  await new Promise((r) => setTimeout(r, 400));

  const root = window.document.getElementById('root');
  const children = root ? root.children.length : 0;
  const text = (root?.textContent || '').trim();

  // Unhandled rejections are where an async loader crash actually shows up.
  if (window.__rejections && window.__rejections.length) {
    errors.push(...window.__rejections);
  }

  // A rendered error banner means the page failed even though React mounted.
  if (/\b(is not defined|is not a function|Cannot read propert)/.test(text)) {
    errors.push('rendered a runtime error: ' + text.slice(0, 120));
  }

  if (errors.length) {
    failed++;
    console.log(`FAIL ${route}`);
    for (const e of errors.slice(0, 3)) console.log(`     ${e.split('\n')[0]}`);
  } else if (children === 0) {
    failed++;
    console.log(`FAIL ${route}  React mounted nothing (#root has 0 children)`);
  } else {
    console.log(`ok   ${route}  ${children} root child(ren), ${text.length} chars of text`);
  }

  window.close();
}

console.log(failed === 0 ? '\nAll routes rendered.' : `\n${failed} route(s) failed.`);
process.exit(failed === 0 ? 0 : 1);