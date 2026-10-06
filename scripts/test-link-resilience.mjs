/**
 * Fragment links, and the upload playability check.
 *
 * Run: node scripts/test-link-resilience.mjs
 *
 * The zone still 307s every non-asset path to "/", so an emailed link carrying its
 * token in the query string arrives with the token discarded and does nothing.
 * The fix is to put the route in the URL fragment, which is never sent to the
 * server, so the request is for "/" -- a path that works.
 */
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../worker/api.js', import.meta.url), 'utf8');
const hashRoutes = readFileSync(
  new URL('../src/components/HashRoutes.jsx', import.meta.url),
  'utf8',
);
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const uploader = readFileSync(
  new URL('../src/components/VideoUploader.jsx', import.meta.url),
  'utf8',
);

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

// ------------------------------------------------------- fragment links

check('the verification link uses a fragment', /\}\/#\/verify-email\?token=/.test(api));
check('the reset link uses a fragment', /\}\/#\/reset-password\?token=/.test(api));

// And nothing generated still uses the query form, which the redirect eats.
const queryLinks = [...api.matchAll(/\}\/(verify-email|reset-password)\?token=/g)];
check(
  'no emailed link still uses the query form',
  queryLinks.length === 0,
  queryLinks.map((m) => m[1]).join(', '),
);

check('the resolver is mounted', /<HashRoutes \/>/.test(app));
check('it reads a fragment', /location\.hash/.test(hashRoutes));
check('it only handles the #/ form', /hash\[1\] !== '\/'/.test(hashRoutes));
check('an ordinary anchor is left alone', /#\/something/.test(hashRoutes));
check('it replaces rather than pushes', /navigate\(target, \{ replace: true \}\)/.test(hashRoutes));

// ------------------------------------------------- upload playability check

check('a picked file is probed before uploading', /probePlayable\(file\)/.test(uploader));
// Scoped to onPick. Searching the whole file for "send(file)" also matches the
// xhr.send(file) inside the uploader itself, which is nowhere near the decision.
{
  const onPick = uploader.slice(
    uploader.indexOf('const onPick'),
    uploader.indexOf('const onCancel'),
  );
  const probeAt = onPick.indexOf('await probePlayable');
  const sendAt = onPick.search(/(?<!\.)\bsend\(file\)/);
  check(
    'the probe runs before the upload starts',
    probeAt !== -1 && sendAt !== -1 && probeAt < sendAt,
    `probe at ${probeAt}, send at ${sendAt}`,
  );
  check('an unplayable file returns before sending', /return;/.test(onPick.slice(probeAt, sendAt)));
}
check('an unplayable file is refused with advice', /cannot play that file/.test(uploader));
check('the refusal names a format that works', /H\.264 MP4 or VP9 WebM/.test(uploader));
check(
  'a probe that never answers does not block the upload',
  /setTimeout\(\(\) => finish\(true\), 3000\)/.test(uploader),
);
check(
  'a thrown probe falls through to uploading',
  /catch \{\s*\n\s*playable = true;/.test(uploader),
);
check('the limit is stated in the UI', /no re-encoding/.test(uploader));

console.log('');
if (failed) {
  console.log(`${failed} resilience check(s) failed.`);
  process.exit(1);
}
console.log('Links survive the redirect, and unsupported uploads are caught early.');