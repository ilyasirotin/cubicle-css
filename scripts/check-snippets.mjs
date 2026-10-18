// Cubicle snippet integrity check. Development tool only; not part of the shipped kit.
//
// Setup:          none (Node built-ins only).
// Run:            node scripts/check-snippets.mjs [docs/index.html]
// Convention:     every <div class="docs-demo"> is followed directly by
//                 <pre class="docs-snippet"><code>...</code></pre> holding the same markup, escaped.
//                 Plain <pre><code> blocks without docs-snippet are free text and are not checked.
// Comparison:     source text, not the DOM. Leading/trailing blank lines and common
//                 indentation are removed from both sides; the rest must match byte for byte.
// Exit code:      0 when every check passes, 1 otherwise.

import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, process.argv[2] ?? 'docs/index.html');
const src = readFileSync(file, 'utf8');

const results = [];
const check = (ok, name, detail = '') => results.push({ ok, name, detail });
const lineAt = (i) => src.slice(0, i).split('\n').length;

const DEMO_OPEN = /<div\s[^>]*class="[^"]*\bdocs-demo\b[^"]*"[^>]*>/g;
const SNIPPET_OPEN = /<pre\s[^>]*class="[^"]*\bdocs-snippet\b[^"]*"[^>]*>\s*<code[^>]*>/g;

// Index just past the </div> that closes the <div> opened before `from`.
function closingDiv(from) {
  const tag = /<div[\s>]|<\/div>/g;
  tag.lastIndex = from;
  let depth = 1;
  for (let m; (m = tag.exec(src));) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return { inner: m.index, end: tag.lastIndex };
  }
  return null;
}

const unescape = (s) => s
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
  .replaceAll('&amp;', '&');

function normalize(s) {
  const lines = s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(indent).trimEnd()).join('\n');
}

const pairedSnippets = new Set();

for (const m of src.matchAll(DEMO_OPEN)) {
  const at = `line ${lineAt(m.index)}`;
  const close = closingDiv(m.index + m[0].length);
  if (!close) { check(false, `demo at ${at} is closed`, 'no matching </div>'); continue; }

  const live = src.slice(m.index + m[0].length, close.inner);
  check(!/\sstyle\s*=/.test(live), `demo at ${at} has no inline styles`);

  SNIPPET_OPEN.lastIndex = close.end;
  const s = SNIPPET_OPEN.exec(src);
  if (!s || src.slice(close.end, s.index).trim() !== '') {
    check(false, `demo at ${at} is followed by a docs-snippet`);
    continue;
  }
  pairedSnippets.add(s.index);

  const codeEnd = src.indexOf('</code>', s.index + s[0].length);
  const a = normalize(live).split('\n');
  const b = normalize(unescape(src.slice(s.index + s[0].length, codeEnd))).split('\n');
  const diff = a.findIndex((line, i) => line !== b[i]);
  const first = diff >= 0 ? diff : (a.length !== b.length ? Math.min(a.length, b.length) : -1);
  check(first < 0, `demo at ${at} matches its snippet`,
    first < 0 ? '' : `first difference at demo line ${first + 1}: ${JSON.stringify(a[first] ?? '')} vs ${JSON.stringify(b[first] ?? '')}`);
}

for (const s of src.matchAll(SNIPPET_OPEN)) {
  if (!pairedSnippets.has(s.index)) check(false, `snippet at line ${lineAt(s.index)} follows a docs-demo`);
}

if (results.length === 0) check(false, 'at least one docs-demo found', relative(root, file));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. File: ${relative(root, file)}`);
process.exit(failed.length ? 1 : 0);
