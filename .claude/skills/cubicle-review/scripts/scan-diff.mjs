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

// --- Configuration -----------------------------------------------------------------

const STYLESHEET = 'dist/cubicle.css';
const SCRIPT = 'dist/cubicle.js';
const SHOWN_TEXT_LENGTH = 110;
const MAX_NESTING_DEPTH = 2;
// How many lines above an engine pseudo-element are searched for the comment that explains it.
const COMMENT_SEARCH_LINES = 80;

const HUNK_HEADER_PATTERN = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm;
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const STRING_ON_ONE_LINE_PATTERN = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const LAYER_NAME_PATTERN = /^@layer\s+([\w-]+)/;

// Selector rules
const ID_SELECTOR_PATTERN = /(^|[\s,>+~(])#[a-z_-]/i;
const ENGINE_PSEUDO_ELEMENT_PATTERN = /::?-(webkit|moz|ms)-/;
const ENGINE_COMMENT_PATTERN = /\/\*[^]*?(Chromium|WebKit|Firefox|Gecko|engine|W3C|standard)[^]*?\*\//i;

// Declaration rules
const IMPORTANT_PATTERN = /!important/i;
const VENDOR_PROPERTY_PATTERN = /^-(webkit|moz|ms|o)-/;
const OUTLINE_PROPERTY_PATTERN = /^outline(-|$)/;
const FOCUS_SELECTOR_PATTERN = /:focus/;
const BLUR_PATTERN = /blur\(/;
const REMOTE_URL_PATTERN = /url\(\s*["']?(https?:)?\/\//;
const ALLOWED_CUSTOM_PROPERTY_PATTERN = /^--(cb-|_)/;
const HEX_COLOUR_PATTERN = /#[0-9a-f]{3,8}\b/i;
const COLOUR_FUNCTION_PATTERN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const RADIUS_PROPERTY_PATTERN = /(^|-)radius$/;
const VAR_PATTERN = /var\(--/;
const KEYWORD_RADIUS_PATTERN = /^(0|0px|inherit|initial|unset|revert)$/;
const TOKEN_SHADOW_PATTERN = /^(none|var\(--[\w-]+\)(\s*,\s*var\(--[\w-]+\))*)$/;
const TIMING_PROPERTY_PATTERN = /^(transition|animation)(-duration|-delay)?$/;
const LITERAL_DURATION_PATTERN = /(^|[\s,(])\d*\.?\d+m?s\b/;

// Script rules
const IMPORT_PATTERN = /\b(import|require)\s*\(|^\s*import\s/;
const URL_PATTERN = /https?:\/\//;
const LINE_COMMENT_PATTERN = /^\s*\/\//;
const CLASS_TOGGLE_PATTERN = /\.classList\.(add|remove|toggle)\(/;
const INLINE_STYLE_PATTERN = /\.style\.(?!(set|remove)Property\(\s*[`'"]--)|setAttribute\(\s*['"]style/;

// --- Helpers -----------------------------------------------------------------------

// Line numbers git reports as added to `file` since HEAD, or null with --all (every line counts).
// A file git cannot diff has no added lines.
function readAddedLines(file, scanAll) {
  if (scanAll) {
    return null;
  }
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', 'HEAD', '-U0', '--', file], { encoding: 'utf8' });
  } catch {
    return new Set();
  }
  const lineNumbers = new Set();
  for (const hunk of diff.matchAll(HUNK_HEADER_PATTERN)) {
    const firstLine = Number(hunk[1]);
    const lineCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let i = 0; i < lineCount; i++) {
      lineNumbers.add(firstLine + i);
    }
  }
  return lineNumbers;
}

// Blanks comments and string contents, keeping every offset and newline, so braces, colons and
// semicolons inside them are ignored by the scanner.
function blankCommentsAndStrings(source) {
  const withoutComments = source.replace(COMMENT_PATTERN, (comment) => comment.replace(/[^\n]/g, ' '));
  return withoutComments.replace(STRING_ON_ONE_LINE_PATTERN, (quoted) => {
    const quote = quoted[0];
    return quote + ' '.repeat(quoted.length - 2) + quote;
  });
}

// --- CSS ---------------------------------------------------------------------------

function scanCss(file, scanAll, report) {
  if (!existsSync(file)) {
    return;
  }
  const addedLines = readAddedLines(file, scanAll);
  const isAdded = (lineNumber) => addedLines === null || addedLines.has(lineNumber);
  const source = readFileSync(file, 'utf8');
  const sourceLines = source.split('\n');
  const code = blankCommentsAndStrings(source);

  // Open blocks, outermost first: { isAtRule, layer: string|null, selector }.
  const openBlocks = [];
  const currentLayer = () => openBlocks.findLast((block) => block.layer)?.layer ?? null;
  const styleRuleDepth = () => openBlocks.filter((block) => !block.isAtRule).length;
  const selectorChain = () => {
    const selectors = [];
    for (const block of openBlocks) {
      if (!block.isAtRule) {
        selectors.push(block.selector);
      }
    }
    return selectors.join(' ');
  };

  const checkSelector = (selector, firstLine, lastLine) => {
    let touched = false;
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
      if (isAdded(lineNumber)) {
        touched = true;
      }
    }
    if (!touched) {
      return;
    }
    const shown = sourceLines[lastLine - 1];
    if (styleRuleDepth() >= MAX_NESTING_DEPTH + 1) {
      report(file, lastLine, '§7 nesting at most two levels deep', shown);
    }
    if (ID_SELECTOR_PATTERN.test(selector)) {
      report(file, lastLine, '§6 no ID selectors', shown);
    }
    if (ENGINE_PSEUDO_ELEMENT_PATTERN.test(selector)) {
      const searchStart = Math.max(0, firstLine - COMMENT_SEARCH_LINES);
      const linesBefore = sourceLines.slice(searchStart, firstLine - 1).join('\n');
      if (!ENGINE_COMMENT_PATTERN.test(linesBefore)) {
        report(file, lastLine, '§6 engine pseudo-element needs an explanatory comment (and must be on the allowed list)', shown);
      }
    }
  };

  const checkDeclaration = (text, lineNumber) => {
    const colonOffset = text.indexOf(':');
    if (colonOffset < 0) {
      return;
    }
    const insideAnyBlock = styleRuleDepth() > 0 || openBlocks.some((block) => block.isAtRule);
    if (!insideAnyBlock) {
      return;
    }
    const property = text.slice(0, colonOffset).trim();
    const value = text.slice(colonOffset + 1).trim();
    if (!property || !isAdded(lineNumber)) {
      return;
    }
    const shown = sourceLines[lineNumber - 1];
    const inTokensLayer = currentLayer() === 'tokens';
    const selector = selectorChain();

    if (IMPORTANT_PATTERN.test(value)) {
      report(file, lineNumber, '§6 no !important', shown);
    }
    if (VENDOR_PROPERTY_PATTERN.test(property)) {
      report(file, lineNumber, '§6 no vendor-prefixed properties', shown);
    }
    if (OUTLINE_PROPERTY_PATTERN.test(property) && !FOCUS_SELECTOR_PATTERN.test(selector)) {
      report(file, lineNumber, '§13 outline only in the focus indicator', shown);
    }
    if (property === 'backdrop-filter' || BLUR_PATTERN.test(value)) {
      report(file, lineNumber, '§5 no glassmorphism / blur', shown);
    }
    if (REMOTE_URL_PATTERN.test(value)) {
      report(file, lineNumber, '§6 no remote resources', shown);
    }

    if (property.startsWith('--')) {
      if (!ALLOWED_CUSTOM_PROPERTY_PATTERN.test(property)) {
        report(file, lineNumber, '§7 custom properties are --cb-* tokens or --_ private', shown);
      }
      if (property.startsWith('--cb-') && !inTokensLayer) {
        report(file, lineNumber, '§8 --cb-* tokens are declared in @layer tokens', shown);
      }
      const selfReference = new RegExp(`var\\(${property}(?![\\w-])`);
      if (selfReference.test(value)) {
        report(file, lineNumber, '§7 a custom property must not reference itself', shown);
      }
    }
    // Tokens are where literal values belong.
    if (inTokensLayer) {
      return;
    }

    if (HEX_COLOUR_PATTERN.test(value) || COLOUR_FUNCTION_PATTERN.test(value)) {
      report(file, lineNumber, '§6 colours come from --cb-* tokens (color-mix for derived)', shown);
    }
    const isLiteralRadius = RADIUS_PROPERTY_PATTERN.test(property) && !VAR_PATTERN.test(value) && !KEYWORD_RADIUS_PATTERN.test(value);
    if (isLiteralRadius) {
      report(file, lineNumber, '§6 radii come from --cb-radius-* tokens', shown);
    }
    if (property === 'box-shadow' && !TOKEN_SHADOW_PATTERN.test(value)) {
      report(file, lineNumber, '§6 shadows come from --cb-shadow-* tokens', shown);
    }
    if (TIMING_PROPERTY_PATTERN.test(property) && LITERAL_DURATION_PATTERN.test(value)) {
      report(file, lineNumber, '§5/§6 durations come from --cb-duration (50ms max)', shown);
    }
  };

  // The text since the last "{", "}" or ";", and the line its first visible character is on.
  let chunk = '';
  let chunkStartLine = 1;
  let lineNumber = 1;
  for (const character of code) {
    if (character === '{') {
      const selector = chunk.trim().replace(/\s+/g, ' ');
      const isAtRule = selector.startsWith('@');
      const layer = LAYER_NAME_PATTERN.exec(selector)?.[1] ?? null;
      if (!isAtRule) {
        checkSelector(selector, chunkStartLine, lineNumber);
      }
      openBlocks.push({ isAtRule, layer, selector });
      chunk = '';
      chunkStartLine = lineNumber;
    } else if (character === '}') {
      if (chunk.trim()) {
        checkDeclaration(chunk, chunkStartLine);
      }
      openBlocks.pop();
      chunk = '';
    } else if (character === ';') {
      if (openBlocks.length > 0 && !chunk.trim().startsWith('@')) {
        checkDeclaration(chunk, chunkStartLine);
      } else if (/@import/.test(chunk) && isAdded(lineNumber)) {
        report(file, lineNumber, '§6 no @import', sourceLines[lineNumber - 1]);
      }
      chunk = '';
    } else {
      if (!chunk.trim() && character.trim()) {
        chunkStartLine = lineNumber;
      }
      chunk += character;
    }
    if (character === '\n') {
      lineNumber += 1;
    }
  }
}

// --- JS ----------------------------------------------------------------------------

function scanJs(file, scanAll, report) {
  if (!existsSync(file)) {
    return;
  }
  const addedLines = readAddedLines(file, scanAll);
  const sourceLines = readFileSync(file, 'utf8').split('\n');
  sourceLines.forEach((text, i) => {
    const lineNumber = i + 1;
    if (addedLines !== null && !addedLines.has(lineNumber)) {
      return;
    }
    if (IMPORT_PATTERN.test(text)) {
      report(file, lineNumber, '§6 no runtime dependencies', text);
    }
    if (URL_PATTERN.test(text) && !LINE_COMMENT_PATTERN.test(text)) {
      report(file, lineNumber, '§6 no remote resources', text);
    }
    if (CLASS_TOGGLE_PATTERN.test(text)) {
      report(file, lineNumber, '§6 states use attributes, not JS class toggling (check this is not a state)', text);
    }
    if (INLINE_STYLE_PATTERN.test(text)) {
      report(file, lineNumber, '§6 no inline styles from script (check it is not a state)', text);
    }
  });
}

// --- Main --------------------------------------------------------------------------

function runScan() {
  const scanAll = process.argv.includes('--all');
  const findings = [];
  const report = (file, line, rule, text) => {
    findings.push({ file, line, rule, text: text.trim().slice(0, SHOWN_TEXT_LENGTH) });
  };

  scanCss(STYLESHEET, scanAll, report);
  scanJs(SCRIPT, scanAll, report);

  if (findings.length === 0) {
    const scope = scanAll ? 'the files' : 'the added lines';
    console.log(`scan-diff: no rule leads in ${scope}.`);
  } else {
    for (const finding of findings) {
      console.log(`${finding.file}:${finding.line}  ${finding.rule}\n    ${finding.text}`);
    }
    console.log(`\nscan-diff: ${findings.length} lead(s). Read each line before reporting it.`);
  }
  process.exit(findings.length > 0 ? 1 : 0);
}

runScan();
