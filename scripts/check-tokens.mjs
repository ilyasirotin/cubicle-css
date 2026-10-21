// Cubicle token integrity check. Development tool only; not part of the shipped kit.
//
// Setup:          none (Node built-ins only).
// Run:            node scripts/check-tokens.mjs [docs/index.html] [--css dist/cubicle.css]
// Convention:     inside any <tr> of the catalogue, a <code> whose whole text is a token name
//                 (--cb-name) documents that token; the next <code> in the same row, if any,
//                 is its documented value. Rows without a value cell count for presence only.
// Checks:         1. every token declared in @layer tokens is documented in the catalogue;
//                 2. every documented token exists in the stylesheet;
//                 3. every documented value equals the declared value (whitespace-normalised);
//                 4. every var(--cb-*) used in the stylesheet and docs/docs.css is declared;
//                 5. density blocks ([data-cb-density]) only redefine tokens that :root declares;
//                 6. CSS system colour keywords (Canvas, Highlight, GrayText...) appear only
//                    inside @media (forced-colors: active).
//                 Default values are read from the :root block of @layer tokens.
// Exit code:      0 when every check passes, 1 otherwise.

import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cssFlag = args.indexOf('--css');
const cssFile = resolve(root, cssFlag >= 0 ? args.splice(cssFlag, 2)[1] ?? '' : 'dist/cubicle.css');
const docsFile = resolve(root, args[0] ?? 'docs/index.html');
const docsCssFile = resolve(root, 'docs/docs.css');

const results = [];
const check = (ok, name, detail = '') => results.push({ ok, name, detail });

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const unescape = (s) => s
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
  .replaceAll('&amp;', '&');
const same = (a, b) => (/^#[0-9a-f]+$/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b);

// 0. Declared tokens: the body of @layer tokens { ... }.
const css = stripComments(readFileSync(cssFile, 'utf8'));
const declared = new Map();
const overrides = [];
const layerAt = css.search(/@layer\s+tokens\s*\{/);
if (layerAt < 0) {
  check(false, '@layer tokens block found', relative(root, cssFile));
} else {
  const open = css.indexOf('{', layerAt);
  let depth = 0, end = open;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    if (css[end] === '}' && --depth === 0) break;
  }
  // Defaults come from the :root block; other blocks (density modes) may only redefine
  // tokens that :root declares.
  const body = css.slice(open + 1, end);
  for (const [, selector, block] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const pairs = [...block.matchAll(/(--cb-[a-z0-9-]+)\s*:\s*([^;]+);/g)];
    if (selector.trim() === ':root') pairs.forEach(([, name, value]) => declared.set(name, squash(value)));
    else overrides.push([selector.trim(), pairs.map(([, name]) => name)]);
  }
}

// Documented tokens: name -> every value written for it (a token may appear in several tables).
const documented = new Map();
for (const [, row] of readFileSync(docsFile, 'utf8').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
  const codes = [...row.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].map((m) => squash(unescape(m[1])));
  codes.forEach((text, i) => {
    if (!/^--cb-[a-z0-9-]+$/.test(text)) return;
    const next = codes[i + 1];
    const values = documented.get(text) ?? [];
    if (next !== undefined && !/^--cb-[a-z0-9-]+$/.test(next)) values.push(next);
    documented.set(text, values);
  });
}

// 1. Declared -> documented
const undocumented = [...declared.keys()].filter((n) => !documented.has(n));
for (const n of undocumented) check(false, `${n} is documented in the catalogue`);
if (declared.size && !undocumented.length) check(true, `all ${declared.size} declared tokens are documented`);

// 2. Documented -> declared
const stale = [...documented.keys()].filter((n) => !declared.has(n));
for (const n of stale) check(false, `documented ${n} exists in the stylesheet`);
if (documented.size && !stale.length) check(true, `all ${documented.size} documented tokens exist in the stylesheet`);

// 3. Documented values
let compared = 0;
for (const [n, values] of documented) {
  if (!declared.has(n)) continue;
  for (const value of values) {
    compared++;
    if (!same(value, declared.get(n))) check(false, `${n} value in the catalogue matches the stylesheet`, `docs ${JSON.stringify(value)} vs css ${JSON.stringify(declared.get(n))}`);
  }
}
if (compared && !results.some((r) => !r.ok && r.name.endsWith('matches the stylesheet'))) {
  check(true, `all ${compared} documented values match the stylesheet`);
}

// 4. var() references
for (const file of [cssFile, docsCssFile]) {
  const refs = new Set([...stripComments(readFileSync(file, 'utf8')).matchAll(/var\(\s*(--cb-[a-z0-9-]+)/g)].map((m) => m[1]));
  const unknown = [...refs].filter((n) => !declared.has(n));
  for (const n of unknown) check(false, `var(${n}) in ${relative(root, file)} is declared`);
  if (!unknown.length) check(true, `all ${refs.size} var(--cb-*) references in ${relative(root, file)} are declared`);
}

// 5. Density blocks redefine declared tokens only
for (const [selector, names] of overrides) {
  const unknown = names.filter((n) => !declared.has(n));
  check(unknown.length === 0, `${selector} redefines declared tokens only`, unknown.join(', ') || `${names.length} tokens`);
}

// 6. System colours only in forced-colours blocks (AGENTS.md section 6): they are the user's
//    theme there, and hard-coded colours anywhere else.
const SYSTEM = /(?<![\w-])(Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText)(?![\w-])/i;
{
  const text = css.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const stack = []; let start = 0; const misplaced = []; let inside = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { stack.push(text.slice(start, i).trim()); start = i + 1; }
    else if (ch === '}' || ch === ';') {
      const chunk = text.slice(start, i).trim(); start = i + 1;
      const colon = chunk.indexOf(':');
      if (stack.length && colon > 0 && !chunk.startsWith('@') && SYSTEM.test(chunk.slice(colon + 1))) {
        if (stack.some((p) => /^@media\b[^{]*forced-colors\s*:\s*active/i.test(p))) inside++;
        else misplaced.push(`${stack.at(-1).slice(0, 50)} { ${chunk.slice(0, 60)} }`);
      }
      if (ch === '}') stack.pop();
    }
  }
  check(!misplaced.length, 'system colour keywords appear only inside @media (forced-colors: active)', misplaced.slice(0, 3).join(' | ') || `${inside} declarations`);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Files: ${relative(root, cssFile)}, ${relative(root, docsFile)}`);
process.exit(failed.length ? 1 : 0);
