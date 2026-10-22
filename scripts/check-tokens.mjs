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

// --- Configuration -----------------------------------------------------------------

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STYLESHEET = 'dist/cubicle.css';
const DEFAULT_CATALOGUE = 'docs/index.html';
const DOCS_STYLESHEET = 'docs/docs.css';

const TOKEN_NAME_PATTERN = /^--cb-[a-z0-9-]+$/;
const TOKENS_LAYER_PATTERN = /@layer\s+tokens\s*\{/;
// A rule without nested rules inside the tokens layer: its selector and its declarations.
const FLAT_RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const TOKEN_DECLARATION_PATTERN = /(--cb-[a-z0-9-]+)\s*:\s*([^;]+);/g;
const VAR_REFERENCE_PATTERN = /var\(\s*(--cb-[a-z0-9-]+)/g;
const TABLE_ROW_PATTERN = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
const CODE_ELEMENT_PATTERN = /<code\b[^>]*>([\s\S]*?)<\/code>/g;

// Check 6 (AGENTS.md section 6): system colours are the user's theme inside forced colours, and
// hard-coded colours anywhere else.
const SYSTEM_COLOUR_PATTERN = /(?<![\w-])(Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText)(?![\w-])/i;
const FORCED_COLORS_MEDIA_PATTERN = /^@media\b[^{]*forced-colors\s*:\s*active/i;
const QUOTED_STRING_PATTERN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

// The entities the catalogue uses, in decoding order (&amp; last).
const HTML_ENTITIES = [
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&amp;', '&'],
];

// --- Helpers -----------------------------------------------------------------------

// Reads the command line: an optional --css <file> anywhere, then an optional catalogue path.
function parseArguments(argv) {
  const remaining = argv.slice(2);
  let stylesheet = DEFAULT_STYLESHEET;
  const cssFlagIndex = remaining.indexOf('--css');
  if (cssFlagIndex >= 0) {
    const [, cssValue] = remaining.splice(cssFlagIndex, 2);
    stylesheet = cssValue ?? '';
  }
  return {
    cssFile: resolve(REPOSITORY_ROOT, stylesheet),
    docsFile: resolve(REPOSITORY_ROOT, remaining[0] ?? DEFAULT_CATALOGUE),
    docsCssFile: resolve(REPOSITORY_ROOT, DOCS_STYLESHEET),
  };
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

function squashWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function unescapeHtml(text) {
  let decoded = text;
  for (const [entity, character] of HTML_ENTITIES) {
    decoded = decoded.replaceAll(entity, character);
  }
  return decoded;
}

// Hex colours compare case-insensitively; every other value must match exactly.
function valuesMatch(documentedValue, declaredValue) {
  if (/^#[0-9a-f]+$/i.test(documentedValue)) {
    return documentedValue.toLowerCase() === declaredValue.toLowerCase();
  }
  return documentedValue === declaredValue;
}

// Offset of the "}" that closes the "{" at `openOffset`, or the text length when it never closes.
function findClosingBrace(text, openOffset) {
  let depth = 0;
  let offset = openOffset;
  for (; offset < text.length; offset++) {
    if (text[offset] === '{') {
      depth += 1;
    }
    if (text[offset] === '}') {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
  }
  return offset;
}

// Reads @layer tokens { ... } of a comment-free stylesheet.
// Returns { layerFound, declared, overrides }: declared maps each :root token to its
// whitespace-normalised value; overrides lists [selector, token names] for every other block
// (the density modes).
function readDeclaredTokens(css) {
  const declared = new Map();
  const overrides = [];
  const layerOffset = css.search(TOKENS_LAYER_PATTERN);
  if (layerOffset < 0) {
    return { layerFound: false, declared, overrides };
  }

  const openOffset = css.indexOf('{', layerOffset);
  const closeOffset = findClosingBrace(css, openOffset);
  const layerBody = css.slice(openOffset + 1, closeOffset);

  for (const [, rawSelector, block] of layerBody.matchAll(FLAT_RULE_PATTERN)) {
    const selector = rawSelector.trim();
    const declarations = [...block.matchAll(TOKEN_DECLARATION_PATTERN)];
    if (selector === ':root') {
      for (const [, name, value] of declarations) {
        declared.set(name, squashWhitespace(value));
      }
    } else {
      const names = declarations.map(([, name]) => name);
      overrides.push([selector, names]);
    }
  }
  return { layerFound: true, declared, overrides };
}

// Reads the catalogue's table rows. Returns a map of token name -> every value written for it
// (a token may appear in several tables, with or without a value).
function readDocumentedTokens(html) {
  const documented = new Map();
  for (const [, rowMarkup] of html.matchAll(TABLE_ROW_PATTERN)) {
    const codeTexts = [];
    for (const [, codeMarkup] of rowMarkup.matchAll(CODE_ELEMENT_PATTERN)) {
      codeTexts.push(squashWhitespace(unescapeHtml(codeMarkup)));
    }

    codeTexts.forEach((text, i) => {
      if (!TOKEN_NAME_PATTERN.test(text)) {
        return;
      }
      const nextText = codeTexts[i + 1];
      const values = documented.get(text) ?? [];
      if (nextText !== undefined && !TOKEN_NAME_PATTERN.test(nextText)) {
        values.push(nextText);
      }
      documented.set(text, values);
    });
  }
  return documented;
}

// Every distinct var(--cb-*) name a stylesheet file references, comments excluded.
function readVarReferences(file) {
  const css = stripComments(readFileSync(file, 'utf8'));
  const names = new Set();
  for (const match of css.matchAll(VAR_REFERENCE_PATTERN)) {
    names.add(match[1]);
  }
  return names;
}

// Walks a comment-free stylesheet declaration by declaration, keeping the stack of open block
// preludes (selectors and at-rules). Returns the declarations that use a system colour outside
// a forced-colours media block, and how many use one inside such a block.
function findSystemColourUses(css) {
  const text = css.replace(QUOTED_STRING_PATTERN, '""');
  const openPreludes = [];
  const misplaced = [];
  let insideCount = 0;
  let chunkStart = 0;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '{') {
      openPreludes.push(text.slice(chunkStart, i).trim());
      chunkStart = i + 1;
      continue;
    }
    if (character !== '}' && character !== ';') {
      continue;
    }

    const declaration = text.slice(chunkStart, i).trim();
    chunkStart = i + 1;
    const colonOffset = declaration.indexOf(':');
    const isDeclaration = openPreludes.length > 0 && colonOffset > 0 && !declaration.startsWith('@');
    if (isDeclaration && SYSTEM_COLOUR_PATTERN.test(declaration.slice(colonOffset + 1))) {
      const inForcedColours = openPreludes.some((prelude) => FORCED_COLORS_MEDIA_PATTERN.test(prelude));
      if (inForcedColours) {
        insideCount += 1;
      } else {
        const innermostPrelude = openPreludes.at(-1);
        misplaced.push(`${innermostPrelude.slice(0, 50)} { ${declaration.slice(0, 60)} }`);
      }
    }
    if (character === '}') {
      openPreludes.pop();
    }
  }
  return { misplaced, insideCount };
}

function formatResult(result) {
  const status = result.ok ? 'ok  ' : 'FAIL';
  const detail = result.detail ? '  (' + result.detail + ')' : '';
  return `${status}  ${result.name}${detail}`;
}

// --- Main --------------------------------------------------------------------------

function runChecks() {
  const { cssFile, docsFile, docsCssFile } = parseArguments(process.argv);

  const results = [];
  const check = (ok, name, detail = '') => {
    results.push({ ok, name, detail });
  };

  // 0. Declared tokens: the body of @layer tokens { ... }.
  const css = stripComments(readFileSync(cssFile, 'utf8'));
  const { layerFound, declared, overrides } = readDeclaredTokens(css);
  if (!layerFound) {
    check(false, '@layer tokens block found', relative(REPOSITORY_ROOT, cssFile));
  }
  const documented = readDocumentedTokens(readFileSync(docsFile, 'utf8'));

  // 1. Declared -> documented
  const undocumented = [...declared.keys()].filter((name) => !documented.has(name));
  for (const name of undocumented) {
    check(false, `${name} is documented in the catalogue`);
  }
  if (declared.size > 0 && undocumented.length === 0) {
    check(true, `all ${declared.size} declared tokens are documented`);
  }

  // 2. Documented -> declared
  const stale = [...documented.keys()].filter((name) => !declared.has(name));
  for (const name of stale) {
    check(false, `documented ${name} exists in the stylesheet`);
  }
  if (documented.size > 0 && stale.length === 0) {
    check(true, `all ${documented.size} documented tokens exist in the stylesheet`);
  }

  // 3. Documented values
  let comparedCount = 0;
  let mismatchCount = 0;
  for (const [name, values] of documented) {
    if (!declared.has(name)) {
      continue;
    }
    const declaredValue = declared.get(name);
    for (const value of values) {
      comparedCount += 1;
      if (!valuesMatch(value, declaredValue)) {
        mismatchCount += 1;
        const detail = `docs ${JSON.stringify(value)} vs css ${JSON.stringify(declaredValue)}`;
        check(false, `${name} value in the catalogue matches the stylesheet`, detail);
      }
    }
  }
  if (comparedCount > 0 && mismatchCount === 0) {
    check(true, `all ${comparedCount} documented values match the stylesheet`);
  }

  // 4. var() references
  for (const file of [cssFile, docsCssFile]) {
    const shownFile = relative(REPOSITORY_ROOT, file);
    const references = readVarReferences(file);
    const unknown = [...references].filter((name) => !declared.has(name));
    for (const name of unknown) {
      check(false, `var(${name}) in ${shownFile} is declared`);
    }
    if (unknown.length === 0) {
      check(true, `all ${references.size} var(--cb-*) references in ${shownFile} are declared`);
    }
  }

  // 5. Density blocks redefine declared tokens only
  for (const [selector, names] of overrides) {
    const unknown = names.filter((name) => !declared.has(name));
    const detail = unknown.join(', ') || `${names.length} tokens`;
    check(unknown.length === 0, `${selector} redefines declared tokens only`, detail);
  }

  // 6. System colours only in forced-colours blocks
  const { misplaced, insideCount } = findSystemColourUses(css);
  const systemColourDetail = misplaced.slice(0, 3).join(' | ') || `${insideCount} declarations`;
  check(misplaced.length === 0, 'system colour keywords appear only inside @media (forced-colors: active)', systemColourDetail);

  for (const result of results) {
    console.log(formatResult(result));
  }
  const failedCount = results.filter((result) => !result.ok).length;
  const passedCount = results.length - failedCount;
  const shownFiles = `${relative(REPOSITORY_ROOT, cssFile)}, ${relative(REPOSITORY_ROOT, docsFile)}`;
  console.log(`\n${passedCount}/${results.length} checks passed. Files: ${shownFiles}`);
  process.exit(failedCount > 0 ? 1 : 0);
}

runChecks();
