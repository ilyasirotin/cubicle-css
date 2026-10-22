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

// --- Configuration -----------------------------------------------------------------

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CATALOGUE = 'docs/index.html';

// Opening tag of a live demo, and the opening <pre class="docs-snippet"><code> of its snippet.
const DEMO_OPEN_PATTERN = /<div\s[^>]*class="[^"]*\bdocs-demo\b[^"]*"[^>]*>/g;
const SNIPPET_OPEN_PATTERN = /<pre\s[^>]*class="[^"]*\bdocs-snippet\b[^"]*"[^>]*>\s*<code[^>]*>/g;
const DIV_TAG_PATTERN = /<div[\s>]|<\/div>/g;

// The entities a snippet uses, in decoding order (&amp; last, so "&amp;lt;" stays "&lt;").
const HTML_ENTITIES = [
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&amp;', '&'],
];

// --- Helpers -----------------------------------------------------------------------

// 1-based line number of a character offset in the source.
function lineNumberAt(source, offset) {
  const textBefore = source.slice(0, offset);
  return textBefore.split('\n').length;
}

// Finds the </div> that closes the <div> opened just before `from`.
// Returns the offset where that </div> starts (the end of the inner markup) and the offset just
// past it, or null when the source never closes the <div>.
function findClosingDiv(source, from) {
  const divTag = new RegExp(DIV_TAG_PATTERN.source, 'g');
  divTag.lastIndex = from;
  let depth = 1;
  let match = divTag.exec(source);
  while (match) {
    if (match[0] === '</div>') {
      depth -= 1;
    } else {
      depth += 1;
    }
    if (depth === 0) {
      return { innerEnd: match.index, closeEnd: divTag.lastIndex };
    }
    match = divTag.exec(source);
  }
  return null;
}

// The first snippet opening tag at or after `from`, or null.
function findSnippetFrom(source, from) {
  const snippetOpen = new RegExp(SNIPPET_OPEN_PATTERN.source, 'g');
  snippetOpen.lastIndex = from;
  return snippetOpen.exec(source);
}

function unescapeHtml(text) {
  let decoded = text;
  for (const [entity, character] of HTML_ENTITIES) {
    decoded = decoded.replaceAll(entity, character);
  }
  return decoded;
}

// Drops the first and last blank lines and the indentation all non-blank lines share, and trims
// the end of every line. Returns the lines.
function normalizeLines(text) {
  const withoutLeadingBlank = text.replace(/^\s*\n/, '');
  const withoutTrailingBlank = withoutLeadingBlank.replace(/\n\s*$/, '');
  const lines = withoutTrailingBlank.split('\n');

  let commonIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const leadingSpaces = line.match(/^ */)[0].length;
    commonIndent = Math.min(commonIndent, leadingSpaces);
  }

  const normalized = [];
  for (const line of lines) {
    normalized.push(line.slice(commonIndent).trimEnd());
  }
  return normalized;
}

// Index of the first line that differs between two lists of lines, or -1 when they are equal.
// When one list is a prefix of the other, the first line past the shorter one differs.
function firstDifferentLine(demoLines, snippetLines) {
  const mismatch = demoLines.findIndex((line, i) => line !== snippetLines[i]);
  if (mismatch >= 0) {
    return mismatch;
  }
  if (demoLines.length !== snippetLines.length) {
    return Math.min(demoLines.length, snippetLines.length);
  }
  return -1;
}

function formatResult(result) {
  const status = result.ok ? 'ok  ' : 'FAIL';
  const detail = result.detail ? '  (' + result.detail + ')' : '';
  return `${status}  ${result.name}${detail}`;
}

// --- Main --------------------------------------------------------------------------

function runChecks() {
  const catalogueFile = resolve(REPOSITORY_ROOT, process.argv[2] ?? DEFAULT_CATALOGUE);
  const source = readFileSync(catalogueFile, 'utf8');

  const results = [];
  const check = (ok, name, detail = '') => {
    results.push({ ok, name, detail });
  };

  // Offsets of the snippets that follow a demo; any other snippet is an orphan.
  const pairedSnippetOffsets = new Set();

  for (const demoOpen of source.matchAll(DEMO_OPEN_PATTERN)) {
    const location = `line ${lineNumberAt(source, demoOpen.index)}`;
    const demoContentStart = demoOpen.index + demoOpen[0].length;
    const closingDiv = findClosingDiv(source, demoContentStart);
    if (!closingDiv) {
      check(false, `demo at ${location} is closed`, 'no matching </div>');
      continue;
    }

    const liveMarkup = source.slice(demoContentStart, closingDiv.innerEnd);
    const hasInlineStyle = /\sstyle\s*=/.test(liveMarkup);
    check(!hasInlineStyle, `demo at ${location} has no inline styles`);

    const snippetOpen = findSnippetFrom(source, closingDiv.closeEnd);
    const gapBeforeSnippet = snippetOpen ? source.slice(closingDiv.closeEnd, snippetOpen.index) : '';
    if (!snippetOpen || gapBeforeSnippet.trim() !== '') {
      check(false, `demo at ${location} is followed by a docs-snippet`);
      continue;
    }
    pairedSnippetOffsets.add(snippetOpen.index);

    const snippetContentStart = snippetOpen.index + snippetOpen[0].length;
    const snippetContentEnd = source.indexOf('</code>', snippetContentStart);
    const escapedSnippet = source.slice(snippetContentStart, snippetContentEnd);
    const demoLines = normalizeLines(liveMarkup);
    const snippetLines = normalizeLines(unescapeHtml(escapedSnippet));

    const differentLine = firstDifferentLine(demoLines, snippetLines);
    let detail = '';
    if (differentLine >= 0) {
      const demoLine = JSON.stringify(demoLines[differentLine] ?? '');
      const snippetLine = JSON.stringify(snippetLines[differentLine] ?? '');
      detail = `first difference at demo line ${differentLine + 1}: ${demoLine} vs ${snippetLine}`;
    }
    check(differentLine < 0, `demo at ${location} matches its snippet`, detail);
  }

  for (const snippetOpen of source.matchAll(SNIPPET_OPEN_PATTERN)) {
    if (!pairedSnippetOffsets.has(snippetOpen.index)) {
      check(false, `snippet at line ${lineNumberAt(source, snippetOpen.index)} follows a docs-demo`);
    }
  }

  const shownFile = relative(REPOSITORY_ROOT, catalogueFile);
  if (results.length === 0) {
    check(false, 'at least one docs-demo found', shownFile);
  }

  for (const result of results) {
    console.log(formatResult(result));
  }
  const failedCount = results.filter((result) => !result.ok).length;
  const passedCount = results.length - failedCount;
  console.log(`\n${passedCount}/${results.length} checks passed. File: ${shownFile}`);
  process.exit(failedCount > 0 ? 1 : 0);
}

runChecks();
