// Catches identifiers used but never imported/defined at module scope.
// Vite does not error on these, so they only blow up at runtime as a blank page.
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

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p;
  });
}

const files = walk(SRC).filter((f) => /\.jsx?$/.test(f));
let problems = 0;

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');

  const importBlock = [...code.matchAll(/import\s+(?:[\s\S]*?)\s+from\s+['"][^'"]+['"]/g)]
    .map((m) => m[0])
    .join('\n');

  const imported = new Set();
  for (const m of importBlock.matchAll(/\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) imported.add(name);
    }
  }
  for (const m of importBlock.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) imported.add(m[1]);
  // `import * as X from` and default imports
  for (const m of importBlock.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) imported.add(m[1]);

  const body = code.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '');

  for (const hook of REACT_HOOKS) {
    const used = new RegExp(`(?<![\\w.$])${hook}\\s*\\(`).test(body);
    if (!used) continue;
    if (imported.has(hook)) continue;
    // Declared locally? (rare, but avoid false positives)
    if (new RegExp(`(function|const|let|var)\\s+${hook}\\b`).test(body)) continue;

    problems++;
    console.log(
      `MISSING IMPORT  ${rel}  uses ${hook}()` +
        (ROUTER_HOOKS.has(hook) ? '  <- must come from react-router-dom' : ''),
    );
  }
}

console.log(problems === 0 ? '\nOK: no missing hook imports found.' : `\n${problems} problem(s) found.`);
process.exit(problems === 0 ? 0 : 1);