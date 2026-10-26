// Inventory of what Cubicle ships against what it documents, for the whole-framework audit.
// Reads dist/cubicle.css, dist/cubicle.js, docs/index.html and docs/example.html and prints:
//   1. every cb-* class the stylesheet defines, with its use in the catalogue's live markup and
//      the example console, and whether a component root is in the CSS ToC;
//   2. every state the stylesheet styles on a cb-* class ([disabled], [aria-busy="true"],
//      :checked, ...) and whether some catalogue demo carries that class with that state;
//   3. every data-cb-* hook cubicle.js reads, with its use in the catalogue and the example.
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

// --- Configuration -----------------------------------------------------------------

const STYLESHEET = 'dist/cubicle.css';
const SCRIPT = 'dist/cubicle.js';
const CATALOGUE = 'docs/index.html';
const EXAMPLE = 'docs/example.html';

// Expanding nested :is() / :where() can multiply selectors; each selector stops at this many.
const MAX_EXPANSIONS = 500;

// Pseudo-classes that are states, with the attribute that sets them in markup.
const PSEUDO_CLASS_STATES = { checked: 'checked', disabled: 'disabled', 'read-only': 'readonly' };
const STATE_ATTRIBUTE_PATTERN = /^(aria-[a-z]+|data-cb-[a-z-]+|disabled|readonly|open|required|multiple|checked|selected|hidden|inert|popover|start|reversed)$/;

// Tags with their attributes. Snippets are escaped (&lt;), so they never match.
const TAG_PATTERN = /<([a-z][a-z0-9-]*)\b([^>]*)>/g;
const ATTRIBUTE_PATTERN = /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const TABLE_OF_CONTENTS_PATTERN = /Table of Contents[\s\S]*?\*\//;
const CB_CLASS_PATTERN = /\.(cb-[\w-]+)/g;
// An element type in a compound, wherever :is() / :where() expansion put it (".cb-select[readonly]input").
const TAG_IN_COMPOUND_PATTERN = /(?:^|[\])])([a-z][a-z0-9]*)(?=$|[.[:#])/g;
const ATTRIBUTE_SELECTOR_PATTERN = /\[\s*([a-z-]+)\s*(?:([~|^$*]?=)\s*["']?([^"'\]]*)["']?)?\s*\]/g;
const STATE_PSEUDO_CLASS_PATTERN = /:(checked|disabled|read-only)(?![\w-])/g;
const NOT_OR_HAS_PATTERN = /^:(not|has)\(/;
const IS_OR_WHERE_PATTERN = /:(is|where)\(/;
const COMPOUND_SEPARATOR_PATTERN = /[\s>+~]/;
// "cb-text-*" in prose names every class that starts with "cb-text".
const WILDCARD_CLASS_PATTERN = /(cb-[\w-]*?)-?\*/g;
const HOOK_PATTERN = /data-cb-[a-z-]+/g;

// --- Helpers: markup ---------------------------------------------------------------

// Every opening tag of a page: { tag, attrs, classes }.
function parseElements(html) {
  const elements = [];
  for (const tagMatch of html.matchAll(TAG_PATTERN)) {
    const attrs = {};
    for (const attributeMatch of tagMatch[2].matchAll(ATTRIBUTE_PATTERN)) {
      const name = attributeMatch[1].toLowerCase();
      attrs[name] = attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? '';
    }
    const classes = (attrs.class ?? '').split(/\s+/).filter(Boolean);
    elements.push({ tag: tagMatch[1], attrs, classes });
  }
  return elements;
}

function countElementsWithClass(elements, className) {
  return elements.filter((element) => element.classes.includes(className)).length;
}

// --- Helpers: selectors ------------------------------------------------------------

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

// Splits at every separator character outside parentheses and brackets; trims the parts and
// drops empty ones.
function splitTopLevel(text, separatorPattern) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of text) {
    if ('(['.includes(character)) {
      depth += 1;
    }
    if (')]'.includes(character)) {
      depth -= 1;
    }
    if (depth === 0 && separatorPattern.test(character)) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

// The argument of a functional pseudo-class whose "(" is at `openOffset`, and the offset just
// past its ")".
function functionalArgumentAt(text, openOffset) {
  let depth = 0;
  let offset = openOffset;
  for (; offset < text.length; offset++) {
    if (text[offset] === '(') {
      depth += 1;
    }
    if (text[offset] === ')') {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
  }
  return { argument: text.slice(openOffset + 1, offset), end: offset + 1 };
}

// :not(...) negates and :has(...) is about a descendant, so neither names a state of the element.
function dropNotAndHas(selector) {
  let kept = '';
  let offset = 0;
  while (offset < selector.length) {
    const match = NOT_OR_HAS_PATTERN.exec(selector.slice(offset));
    if (match) {
      const openOffset = offset + match[0].length - 1;
      offset = functionalArgumentAt(selector, openOffset).end;
    } else {
      kept += selector[offset];
      offset += 1;
    }
  }
  return kept;
}

// :is(a, b) and :where(a, b) are alternatives: one selector per alternative.
function expandAlternatives(selector) {
  const match = IS_OR_WHERE_PATTERN.exec(selector);
  if (!match) {
    return [selector];
  }
  const openOffset = match.index + match[0].length - 1;
  const { argument, end } = functionalArgumentAt(selector, openOffset);
  const before = selector.slice(0, match.index);
  const after = selector.slice(end);

  const expanded = [];
  for (const alternative of splitTopLevel(argument, /,/)) {
    expanded.push(...expandAlternatives(before + alternative + after));
  }
  return expanded.slice(0, MAX_EXPANSIONS);
}

// A nested selector resolved against its parent: "&" is replaced, otherwise it is a descendant.
function resolveNested(parentSelector, ownSelector) {
  if (ownSelector.includes('&')) {
    return ownSelector.replaceAll('&', parentSelector);
  }
  return `${parentSelector} ${ownSelector}`;
}

// Style rules with their selectors resolved through nesting: [{ selectors, line }].
// `bareCss` is the stylesheet with comments blanked (offsets kept); `css` gives line numbers.
function parseRules(bareCss, css) {
  const rules = [];
  const openBlocks = [];
  let prelude = '';
  // Where the current prelude began. At-rules do not move it, so a rule that opens right after an
  // at-rule (".a" in "@media x { .a {") reports the at-rule's line.
  let preludeStart = 0;
  let openQuote = null;

  for (let i = 0; i < bareCss.length; i++) {
    const character = bareCss[i];
    if (openQuote) {
      prelude += character;
      if (character === openQuote && bareCss[i - 1] !== '\\') {
        openQuote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      openQuote = character;
      prelude += character;
      continue;
    }

    if (character === '{') {
      const trimmedPrelude = prelude.trim();
      prelude = '';
      if (trimmedPrelude.startsWith('@')) {
        openBlocks.push({ isAtRule: true });
        continue;
      }
      const parent = openBlocks.findLast((block) => !block.isAtRule);
      const ownSelectors = splitTopLevel(trimmedPrelude, /,/);
      let selectors = ownSelectors;
      if (parent) {
        selectors = [];
        for (const parentSelector of parent.selectors) {
          for (const ownSelector of ownSelectors) {
            selectors.push(resolveNested(parentSelector, ownSelector));
          }
        }
      }
      openBlocks.push({ selectors });
      const firstVisibleOffset = preludeStart + bareCss.slice(preludeStart).search(/\S/);
      rules.push({ selectors, line: lineNumberAt(css, firstVisibleOffset) });
      preludeStart = i + 1;
      continue;
    }

    if (character === ';' || character === '}') {
      if (character === '}') {
        openBlocks.pop();
      }
      prelude = '';
      preludeStart = i + 1;
      continue;
    }
    prelude += character;
  }
  return rules;
}

// Every cb-* class named in some rule's selectors.
function collectDefinedClasses(rules) {
  const defined = new Set();
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      for (const match of selector.matchAll(CB_CLASS_PATTERN)) {
        defined.add(match[1]);
      }
    }
  }
  return defined;
}

// The states written in one compound selector: attribute selectors on state attributes and the
// state pseudo-classes. Each is { attr, op, value }.
function statesInCompound(compound) {
  const found = [];
  for (const attributeMatch of compound.matchAll(ATTRIBUTE_SELECTOR_PATTERN)) {
    if (STATE_ATTRIBUTE_PATTERN.test(attributeMatch[1])) {
      found.push({ attr: attributeMatch[1], op: attributeMatch[2] ?? null, value: attributeMatch[3] ?? null });
    }
  }
  for (const pseudoMatch of compound.matchAll(STATE_PSEUDO_CLASS_PATTERN)) {
    found.push({ attr: PSEUDO_CLASS_STATES[pseudoMatch[1]], op: null, value: null });
  }
  return found;
}

// States: an attribute or pseudo-class in the same compound as one or more cb-* classes.
// Returns a map of key -> { classes, tags, attr, op, value, line }, first rule wins.
function collectStyledStates(rules) {
  const states = new Map();
  for (const rule of rules) {
    const expandedSelectors = [];
    for (const selector of rule.selectors) {
      expandedSelectors.push(...expandAlternatives(dropNotAndHas(selector)));
    }

    for (const selector of expandedSelectors) {
      for (const compound of splitTopLevel(selector, COMPOUND_SEPARATOR_PATTERN)) {
        const classMatches = [...compound.matchAll(CB_CLASS_PATTERN)];
        const classes = [...new Set(classMatches.map((match) => match[1]))];
        if (classes.length === 0) {
          continue;
        }
        const tagMatches = [...compound.matchAll(TAG_IN_COMPOUND_PATTERN)];
        const tags = tagMatches.map((match) => match[1]);

        for (const state of statesInCompound(compound)) {
          const condition = state.op ? `${state.op}"${state.value}"` : '';
          const key = `${tags.join('|')}.${classes.join('.')}[${state.attr}${condition}]`;
          if (!states.has(key)) {
            states.set(key, { classes, tags, ...state, line: rule.line });
          }
        }
      }
    }
  }
  return states;
}

// The element has every class of the state, and its type when the selector names one.
function elementFits(element, state) {
  const hasClasses = state.classes.every((className) => element.classes.includes(className));
  const hasTag = state.tags.length === 0 || state.tags.includes(element.tag);
  return hasClasses && hasTag;
}

// The element fits and carries the state's attribute with a matching value.
function elementCarries(element, state) {
  if (!elementFits(element, state) || !(state.attr in element.attrs)) {
    return false;
  }
  const value = element.attrs[state.attr];
  switch (state.op) {
    case '=':
      return value === state.value;
    case '~=':
      return value.split(/\s+/).includes(state.value);
    case '^=':
      return value.startsWith(state.value);
    case '*=':
      return value.includes(state.value);
    default:
      return true;
  }
}

// --- Helpers: report ---------------------------------------------------------------

function mentions(text, name) {
  const escapedName = name.replace(/[-]/g, '\\-');
  return new RegExp(`${escapedName}(?![\\w-])`).test(text);
}

// A root counts as named by one of its modifiers or elements (.cb-grid--2) or a wildcard (.cb-text-*).
function namesRoot(text, root) {
  if (mentions(text, root) || text.includes(`${root}--`) || text.includes(`${root}__`)) {
    return true;
  }
  for (const wildcard of text.matchAll(WILDCARD_CLASS_PATTERN)) {
    if (root.startsWith(wildcard[1])) {
      return true;
    }
  }
  return false;
}

function pad(value, width) {
  return String(value).padEnd(width);
}

// --- Main --------------------------------------------------------------------------

function runInventory() {
  const showEveryRow = process.argv.includes('--full');
  const css = readFileSync(STYLESHEET, 'utf8');
  const js = readFileSync(SCRIPT, 'utf8');
  const liveElements = {
    index: parseElements(readFileSync(CATALOGUE, 'utf8')),
    example: parseElements(readFileSync(EXAMPLE, 'utf8')),
  };

  // Comments blanked (newlines kept, so offsets give line numbers).
  const bareCss = css.replace(COMMENT_PATTERN, (comment) => comment.replace(/[^\n]/g, ' '));
  const tableOfContents = (css.match(TABLE_OF_CONTENTS_PATTERN) ?? [''])[0];
  const rules = parseRules(bareCss, css);
  const definedClasses = collectDefinedClasses(rules);
  const styledStates = collectStyledStates(rules);
  let leadCount = 0;

  // 1. Classes
  const classRows = [...definedClasses].sort().map((className) => {
    const isRoot = !className.includes('__') && !className.includes('--');
    return {
      className,
      isRoot,
      index: countElementsWithClass(liveElements.index, className),
      example: countElementsWithClass(liveElements.example, className),
      toc: isRoot ? namesRoot(tableOfContents, className) : mentions(tableOfContents, `.${className}`),
    };
  });

  const undefinedUsed = [];
  for (const [pageName, elements] of Object.entries(liveElements)) {
    const usedClasses = new Set();
    for (const element of elements) {
      for (const className of element.classes) {
        if (className.startsWith('cb-') && !definedClasses.has(className)) {
          usedClasses.add(className);
        }
      }
    }
    for (const className of usedClasses) {
      undefinedUsed.push(`${pageName}: ${className}`);
    }
  }

  console.log('1. Classes (index / example = elements in live markup; toc = mentioned)');
  for (const row of classRows) {
    const notes = [];
    if (!row.index) {
      notes.push('NOT IN CATALOGUE');
    }
    if (row.isRoot && !row.toc) {
      notes.push('root not in CSS ToC');
    }
    if (notes.length > 0) {
      leadCount += 1;
    }
    if (showEveryRow || notes.length > 0) {
      const tocColumn = row.toc ? 'toc' : '   ';
      console.log(`   ${pad(row.className, 30)} index ${pad(row.index, 4)} example ${pad(row.example, 4)} ${tocColumn}  ${notes.join('; ')}`);
    }
  }
  for (const usage of undefinedUsed) {
    leadCount += 1;
    console.log(`   USED, NOT DEFINED in dist/cubicle.css  ${usage}`);
  }
  const rootRows = classRows.filter((row) => row.isRoot);
  const rootsOnExample = rootRows.filter((row) => row.example).length;
  const classesInCatalogue = classRows.filter((row) => row.index).length;
  console.log(`   ${classRows.length} classes (${rootRows.length} roots); ${classesInCatalogue} in the catalogue; ${rootsOnExample}/${rootRows.length} roots on the example page\n`);

  // 2. Styled states
  console.log('2. Styled states on cb-* classes, by catalogue demo');
  const allElements = [...liveElements.index, ...liveElements.example];
  const anyElementFits = (state) => allElements.some((element) => elementFits(element, state));
  const unreachableCount = [...styledStates.values()].filter((state) => !anyElementFits(state)).length;
  const reachableStates = [...styledStates.entries()].filter(([, state]) => anyElementFits(state));
  reachableStates.sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey));
  const stateRows = reachableStates.map(([key, state]) => ({
    key,
    state,
    index: liveElements.index.filter((element) => elementCarries(element, state)).length,
    example: liveElements.example.filter((element) => elementCarries(element, state)).length,
  }));

  for (const row of stateRows) {
    if (!row.index) {
      leadCount += 1;
    }
    if (showEveryRow || !row.index) {
      const note = row.index ? '' : '  NO DEMO CARRIES IT';
      console.log(`   ${pad(row.key, 58)} index ${pad(row.index, 4)} example ${pad(row.example, 4)} dist/cubicle.css:${row.state.line}${note}`);
    }
  }
  const statesInCatalogue = stateRows.filter((row) => row.index).length;
  console.log(`   ${stateRows.length} class/state pairs; ${statesInCatalogue} shown in the catalogue; ${unreachableCount} more left out because no page puts the class on that element type`);
  console.log('   (a pair may be set on an ancestor, by script or by the user: confirm each lead)\n');

  // 3. Script hooks
  console.log('3. cubicle.js hooks (data-cb-*)');
  const hooks = [...new Set(js.match(HOOK_PATTERN) ?? [])].sort();
  for (const hook of hooks) {
    const indexCount = liveElements.index.filter((element) => hook in element.attrs).length;
    const exampleCount = liveElements.example.filter((element) => hook in element.attrs).length;
    const notes = [];
    if (!indexCount) {
      notes.push('not in catalogue markup');
    }
    if (notes.length > 0) {
      leadCount += 1;
    }
    if (showEveryRow || notes.length > 0) {
      console.log(`   ${pad(hook, 26)} index ${pad(indexCount, 4)} example ${pad(exampleCount, 4)}  ${notes.join('; ')}`);
    }
  }
  console.log(`   ${hooks.length} hooks\n`);
  console.log(`${leadCount} leads. Hooks set by the script itself (data-cb-js, data-cb-copied) are expected to be absent from markup.`);
}

runInventory();
