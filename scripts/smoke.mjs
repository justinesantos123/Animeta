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

  // Minimal browser APIs the bundle touches.
  window.fetch = async () =>
    new window.Response('{"titles":[]}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
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