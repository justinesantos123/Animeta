// Renders the real ErrorBoundary around a component that throws during render,
// and asserts it shows the fallback instead of an empty root.
//
// Deliberately does not go through the app bundle: proving the boundary works
// by breaking a page would mean shipping a broken page. Here the crash lives in
// this test file only.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/^\w:/, (m) => m);
const TMP = join(ROOT, 'node_modules', '.cache', 'error-boundary-test');

// Compile the real component and a deliberately broken child into one module.
// esbuild ships with Vite, so this needs no extra dependency.
const { build } = await import('esbuild');

const boundarySrc = readFileSync(join(ROOT, 'src/components/ErrorBoundary.jsx'), 'utf8');

const entry = `
import { createElement, Component } from 'react';
${boundarySrc.replace(/^import .*$/gm, '')}

export function Boom() {
  // The exact class of failure that blanked the Users panel: a component
  // referencing something that does not exist at render time.
  throw new Error('simulated render crash');
}

export function Fine() {
  return createElement('p', { id: 'fine' }, 'healthy child');
}

export { ErrorBoundary };
`;

mkdirSync(TMP, { recursive: true });
const entryFile = join(TMP, 'entry.jsx');
writeFileSync(entryFile, entry, 'utf8');

const outfile = join(TMP, 'bundle.mjs');
await build({
  entryPoints: [entryFile],
  outfile,
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/client'],
  logLevel: 'silent',
});

const { ErrorBoundary, Boom, Fine } = await import(`file:///${outfile.replace(/\\/g, '/')}`);

/**
 * Renders inside a jsdom window.
 *
 * react-dom reads globals such as `window` off the Node realm, so they have to
 * exist before react-dom is imported.
 */
async function renderInDom(children) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});
  virtualConsole.on('log', () => {});

  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://animeta.test/',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  // Install the DOM globals react-dom expects, keeping Node's module system.
  const saved = new Map();
  const define = (key, value) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };

  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) {
    define(key, window[key] ?? window);
  }
  define('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
  define('cancelAnimationFrame', (id) => clearTimeout(id));

  // React 18 rethrows boundary errors; silence it for the duration.
  const realError = console.error;
  console.error = () => {};

  let thrown = null;
  const onError = (e) => {
    thrown = e.message || String(e.error || '');
  };
  window.addEventListener('error', onError);

  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(window.document.getElementById('root'));
  root.render(React.createElement(ErrorBoundary, null, children(React, createRoot)));

  await new Promise((r) => setTimeout(r, 250));

  const doc = window.document;
  const text = (doc.getElementById('root')?.textContent || '').replace(/\s+/g, ' ').trim();
  const html = doc.getElementById('root')?.innerHTML || '';
  const hasReload = !!doc.querySelector('#root button');

  window.removeEventListener('error', onError);
  console.error = realError;
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  window.close();

  return { text, html, hasReload, thrown };
}

let failed = 0;

// --- 1. A crashing child shows the fallback ------------------------------
{
  const { text, hasReload } = await renderInDom((React) => React.createElement(Boom));

  if (!/failed to load/i.test(text)) {
    failed++;
    console.log(`FAIL boundary  no fallback shown, root text was: ${text || '(empty)'}`);
  } else if (!hasReload) {
    failed++;
    console.log('FAIL boundary  fallback shown but there is no Reload button');
  } else {
    console.log(`ok   ErrorBoundary replaces a crashed render: "${text.slice(0, 58)}..."`);
  }
}

// --- 2. A healthy child renders untouched --------------------------------
{
  const { html } = await renderInDom((React) => React.createElement(Fine));

  if (!/healthy child/.test(html) || /failed to load/.test(html)) {
    failed++;
    console.log(`FAIL boundary  healthy child did not pass through: ${html || '(empty)'}`);
  } else {
    console.log('ok   ErrorBoundary passes a healthy child straight through');
  }
}

console.log(failed === 0 ? '\nErrorBoundary behaves correctly.' : `\n${failed} boundary check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);