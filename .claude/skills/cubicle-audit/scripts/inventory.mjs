// Inventory of what Cubicle ships against what it documents, for the whole-framework audit.
// Reads dist/cubicle.css, dist/cubicle.js, docs/index.html, docs/example.html and README.md and
// prints:
//   1. every cb-* class the stylesheet defines, with its use in the catalogue's live markup,
//      the example console and the README, and whether a component root is in the CSS ToC;
//   2. every state the stylesheet styles on a cb-* class ([disabled], [aria-busy="true"],
//      :checked, ...) and whether some catalogue demo carries that class with that state;
//   3. every data-cb-* hook cubicle.js reads, with its use in the catalogue, example and README.
//
// Run from the repository root:
//   node .claude/skills/cubicle-audit/scripts/inventory.mjs           leads only
//   node .claude/skills/cubicle-audit/scripts/inventory.mjs --full    every row
//
// Live markup means real tags; the escaped <pre><code> snippets are not counted. Hover, focus
// and active are left to verify-browser check 7, and runtime-only states (:user-invalid,
// :popover-open, :target, ...) cannot be read from static markup, so neither is listed.
// Every line is a lead, not a verdict: open the selector and the catalogue section before
// reporting it. Exit code 0 always.

import { readFileSync } from 'node:fs';

const full = process.argv.includes('--full');
const read = (f) => readFileSync(f, 'utf8');
const css = read('dist/cubicle.css');
const js = read('dist/cubicle.js');
const pages = { index: read('docs/index.html'), example: read('docs/example.html') };
const readme = read('README.md');

// --- Live markup -------------------------------------------------------------------
// Tags with their attributes. Snippets are escaped (&lt;), so they never match.
function elements(html) {
  const out = [];
  for (const tag of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of tag[2].matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    out.push({ tag: tag[1], attrs, classes: (attrs.class ?? '').split(/\s+/).filter(Boolean) });
  }
  return out;
}
const live = Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, elements(v)]));
const classCount = (els, c) => els.filter((e) => e.classes.includes(c)).length;

// --- Stylesheet --------------------------------------------------------------------
// Comments blanked (newlines kept, so offsets give line numbers).
const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const lineAt = (i) => css.slice(0, i).split('\n').length;
const toc = (css.match(/Table of Contents[\s\S]*?\*\//) ?? [''])[0];

const splitTop = (s, sep) => {
  const parts = []; let depth = 0, cur = '';
  for (const ch of s) {
    if ('([' .includes(ch)) depth++;
    if (')]'.includes(ch)) depth--;
    if (depth === 0 && sep.test(ch)) { parts.push(cur); cur = ''; } else cur += ch;
  }
  return [...parts, cur].map((p) => p.trim()).filter(Boolean);
};
// The argument of a functional pseudo-class that opens at `at` (index of its "(").
const argAt = (s, at) => {
  let depth = 0, j = at;
  for (; j < s.length; j++) { if (s[j] === '(') depth++; if (s[j] === ')' && --depth === 0) break; }
  return { arg: s.slice(at + 1, j), end: j + 1 };
};
// :not(...) negates and :has(...) is about a descendant, so neither names a state of the element.
const dropNotHas = (s) => {
  let out = '', i = 0;
  while (i < s.length) {
    const m = /^:(not|has)\(/.exec(s.slice(i));
    if (m) i = argAt(s, i + m[0].length - 1).end; else out += s[i++];
  }
  return out;
};
// :is(a, b) and :where(a, b) are alternatives: one selector per alternative.
const expand = (s) => {
  const m = /:(is|where)\(/.exec(s);
  if (!m) return [s];
  const { arg, end } = argAt(s, m.index + m[0].length - 1);
  return splitTop(arg, /,/).flatMap((alt) => expand(s.slice(0, m.index) + alt + s.slice(end))).slice(0, 500);
};

// Rules with their selectors resolved through nesting.
const rules = [];
{
  const stack = []; let buf = '', start = 0, quote = null;
  for (let i = 0; i < bare.length; i++) {
    const ch = bare[i];
    if (quote) { buf += ch; if (ch === quote && bare[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '{') {
      const prelude = buf.trim(); buf = '';
      if (prelude.startsWith('@')) { stack.push({ at: true }); continue; }
      const parent = [...stack].reverse().find((s) => !s.at);
      const own = splitTop(prelude, /,/);
      const selectors = parent
        ? parent.selectors.flatMap((p) => own.map((s) => (s.includes('&') ? s.replaceAll('&', p) : `${p} ${s}`)))
        : own;
      stack.push({ selectors });
      rules.push({ selectors, line: lineAt(start + (bare.slice(start).search(/\S/))) });
      start = i + 1;
      continue;
    }
    if (ch === ';' || ch === '}') { if (ch === '}') stack.pop(); buf = ''; start = i + 1; continue; }
    buf += ch;
  }
}

const defined = new Set();
for (const r of rules) for (const s of r.selectors) for (const m of s.matchAll(/\.(cb-[\w-]+)/g)) defined.add(m[1]);

// States: an attribute or pseudo-class in the same compound as one or more cb-* classes.
const PSEUDO = { checked: 'checked', disabled: 'disabled', 'read-only': 'readonly' };
const STATE_ATTR = /^(aria-[a-z]+|data-cb-[a-z-]+|disabled|readonly|open|required|multiple|checked|selected|hidden|inert|popover|start|reversed)$/;
const states = new Map();
for (const r of rules) {
  for (const s of r.selectors.flatMap((sel) => expand(dropNotHas(sel)))) {
    for (const compound of splitTop(s, /[\s>+~]/)) {
      const classes = [...new Set([...compound.matchAll(/\.(cb-[\w-]+)/g)].map((m) => m[1]))];
      if (!classes.length) continue;
      // Element types, wherever :is() / :where() expansion put them (".cb-select[readonly]input").
      const tags = [...compound.matchAll(/(?:^|[\])])([a-z][a-z0-9]*)(?=$|[.[:#])/g)].map((m) => m[1]);
      const found = [];
      for (const a of compound.matchAll(/\[\s*([a-z-]+)\s*(?:([~|^$*]?=)\s*["']?([^"'\]]*)["']?)?\s*\]/g)) {
        if (STATE_ATTR.test(a[1])) found.push({ attr: a[1], op: a[2] ?? null, value: a[3] ?? null });
      }
      for (const p of compound.matchAll(/:(checked|disabled|read-only)(?![\w-])/g)) found.push({ attr: PSEUDO[p[1]], op: null, value: null });
      for (const st of found) {
        const key = `${tags.join('|')}.${classes.join('.')}[${st.attr}${st.op ? `${st.op}"${st.value}"` : ''}]`;
        if (!states.has(key)) states.set(key, { classes, tags, ...st, line: r.line });
      }
    }
  }
}
const fits = (e, st) => st.classes.every((c) => e.classes.includes(c)) && (!st.tags.length || st.tags.includes(e.tag));
const carries = (e, st) => {
  if (!fits(e, st) || !(st.attr in e.attrs)) return false;
  const v = e.attrs[st.attr];
  switch (st.op) {
    case '=': return v === st.value;
    case '~=': return v.split(/\s+/).includes(st.value);
    case '^=': return v.startsWith(st.value);
    case '*=': return v.includes(st.value);
    default: return true;
  }
};

// --- Report ------------------------------------------------------------------------
const mentions = (text, name) => new RegExp(`${name.replace(/[-]/g, '\\-')}(?![\\w-])`).test(text);
// A root counts as named by one of its modifiers or elements (.cb-grid--2) or a wildcard (.cb-text-*).
const names = (text, root) => mentions(text, root) || text.includes(`${root}--`) || text.includes(`${root}__`) ||
  [...text.matchAll(/(cb-[\w-]*?)-?\*/g)].some((m) => root.startsWith(m[1]));
const pad = (s, n) => String(s).padEnd(n);

const classRows = [...defined].sort().map((c) => {
  const root = !c.includes('__') && !c.includes('--');
  return {
    c, root,
    index: classCount(live.index, c), example: classCount(live.example, c),
    readme: root ? names(readme, c) : mentions(readme, c), toc: root ? names(toc, c) : mentions(toc, `.${c}`),
  };
});
const undefinedUsed = Object.entries(live).flatMap(([page, els]) =>
  [...new Set(els.flatMap((e) => e.classes).filter((c) => c.startsWith('cb-') && !defined.has(c)))].map((c) => `${page}: ${c}`));

console.log('1. Classes (index / example = elements in live markup; readme, toc = mentioned)');
let leads = 0;
for (const r of classRows) {
  const notes = [];
  if (!r.index) notes.push('NOT IN CATALOGUE');
  if (r.root && !r.toc) notes.push('root not in CSS ToC');
  if (r.root && !r.readme) notes.push('root not in README');
  if (notes.length) leads++;
  if (full || notes.length) {
    console.log(`   ${pad(r.c, 30)} index ${pad(r.index, 4)} example ${pad(r.example, 4)} ${r.readme ? 'readme' : '      '} ${r.toc ? 'toc' : '   '}  ${notes.join('; ')}`);
  }
}
for (const u of undefinedUsed) { leads++; console.log(`   USED, NOT DEFINED in dist/cubicle.css  ${u}`); }
const inExample = classRows.filter((r) => r.root && r.example).length;
const roots = classRows.filter((r) => r.root).length;
console.log(`   ${classRows.length} classes (${roots} roots); ${classRows.filter((r) => r.index).length} in the catalogue; ${inExample}/${roots} roots on the example page\n`);

console.log('2. Styled states on cb-* classes, by catalogue demo');
const all = [...live.index, ...live.example];
const unreachable = [...states.values()].filter((st) => !all.some((e) => fits(e, st))).length;
const stateRows = [...states.entries()].filter(([, st]) => all.some((e) => fits(e, st))).sort(([a], [b]) => a.localeCompare(b)).map(([key, st]) => ({
  key, st, index: live.index.filter((e) => carries(e, st)).length, example: live.example.filter((e) => carries(e, st)).length,
}));
for (const r of stateRows) {
  if (!r.index) leads++;
  if (full || !r.index) console.log(`   ${pad(r.key, 58)} index ${pad(r.index, 4)} example ${pad(r.example, 4)} dist/cubicle.css:${r.st.line}${r.index ? '' : '  NO DEMO CARRIES IT'}`);
}
console.log(`   ${stateRows.length} class/state pairs; ${stateRows.filter((r) => r.index).length} shown in the catalogue; ${unreachable} more left out because no page puts the class on that element type`);
console.log('   (a pair may be set on an ancestor, by script or by the user: confirm each lead)\n');

console.log('3. cubicle.js hooks (data-cb-*)');
const hooks = [...new Set(js.match(/data-cb-[a-z-]+/g) ?? [])].sort();
for (const h of hooks) {
  const index = live.index.filter((e) => h in e.attrs).length;
  const example = live.example.filter((e) => h in e.attrs).length;
  const inReadme = mentions(readme, h);
  const notes = [];
  if (!index) notes.push('not in catalogue markup');
  if (!inReadme) notes.push('not in README');
  if (notes.length) leads++;
  if (full || notes.length) console.log(`   ${pad(h, 26)} index ${pad(index, 4)} example ${pad(example, 4)} ${inReadme ? 'readme' : '      '}  ${notes.join('; ')}`);
}
console.log(`   ${hooks.length} hooks\n`);
console.log(`${leads} leads. Hooks set by the script itself (data-cb-js, data-cb-copied) are expected to be absent from markup.`);
