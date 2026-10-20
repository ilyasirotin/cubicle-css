// Scans the lines a change adds to dist/cubicle.css (and dist/cubicle.js) for the
// AGENTS.md rules that check-tokens, check-snippets and verify-browser do not cover:
// raw colours, shadows, radii and durations outside @layer tokens, !important, ID
// selectors, vendor prefixes, outline outside focus rules, blur, nesting deeper than two
// levels, custom property naming, self-referencing variables and remote resources.
//
// Run from the repository root:
//   node .claude/skills/cubicle-review/scripts/scan-diff.mjs          lines added since HEAD
//   node .claude/skills/cubicle-review/scripts/scan-diff.mjs --all    every line (calibration)
//
// "Added" means staged plus unstaged (git diff HEAD). Findings are leads, not verdicts:
// read each line before reporting it. Exit code 1 when anything is found.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const all = process.argv.includes('--all');
const findings = [];
const flag = (file, line, rule, text) => findings.push({ file, line, rule, text: text.trim().slice(0, 110) });

function addedLines(file) {
  if (all) return null;
  let diff = '';
  try { diff = execFileSync('git', ['diff', 'HEAD', '-U0', '--', file], { encoding: 'utf8' }); } catch { return new Set(); }
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = +m[1], count = m[2] === undefined ? 1 : +m[2];
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines;
}

// --- CSS ---------------------------------------------------------------------------
function scanCss(file) {
  if (!existsSync(file)) return;
  const added = addedLines(file);
  const isAdded = (n) => added === null || added.has(n);
  const src = readFileSync(file, 'utf8');
  const raw = src.split('\n');
  // Blank comments and strings, keeping offsets, so braces and colons inside them are ignored.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0]);

  const stack = []; // { at: boolean, layer: string|null, selector: string }
  let buf = '', bufStart = 1, line = 1;
  const layerOf = () => stack.findLast((b) => b.layer)?.layer ?? null;
  const styleDepth = () => stack.filter((b) => !b.at).length;
  const selectorChain = () => stack.filter((b) => !b.at).map((b) => b.selector).join(' ');

  const declaration = (text, at) => {
    const i = text.indexOf(':');
    if (i < 0 || styleDepth() === 0 && !stack.some((b) => b.at)) return;
    const prop = text.slice(0, i).trim(), value = text.slice(i + 1).trim();
    if (!prop || !isAdded(at)) return;
    const shown = raw[at - 1];
    const inTokens = layerOf() === 'tokens';
    const sel = selectorChain();

    if (/!important/i.test(value)) flag(file, at, '§6 no !important', shown);
    if (/^-(webkit|moz|ms|o)-/.test(prop)) flag(file, at, '§6 no vendor-prefixed properties', shown);
    if (/^outline(-|$)/.test(prop) && !/:focus/.test(sel)) flag(file, at, '§13 outline only in the focus indicator', shown);
    if (prop === 'backdrop-filter' || /blur\(/.test(value)) flag(file, at, '§5 no glassmorphism / blur', shown);
    if (/url\(\s*["']?(https?:)?\/\//.test(value)) flag(file, at, '§6 no remote resources', shown);

    if (prop.startsWith('--')) {
      if (!/^--(cb-|_)/.test(prop)) flag(file, at, '§7 custom properties are --cb-* tokens or --_ private', shown);
      if (prop.startsWith('--cb-') && !inTokens) flag(file, at, '§8 --cb-* tokens are declared in @layer tokens', shown);
      if (new RegExp(`var\\(${prop}(?![\\w-])`).test(value)) flag(file, at, '§7 a custom property must not reference itself', shown);
    }
    if (inTokens) return; // tokens are where literal values belong

    if (/#[0-9a-f]{3,8}\b/i.test(value) || /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(value))
      flag(file, at, '§6 colours come from --cb-* tokens (color-mix for derived)', shown);
    if (/(^|-)radius$/.test(prop) && !/var\(--/.test(value) && !/^(0|0px|inherit|initial|unset|revert)$/.test(value))
      flag(file, at, '§6 radii come from --cb-radius-* tokens', shown);
    if (prop === 'box-shadow' && !/^(none|var\(--[\w-]+\)(\s*,\s*var\(--[\w-]+\))*)$/.test(value))
      flag(file, at, '§6 shadows come from --cb-shadow-* tokens', shown);
    if (/^(transition|animation)(-duration|-delay)?$/.test(prop) && /(^|[\s,(])\d*\.?\d+m?s\b/.test(value))
      flag(file, at, '§5/§6 durations come from --cb-duration (50ms max)', shown);
  };

  let declStart = 1;
  for (let k = 0; k < code.length; k++) {
    const ch = code[k];
    if (ch === '{') {
      const selector = buf.trim().replace(/\s+/g, ' ');
      const at = selector.startsWith('@');
      const layer = /^@layer\s+([\w-]+)/.exec(selector)?.[1] ?? null;
      if (!at) {
        const touched = Array.from({ length: line - bufStart + 1 }, (_, i) => bufStart + i).some(isAdded);
        if (touched) {
          if (styleDepth() >= 3) flag(file, line, '§7 nesting at most two levels deep', raw[line - 1]);
          if (/(^|[\s,>+~(])#[a-z_-]/i.test(selector)) flag(file, line, '§6 no ID selectors', raw[line - 1]);
          if (/::?-(webkit|moz|ms)-/.test(selector)) {
            const before = raw.slice(Math.max(0, bufStart - 80), bufStart - 1).join('\n');
            if (!/\/\*[^]*?(Chromium|WebKit|Firefox|Gecko|engine|W3C|standard)[^]*?\*\//i.test(before)) flag(file, line, '§6 engine pseudo-element needs an explanatory comment (and must be on the allowed list)', raw[line - 1]);
          }
        }
      }
      stack.push({ at, layer, selector });
      buf = ''; bufStart = line; declStart = line;
    } else if (ch === '}') {
      if (buf.trim()) declaration(buf, declStart);
      stack.pop(); buf = '';
    } else if (ch === ';') {
      if (stack.length && !buf.trim().startsWith('@')) declaration(buf, declStart);
      else if (/@import/.test(buf) && isAdded(line)) flag(file, line, '§6 no @import', raw[line - 1]);
      buf = '';
    } else {
      if (!buf.trim() && ch.trim()) { bufStart = line; declStart = line; }
      buf += ch;
    }
    if (ch === '\n') line++;
  }
}

// --- JS ----------------------------------------------------------------------------
function scanJs(file) {
  if (!existsSync(file)) return;
  const added = addedLines(file);
  readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    const n = i + 1;
    if (added !== null && !added.has(n)) return;
    if (/\b(import|require)\s*\(|^\s*import\s/.test(text)) flag(file, n, '§6 no runtime dependencies', text);
    if (/https?:\/\//.test(text) && !/^\s*\/\//.test(text)) flag(file, n, '§6 no remote resources', text);
    if (/\.classList\.(add|remove|toggle)\(/.test(text)) flag(file, n, '§6 states use attributes, not JS class toggling (check this is not a state)', text);
    if (/\.style\.(?!(set|remove)Property\(\s*[`'"]--)|setAttribute\(\s*['"]style/.test(text)) flag(file, n, '§6 no inline styles from script (check it is not a state)', text);
  });
}

scanCss('dist/cubicle.css');
scanJs('dist/cubicle.js');

if (!findings.length) {
  console.log(`scan-diff: no rule leads in ${all ? 'the files' : 'the added lines'}.`);
} else {
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}\n    ${f.text}`);
  console.log(`\nscan-diff: ${findings.length} lead(s). Read each line before reporting it.`);
}
process.exit(findings.length ? 1 : 0);
