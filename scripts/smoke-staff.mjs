// Mounts the built bundle as a signed-in staff member and clicks through every
// staff-console tab, asserting each one actually renders content.
//
// scripts/smoke.mjs mocks /api/auth/me as null, so the console only ever
// renders its signed-out gate. This exercises the real tab bodies.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const distDir = new URL('../dist/', import.meta.url).pathname.replace(/^\//, '');
const html = readFileSync(join(distDir, 'index.html'), 'utf8');
const bundleName = readdirSync(join(distDir, 'assets')).find((f) => f.endsWith('.js'));
const bundle = readFileSync(join(distDir, 'assets', bundleName), 'utf8');

// Mirrors the real /api/admin/dashboard payload. A partial `{}` here makes the
// dashboard throw on `counts.active`, which reads like a product bug but is not.
const DASHBOARD = {
  generatedAt: '2026-10-05 12:00:00',
  counts: { total: 2, online: 1, active: 0, idle: 0, offline: 1, never: 0 },
  totals: { watchlist: 3, episodes: 12, lastActiveDays: 1 },
  mostActive: [
    { id: 'u1', username: 'justinezantoz01', email: 'justinezantoz01@gmail.com', watchlistCount: 3, lastActiveDays: 1 },
  ],
  needsAttention: [],
  recentSignups: [],
  returning: [],
  autoReturnNotifications: true,
  thresholds: { returnAfterDays: 30, notifyAfterDays: 14 },
};

const USERS = {
  users: [
    {
      id: 'u1',
      email: 'justinezantoz01@gmail.com',
      username: 'justinezantoz01',
      role: 'admin',
      displayName: null,
      createdAt: '2026-01-04 10:12:00',
      watchlistCount: 3,
      lastSeenAt: '2026-10-05 09:00:00',
      daysOffline: 0,
      presence: 'online',
      passwordFingerprint: 'ab12cd34',
      passwordHistory: [{ action: 'user.password.reset', at: '2026-02-01 08:00:00' }],
      isOwner: true,
    },
    {
      id: 'u2',
      email: 'justinee@gmail.com',
      username: 'justinee',
      role: 'user',
      displayName: null,
      createdAt: '2026-03-11 14:02:00',
      watchlistCount: 0,
      lastSeenAt: null,
      daysOffline: null,
      presence: 'never',
      passwordFingerprint: null,
      passwordHistory: [],
      isOwner: false,
    },
  ],
  ownerEmail: 'justinezantoz01@gmail.com',
  mailConfigured: false,
};

async function run(role) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  virtualConsole.on('error', (...a) => errors.push(a.map(String).join(' ')));

  const dom = new JSDOM(html, {
    url: 'https://animeta.test/kaedeentrans',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const doc = window.document;

  // jsdom exposes no Response constructor, so hand back a plain object with the
  // bits api.js touches: ok, status, json(). Using window.Response here threw
  // inside the mock, which every page swallowed into its signed-out state.
  const json = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  const seen = [];
  window.fetch = async (input) => {
    const path = String(typeof input === 'string' ? input : input?.url || '')
      .replace(/^https:\/\/animeta\.test/, '')
      .split('?')[0];
    seen.push(path);
    if (path === '/api/auth/me') {
      return json({ user: { id: 'u1', email: 'justinezantoz01@gmail.com', username: 'justinezantoz01', displayName: null, role } });
    }
    if (path === '/api/admin/users') return json(USERS);
    if (path === '/api/admin/dashboard') return json(DASHBOARD);
    if (path === '/api/announcements') return json({ announcements: [] });
    if (path === '/api/announcements/staff') return json({ announcements: [] });
    if (path === '/api/titles') return json({ titles: [] });
    if (path === '/api/notifications') return json({ notifications: [], unread: 0 });
    if (path === '/api/settings') return json({ autoReturnNotifications: true, returnAfterDays: 30 });
    return json({});
  };

  window.__rejections = [];
  window.addEventListener('unhandledrejection', (e) => {
    window.__rejections.push(String(e.reason?.message || e.reason));
  });
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.alert = () => {};

  try {
    window.eval(bundle);
  } catch (e) {
    errors.push(e.message);
  }

  await new Promise((r) => setTimeout(r, 500));

  // The greeting must not appear on a plain page load, only after sign-in.
  const strayBanner = doc.querySelector('[role="status"]')?.textContent?.trim() || '';
  if (/Welcome/.test(strayBanner)) {
    errors.push(`greeting showed without signing in: ${strayBanner}`);
  }

  // Find the tablist and click each tab in turn.
  const tablist = doc.querySelector('[role="tablist"]');
  if (!tablist) {
    console.log(`FAIL (${role}) staff console did not render a tablist`);
    console.log(`     fetches: ${seen.join(', ')}`);
    console.log(`     errors: ${errors.slice(0, 4).map((e) => e.split('\n')[0]).join(' | ') || 'none'}`);
    console.log(`     rejections: ${window.__rejections.slice(0, 4).join(' | ') || 'none'}`);
    console.log(`     body: ${(doc.getElementById('root')?.textContent || '').trim().slice(0, 200)}`);
    return { failed: 1, window };
  }

  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  console.log(`tabs visible as ${role}: ${tabs.map((t) => t.textContent.trim()).join(', ')}`);

  let failed = 0;
  for (const tab of tabs) {
    const label = tab.textContent.trim();
    errors.length = 0;
    tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));

    const panel = doc.getElementById('root');
    const text = (panel?.textContent || '').trim();
    const crashed = /\b(is not defined|is not a function|Cannot read propert)/.test(text);
    const rejected = window.__rejections.length > 0;

    if (errors.length || crashed || rejected) {
      failed++;
      console.log(`FAIL (${role}) tab "${label}"`);
      for (const e of errors.slice(0, 2)) console.log(`     ${e.split('\n')[0]}`);
      for (const r of window.__rejections.slice(0, 2)) console.log(`     rejection: ${r}`);
      if (crashed) console.log(`     rendered: ${text.slice(0, 160)}`);
    } else if (text.length < 40) {
      failed++;
      console.log(`FAIL (${role}) tab "${label}" rendered almost nothing (${text.length} chars): ${text.slice(0, 120)}`);
    } else {
      if (label === 'Users') {
        // Prove the table has real rows, not just a heading.
        const rows = [...doc.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.querySelectorAll('td')]
            .slice(0, 2)
            .map((td) => td.textContent.trim())
            .join(' | '),
        );
        if (rows.length !== USERS.users.length) {
          failed++;
          console.log(`FAIL (${role}) tab "Users" expected ${USERS.users.length} rows, got ${rows.length}`);
        } else {
          for (const r of rows) console.log(`       row: ${r}`);
        }
      }
      console.log(`ok   (${role}) tab "${label}"  ${text.length} chars`);
    }
    window.__rejections.length = 0;
  }

  window.close();
  return { failed, window: null };
}

let total = 0;
for (const role of ['admin', 'moderator']) {
  total += (await run(role)).failed;
}

// Drives a real sign-in through the UI and asserts the greeting appears.
async function checkGreeting() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  virtualConsole.on('error', (...a) => errors.push(a.map(String).join(' ')));

  const dom = new JSDOM(html, {
    url: 'https://animeta.test/auth',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const doc = window.document;

  const json = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  const ACCOUNT = {
    id: 'u1',
    email: 'justinezantoz01@gmail.com',
    username: 'justinezantoz01',
    displayName: null,
    role: 'admin',
  };

  window.fetch = async (input) => {
    const path = String(typeof input === 'string' ? input : input?.url || '')
      .replace(/^https:\/\/animeta\.test/, '')
      .split('?')[0];
    if (path === '/api/auth/me') return json({ user: null });
    if (path === '/api/auth/login') return json({ user: ACCOUNT });
    if (path === '/api/titles') return json({ titles: [] });
    if (path === '/api/notifications') return json({ notifications: [], unread: 0 });
    if (path === '/api/settings') {
      return json({ autoReturnNotifications: true, returnAfterDays: 30 });
    }
    if (path === '/api/watchlist') return json({ items: [] });
    return json({});
  };

  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    });
  }
  window.scrollTo = () => {};

  try {
    window.eval(bundle);
  } catch (e) {
    errors.push(e.message);
  }

  await new Promise((r) => setTimeout(r, 500));

  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
    // Must be this window's Event, not the Node global.
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  setValue(doc.querySelector('#email'), ACCOUNT.email);
  setValue(doc.querySelector('#password'), 'justine21!');
  doc.querySelector('form').requestSubmit();

  await new Promise((r) => setTimeout(r, 500));

  const banner = doc.querySelector('[role="status"]');
  const text = (banner?.textContent || '').replace(/\s+/g, ' ').trim();

  window.close();

  if (errors.length) {
    console.log('FAIL greeting  runtime errors');
    for (const e of errors.slice(0, 2)) console.log(`     ${e.split('\n')[0]}`);
    return 1;
  }
  if (!/Welcome back, justinezantoz01/.test(text)) {
    console.log(`FAIL greeting  expected "Welcome back, justinezantoz01", got: ${text || '(no banner)'}`);
    return 1;
  }
  console.log(`ok   greeting renders after sign-in: "${text}"`);
  return 0;
}

total += await checkGreeting();

console.log(total === 0 ? '\nAll staff tabs rendered.' : `\n${total} tab render(s) failed.`);
process.exit(total === 0 ? 0 : 1);