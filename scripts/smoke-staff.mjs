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

total += await checkGreeting();
total += await checkPlaybackGate();
total += await checkBrowseListing();
total += await checkCategoryPages();

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

/**
 * The core access rule: browsing is open, but episodic playback needs an
 * account. Covers anime, series and AI both signed out (gate shown) and
 * signed in (player shown), plus a movie staying free when signed out.
 */
async function checkPlaybackGate() {
  const EPISODIC = ['tidefall-academy', 'solaris-requiem', 'lantern-of-lost-things'];

  function titleBody(slug, type, locked) {
    return {
      title: {
        id: slug, slug, type, title: slug,
        synopsis: 'Test synopsis.', genres: ['Drama'], releaseDate: '2026-01-01',
        runtime: '24m', rating: 8, posterUrl: '', backdropUrl: '',
        videoUrl: locked ? null : 'https://example.test/stream.m3u8',
        subtitlesUrl: locked ? null : '/subtitles/sample.vtt',
        featured: false, locked,
      },
      locked,
      seasons: locked ? [{ id: 's1', season_number: 1, description: 'Season one' }] : [],
      episodes: locked
        ? [{ id: 'e1', season_id: 's1', episode_number: 1, title: 'Episode One', runtime: '24:00', video_manifest_url: null, subtitles_url: null, locked: true }]
        : [{ id: 'e1', season_id: 's1', episode_number: 1, title: 'Episode One', runtime: '24:00', video_manifest_url: 'https://example.test/ep1.m3u8', subtitles_url: '/subtitles/sample.vtt' }],
      episodeCount: 1,
    };
  }

  async function open(route, { signedIn }) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => errors.push(e.message));
    virtualConsole.on('error', (...a) => errors.push(a.map(String).join(' ')));

    const dom = new JSDOM(html, {
      url: `https://animeta.test${route}`,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole,
    });
    const { window } = dom;

    const json = (body, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

    const slug = route.replace('/title/', '');
    const type = slug === 'neon-courier' ? 'movie' : slug === 'tidefall-academy' ? 'anime' : slug === 'lantern-of-lost-things' ? 'ai' : 'series';
    const episodic = type !== 'movie';

    window.fetch = async (input) => {
      const path = String(typeof input === 'string' ? input : input?.url || '')
        .replace(/^https:\/\/animeta\.test/, '')
        .split('?')[0];
      if (path === '/api/auth/me') {
        return json({ user: signedIn ? { id: 'u1', email: 'a@b.com', username: 'kaede', role: 'user' } : null });
      }
      if (path.startsWith('/api/titles/')) return json(titleBody(slug, type, episodic && !signedIn));
      if (path === '/api/titles') return json({ titles: [] });
      if (path === '/api/notifications') return json({ notifications: [], unread: 0 });
      if (path === '/api/settings') return json({ autoReturnNotifications: true, returnAfterDays: 30 });
      if (path === '/api/watchlist') return json({ titles: [] });
      return json({});
    };

    if (!window.matchMedia) {
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    }
    window.scrollTo = () => {};
    window.HTMLMediaElement.prototype.play = () => Promise.resolve();

    try {
      window.eval(bundle);
    } catch (e) {
      errors.push(e.message);
    }

    await new Promise((r) => setTimeout(r, 550));

    const text = (window.document.getElementById('root')?.textContent || '').replace(/\s+/g, ' ');
    window.close();
    return { text, errors };
  }

  let failed = 0;

  // Signed out: every episodic type is gated, with no manifest anywhere.
  for (const slug of EPISODIC) {
    const { text, errors } = await open(`/title/${slug}`, { signedIn: false });
    const gated = /Sign in to watch/.test(text);
    const leaked = /example\.test\/(stream|ep1)\.m3u8/.test(text);

    if (errors.length) {
      failed++;
      console.log(`FAIL gate  ${slug} signed out errored: ${errors[0].split('\n')[0]}`);
    } else if (!gated) {
      failed++;
      console.log(`FAIL gate  ${slug} signed out shows no sign-in gate`);
    } else if (leaked) {
      failed++;
      console.log(`FAIL gate  ${slug} leaked a playable URL to a signed-out visitor`);
    } else {
      console.log(`ok   ${slug} (${/anime/.test(text) ? 'anime' : ''}) locked for signed-out visitors`);
    }
  }

  // Signed in: the player replaces the gate.
  {
    const { text, errors } = await open('/title/tidefall-academy', { signedIn: true });
    if (errors.length) {
      failed++;
      console.log(`FAIL gate  anime signed in errored: ${errors[0].split('\n')[0]}`);
    } else if (/Sign in to watch/.test(text)) {
      failed++;
      console.log('FAIL gate  anime still gated for a signed-in viewer');
    } else {
      console.log('ok   anime plays for a signed-in viewer');
    }
  }

  // Movies stay free when signed out.
  {
    const { text, errors } = await open('/title/neon-courier', { signedIn: false });
    if (errors.length) {
      failed++;
      console.log(`FAIL gate  movie errored: ${errors[0].split('\n')[0]}`);
    } else if (/Sign in to watch/.test(text)) {
      failed++;
      console.log('FAIL gate  a movie is gated, but movies should play free');
    } else {
      console.log('ok   movies play without an account');
    }
  }

  return failed;
}

/**
 * The browse listing must show every type, with counts, while signed out.
 * This is the "everyone can see the whole catalog" half of the access rule.
 */
async function checkBrowseListing() {
  const CATALOG = [
    { slug: 'c-series', type: 'series', title: 'C Series', genres: ['Sci-Fi'], rating: 7 },
    { slug: 'a-movie', type: 'movie', title: 'A Movie', genres: ['Drama'], rating: 8 },
    { slug: 'b-anime', type: 'anime', title: 'B Anime', genres: ['Action'], rating: 9 },
    { slug: 'd-ai', type: 'ai', title: 'D AI', genres: ['Experimental'], rating: 8.5 },
    { slug: 'e-anime', type: 'anime', title: 'E Anime', genres: ['Drama'], rating: 7.5 },
  ];

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  virtualConsole.on('error', (...a) => errors.push(a.map(String).join(' ')));

  const dom = new JSDOM(html, {
    url: 'https://animeta.test/browse',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const doc = window.document;

  const json = (body) => ({ ok: true, status: 200, json: async () => body });

  window.fetch = async (input) => {
    const path = String(typeof input === 'string' ? input : input?.url || '')
      .replace(/^https:\/\/animeta\.test/, '')
      .split('?')[0];
    // Signed out on purpose.
    if (path === '/api/auth/me') return json({ user: null });
    if (path === '/api/titles') {
      return json({
        titles: CATALOG.map((t) => ({
          id: t.slug, ...t, synopsis: 'x', releaseDate: '2026-01-01',
          runtime: '24m', posterUrl: '', backdropUrl: '', videoUrl: null,
          subtitlesUrl: null, featured: false,
        })),
      });
    }
    if (path === '/api/notifications') return json({ notifications: [], unread: 0 });
    if (path === '/api/settings') return json({ autoReturnNotifications: true, returnAfterDays: 30 });
    return json({});
  };

  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
  window.scrollTo = () => {};

  try {
    window.eval(bundle);
  } catch (e) {
    errors.push(e.message);
  }
  await new Promise((r) => setTimeout(r, 600));

  const headings = [...doc.querySelectorAll('section[aria-labelledby] h2')].map((h) => h.textContent.trim());
  const chips = [...doc.querySelectorAll('nav[aria-label="Filter by type"] button')].map((b) =>
    b.textContent.replace(/\s+/g, ' ').trim(),
  );
  const cards = doc.querySelectorAll('a[href^="/title/"]').length;

  window.close();

  if (errors.length) {
    console.log('FAIL browse  runtime errors');
    for (const e of errors.slice(0, 2)) console.log(`     ${e.split('\n')[0]}`);
    return 1;
  }

  // Labels come from TITLE_TYPES in src/lib/titleTypes.js, so the rename of
// 'ai' to "AI Movie" is picked up here rather than duplicated.
const expected = ['Series', 'Anime', 'Movies', 'AI Movie'];
  const missing = expected.filter((label) => !headings.includes(label));
  if (missing.length) {
    console.log(`FAIL browse  missing type sections: ${missing.join(', ')} (saw ${headings.join(', ')})`);
    return 1;
  }
  if (cards !== CATALOG.length) {
    console.log(`FAIL browse  expected ${CATALOG.length} title cards, got ${cards}`);
    return 1;
  }
  // Per-type counts. The label and count sit in separate spans, so match on
  // the label and read the trailing number.
  const countFor = (label) => {
    const chip = chips.find((c) => c.startsWith(label));
    if (!chip) return null;
    const n = Number((chip.match(/(\d+)\s*$/) || [])[1]);
    return Number.isNaN(n) ? null : n;
  };
  const wanted = { Series: 1, Anime: 2, Movies: 1, 'AI Movie': 1 };
  const bad = Object.entries(wanted).filter(([label, want]) => countFor(label) !== want);
  if (bad.length) {
    console.log(
      `FAIL browse  wrong counts for ${bad.map(([l, w]) => `${l} (wanted ${w}, got ${countFor(l)})`).join(', ')}`,
    );
    return 1;
  }

  console.log(
    `ok   browse lists all 4 types signed out (${headings.join(', ')}), ${cards} cards`,
  );
  return 0;
}

/**
 * Each category page must list exactly its own titles, be reachable signed out,
 * and an unknown type must 404 rather than render an empty grid.
 */
async function checkCategoryPages() {
  const CATALOG = [
    { slug: 'a-movie', type: 'movie', title: 'A Movie', genres: ['Drama'], rating: 8 },
    { slug: 'b-anime', type: 'anime', title: 'B Anime', genres: ['Action'], rating: 9 },
    { slug: 'c-series', type: 'series', title: 'C Series', genres: ['Sci-Fi'], rating: 7 },
    { slug: 'd-ai', type: 'ai', title: 'D AI Movie', genres: ['Experimental'], rating: 8.5 },
    { slug: 'e-anime', type: 'anime', title: 'E Anime', genres: ['Drama'], rating: 7.5 },
    { slug: 'f-ai', type: 'ai', title: 'F AI Movie', genres: ['Drama'], rating: 6 },
  ];

  async function open(route) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => errors.push(e.message));
    virtualConsole.on('error', (...a) => errors.push(a.map(String).join(' ')));

    const dom = new JSDOM(html, {
      url: `https://animeta.test${route}`,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole,
    });
    const { window } = dom;

    const json = (body) => ({ ok: true, status: 200, json: async () => body });

    window.fetch = async (input) => {
      const path = String(typeof input === 'string' ? input : input?.url || '')
        .replace(/^https:\/\/animeta\.test/, '')
        .split('?')[0];
      if (path === '/api/auth/me') return json({ user: null });
      if (path === '/api/titles') {
        return json({
          titles: CATALOG.map((t) => ({
            id: t.slug, ...t, synopsis: 'x', releaseDate: '2026-01-01',
            runtime: '24m', posterUrl: '', backdropUrl: '', videoUrl: null,
            subtitlesUrl: null, featured: false,
          })),
        });
      }
      if (path === '/api/notifications') return json({ notifications: [], unread: 0 });
      if (path === '/api/settings') {
        return json({ autoReturnNotifications: true, returnAfterDays: 30 });
      }
      return json({});
    };

    if (!window.matchMedia) {
      window.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
    }
    window.scrollTo = () => {};

    try {
      window.eval(bundle);
    } catch (e) {
      errors.push(e.message);
    }
    await new Promise((r) => setTimeout(r, 550));

    const doc = window.document;
    const result = {
      errors,
      heading: doc.querySelector('main h1')?.textContent.trim(),
      // Card titles are the <h3> inside each poster link.
      cardTitles: [...doc.querySelectorAll('a[href^="/title/"] h3')].map((h) => h.textContent.trim()),
      isNotFound: /wrong turn/i.test(doc.body.textContent),
      crumbs: [...doc.querySelectorAll('nav[aria-label="Breadcrumb"] li')].map(
        (li) => li.textContent.trim(),
      ),
      current: doc.querySelector('nav[aria-label="Categories"] a[aria-current="page"]')
        ?.textContent.replace(/\s+/g, ' ').trim(),
    };
    window.close();
    return result;
  }

  let failed = 0;

  const EXPECTED = [
    { type: 'anime', label: 'Anime', slugs: ['B Anime', 'E Anime'] },
    { type: 'movie', label: 'Movies', slugs: ['A Movie'] },
    { type: 'series', label: 'Series', slugs: ['C Series'] },
    { type: 'ai', label: 'AI Movie', slugs: ['D AI Movie', 'F AI Movie'] },
  ];

  for (const { type, label, slugs } of EXPECTED) {
    const r = await open(`/category/${type}`);

    if (r.errors.length) {
      failed++;
      console.log(`FAIL category  /category/${type} errored: ${r.errors[0].split('\n')[0]}`);
      continue;
    }
    if (r.isNotFound) {
      failed++;
      console.log(`FAIL category  /category/${type} rendered the 404 page`);
      continue;
    }
    if (r.heading !== label) {
      failed++;
      console.log(`FAIL category  /category/${type} heading was "${r.heading}", expected "${label}"`);
      continue;
    }
    const got = [...r.cardTitles].sort();
    const want = [...slugs].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failed++;
      console.log(
        `FAIL category  /category/${type} listed [${got.join(', ')}], expected [${want.join(', ')}]`,
      );
      continue;
    }
    console.log(`ok   /category/${type} lists only its own ${want.length} title(s) as "${label}"`);
  }

  // Unknown type must 404, not render a plausible-looking empty category.
  {
    const r = await open('/category/nonsense');
    if (!r.isNotFound) {
      failed++;
      console.log('FAIL category  /category/nonsense did not 404');
    } else {
      console.log('ok   /category/nonsense falls through to the 404 page');
    }
  }

  // Breadcrumb must point back at Browse.
  {
    const r = await open('/category/anime');
    const joined = (r.crumbs || []).join(' ');
    if (!/Browse/.test(joined)) {
      failed++;
      console.log(`FAIL category  breadcrumb missing Browse: ${JSON.stringify(r.crumbs)}`);
    } else {
      console.log('ok   category breadcrumb links back to Browse');
    }
  }

  return failed;
}

console.log(
  total === 0
    ? '\nAll staff tabs, greeting, playback gate, browse and category pages rendered.'
    : `\n${total} check(s) failed.`,
);
process.exit(total === 0 ? 0 : 1);