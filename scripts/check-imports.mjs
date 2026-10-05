// Catches identifiers used but never imported or defined in the module.
// Vite does not error on these, so they only blow up at runtime as a blank page.
//
// The first version of this only checked React hooks, which meant a component
// referencing an undefined `INPUT` in `className={INPUT}` passed cleanly while
// the whole panel rendered nothing. It now also covers module-scope constants.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\//, '');
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '');

const REACT_HOOKS = [
  'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext',
  'useReducer', 'useLayoutEffect', 'useId', 'useNavigate', 'useParams',
  'useLocation', 'useSearchParams',
];

const ROUTER_HOOKS = new Set(['useNavigate', 'useParams', 'useLocation', 'useSearchParams']);

// Real globals that can appear in an expression. All-caps identifiers are the
// only ones this script cares about, so the list stays short on purpose.
const GLOBALS = new Set(['JSON', 'URL', 'NAN', 'INFINITY']);

// Units appear as bare identifiers in formatting helpers (timeAgo.js) rather
// than string keys, so they cannot be distinguished from a missing constant.
const UNIT_NAMES = new Set([
  'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR',
]);

/**
 * Blanks out everything that cannot contain a real identifier reference:
 * comments, strings, template literals and JSX text.
 *
 * Without this, prose gets mistaken for undefined constants - "AI film",
 * "ANI META", "PBKDF2" and the HLS note in the footer all read as code.
 *
 * Newlines are preserved so reported line numbers match the real file.
 */
function stripNonCode(code) {
  // Blanks a match but keeps its newlines, so reported lines stay accurate.
  const blank = (s) => s.replace(/[^\n]/g, ' ');

  // Strings first: a URL inside a string would otherwise look like the start
  // of a line comment.
  const patterns = [
    /`(?:\\[\s\S]|[^`\\])*`/g,
    /'(?:\\[\s\S]|[^'\\\n])*'/g,
    /"(?:\\[\s\S]|[^"\\\n])*"/g,
    /\/\*[\s\S]*?\*\//g,
    /\/\/[^\n]*/g,
    /<!--[\s\S]*?-->/g,
  ];

  const stripped = patterns.reduce((acc, re) => acc.replace(re, blank), code);

  // JSX text, including runs that wrap across lines. Braces are excluded so
  // expressions inside attributes survive. Only the inner group is blanked.
  return stripped.replace(/>([^<>{}]+)</g, (m, inner) => blank(inner));
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p;
  });
}

const files = walk(SRC).filter((f) => /\.jsx?$/.test(f));
let problems = 0;

/** Names bound anywhere in the module: imports, top-level and nested bindings. */
function collectBoundNames(code) {
  const bound = new Set();

  const importBlock = [...code.matchAll(/import\s+(?:[\s\S]*?)\s+from\s+['"][^'"]+['"]/g)]
    .map((m) => m[0])
    .join('\n');

  for (const m of importBlock.matchAll(/\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) bound.add(name);
    }
  }
  for (const m of importBlock.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) bound.add(m[1]);
  for (const m of importBlock.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);

  // Declarations at any depth, plus destructuring targets and function params.
  for (const m of code.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    bound.add(m[1]);
  }
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s*:\s*/).pop()?.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name || '')) bound.add(name);
    }
  }
  for (const m of code.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
    }
  }
  for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);

  return bound;
}

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const body = stripNonCode(code.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, ''));
  const bound = collectBoundNames(code);

  // --- Missing React hooks -------------------------------------------------
  for (const hook of REACT_HOOKS) {
    const used = new RegExp(`(?<![\\w.$])${hook}\\s*\\(`).test(body);
    if (!used || bound.has(hook)) continue;

    problems++;
    console.log(
      `MISSING IMPORT  ${rel}  uses ${hook}()` +
        (ROUTER_HOOKS.has(hook) ? '  <- must come from react-router-dom' : ''),
    );
  }

  // --- Undefined module constants -----------------------------------------
  // All-caps names are treated as module constants: the one that broke the
  // Users panel (INPUT) plus every style and label table in the tree.
  for (const m of body.matchAll(/(?<![.\w$])([A-Z][A-Z0-9]*)\b/g)) {
    const name = m[1];
    if (bound.has(name) || GLOBALS.has(name) || UNIT_NAMES.has(name)) continue;
    // Two-letter fragments are almost always prose in JSX text ("AI film").
    if (name.length < 3) continue;

    problems++;
    const line = body.slice(0, m.index).split('\n').length;
    console.log(`UNDEFINED      ${rel}:${line}  uses ${name} but never defines or imports it`);
  }
}

console.log(
  problems === 0
    ? `\nOK: ${files.length} file(s) checked, no undefined identifiers.`
    : `\n${problems} problem(s) found.`,
);
process.exit(problems === 0 ? 0 : 1);