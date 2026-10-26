// Computed-style snapshots of the catalogue and the example page, for proving that a cleanup of
// dist/cubicle.css changes nothing a browser renders. Development tool only; it writes nothing
// but the snapshot file it is given.
//
// Run from the repository root (needs the dev dependencies of scripts/, see verify-browser.mjs):
//   node .claude/skills/cubicle-css-audit/scripts/style-snapshot.mjs capture tmp/css-audit/before.json
//        [--browser chromium|firefox|webkit] [--css dist/cubicle.min.css]
//   node .claude/skills/cubicle-css-audit/scripts/style-snapshot.mjs compare tmp/css-audit/before.json
//        tmp/css-audit/after.json [--limit 10]
//
//   capture  loads docs/index.html and docs/example.html under every condition in CONDITIONS
//            (widths on both sides of each breakpoint, densities, forced colours, print), stops
//            animations at their start and records the computed style of every element, and of its
//            ::before, ::after and ::marker when they render. Custom properties are left out, so
//            renaming a --_ private property is no difference; every property it feeds still is.
//            --css serves another stylesheet in place of dist/cubicle.css (the minified build).
//   compare  prints, per condition, how many boxes changed each property (a changed font weight
//            shows as itself plus the widths it moved), then the first differences with the box,
//            the property and both values; --limit caps those lines per condition (10 by default).
//
// Not covered: :hover, :focus and :active (the state checks and state-*.png shots of
// scripts/verify-browser.mjs), and engine pseudo-elements such as ::-webkit-meter-bar, whose
// styles no script can read (capture in the engine that draws them and look at its shots).
//
// Exit code: 0 when a capture is written or the snapshots match, 1 when they differ, 2 on bad
// arguments or a page that failed to load.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- Configuration -----------------------------------------------------------------

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PAGES = ['docs/index.html', 'docs/example.html'];
const DEFAULT_ENGINE = 'chromium';
const DEFAULT_LIMIT = 10;
// How many changed properties the per-condition summary names, most frequent first.
const SUMMARY_PROPERTIES = 8;
const VIEWPORT_HEIGHT = 900;
// 360 and 720 sit below the 40rem and 50rem breakpoints, 800 and 1360 above them; 360, 800 and
// 1360 are also the widths AGENTS.md verifies.
const CONDITIONS = [
  { name: 'width-360', width: 360 },
  { name: 'width-720', width: 720 },
  { name: 'width-800', width: 800 },
  { name: 'width-1360', width: 1360 },
  { name: 'compact', width: 1360, density: 'compact' },
  { name: 'comfortable', width: 1360, density: 'comfortable' },
  { name: 'forced-colors', width: 1360, forcedColors: 'active' },
  { name: 'print', width: 1360, media: 'print' },
];

// --- Helpers -----------------------------------------------------------------------

function exitWithUsage(message) {
  console.error(message);
  console.error('usage: style-snapshot.mjs capture <file> [--browser chromium|firefox|webkit] [--css <file>]');
  console.error('       style-snapshot.mjs compare <before> <after> [--limit 10]');
  process.exit(2);
}

// Reads the command line. Every recognised option is removed from `remaining`, so whatever is
// left over is the command and its files.
function parseArguments(argv) {
  const remaining = argv.slice(2);

  function takeOption(name, fallback) {
    const position = remaining.indexOf(name);
    if (position === -1) {
      return fallback;
    }
    const value = remaining[position + 1];
    if (value === undefined || value.startsWith('--')) {
      exitWithUsage(`${name} needs a value`);
    }
    remaining.splice(position, 2);
    return value;
  }

  const engine = takeOption('--browser', DEFAULT_ENGINE);
  const cssOverride = takeOption('--css', null);
  const limit = Number(takeOption('--limit', String(DEFAULT_LIMIT)));
  const [command, ...files] = remaining;

  const inputFiles = [];
  if (command === 'compare') {
    inputFiles.push(...files);
  }
  if (cssOverride) {
    inputFiles.push(cssOverride);
  }
  for (const file of inputFiles) {
    if (!existsSync(resolve(REPOSITORY_ROOT, file))) {
      exitWithUsage(`no such file: ${file}`);
    }
  }

  if (command === 'capture' && files.length === 1) {
    return { command, engine, cssOverride, outputFile: files[0] };
  }
  if (command === 'compare' && files.length === 2 && Number.isInteger(limit) && limit > 0) {
    return { command, beforeFile: files[0], afterFile: files[1], limit };
  }
  exitWithUsage('expected "capture <file>" or "compare <before> <after>"');
}

// Runs inside the page. Pauses every animation at its start, so the busy spinner and the
// progress hatch read the same in every capture.
function stopAnimations() {
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = 0;
  }
}

// Runs inside the page. Reports whether the emulated condition took effect, since an engine
// that cannot emulate forced colours would otherwise record the plain page under that name.
function conditionApplies(condition) {
  if (condition.forcedColors) {
    return window.matchMedia('(forced-colors: active)').matches;
  }
  return true;
}

// Runs inside the page. Returns the property names once and, for each rendered box, its label
// and an index into a table of distinct value lists, because thousands of cells share a style.
// The catalogue's highlighted snippets are skipped below their <pre>: their tokens are styled by
// docs/docs.css alone, and they are most of the page's elements.
function readComputedStyles() {
  const PSEUDO_ELEMENTS = ['::before', '::after', '::marker'];
  const SKIPPED_SELECTOR = 'pre.docs-snippet *';
  const firstStyle = getComputedStyle(document.documentElement);
  const properties = [];
  for (const name of firstStyle) {
    if (!name.startsWith('--')) {
      properties.push(name);
    }
  }

  const distinctStyles = [];
  const styleIndexes = new Map();
  const boxes = [];

  function describe(element) {
    let label = element.localName;
    if (element.id) {
      return `${label}#${element.id}`;
    }
    const firstClass = element.classList[0];
    if (firstClass) {
      label += `.${firstClass}`;
    }
    const parent = element.parentElement;
    if (parent) {
      const position = Array.prototype.indexOf.call(parent.children, element) + 1;
      label += `:nth-child(${position})`;
    }
    return label;
  }

  function labelOf(element) {
    const parts = [];
    let current = element;
    while (current && parts.length < 4) {
      parts.unshift(describe(current));
      if (current.id) {
        break;
      }
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function pseudoRenders(element, pseudo, style) {
    if (pseudo === '::marker') {
      return getComputedStyle(element).display === 'list-item';
    }
    return style.content !== 'none' && style.content !== 'normal';
  }

  function record(key, label, style) {
    const values = [];
    for (const name of properties) {
      values.push(style.getPropertyValue(name));
    }
    const joined = values.join('\u0000');
    let styleIndex = styleIndexes.get(joined);
    if (styleIndex === undefined) {
      styleIndex = distinctStyles.length;
      distinctStyles.push(values);
      styleIndexes.set(joined, styleIndex);
    }
    boxes.push([key, label, styleIndex]);
  }

  const elements = document.querySelectorAll('*');
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.matches(SKIPPED_SELECTOR)) {
      continue;
    }
    const label = labelOf(element);
    record(String(i), label, getComputedStyle(element));
    for (const pseudo of PSEUDO_ELEMENTS) {
      const pseudoStyle = getComputedStyle(element, pseudo);
      if (pseudoRenders(element, pseudo, pseudoStyle)) {
        record(`${i}${pseudo}`, `${label}${pseudo}`, pseudoStyle);
      }
    }
  }

  return { properties, distinctStyles, boxes };
}

// --- Capture -----------------------------------------------------------------------

function loadPlaywright(engine) {
  // Playwright is a dev dependency of scripts/, resolved from there.
  const requireFromScripts = createRequire(resolve(REPOSITORY_ROOT, 'scripts/package.json'));
  const playwright = requireFromScripts('playwright');
  if (!playwright[engine]) {
    exitWithUsage(`unknown --browser ${engine}`);
  }
  return playwright[engine];
}

async function captureCondition(browser, pagePath, condition, options) {
  const page = await browser.newPage({ viewport: { width: condition.width, height: VIEWPORT_HEIGHT } });
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  if (options.cssOverride) {
    const cssPath = resolve(REPOSITORY_ROOT, options.cssOverride);
    await page.route(/\/dist\/cubicle\.css$/, (route) => route.fulfill({ path: cssPath, contentType: 'text/css' }));
  }
  await page.emulateMedia({
    media: condition.media ?? 'screen',
    forcedColors: condition.forcedColors ?? 'none',
  });
  await page.goto(pathToFileURL(resolve(REPOSITORY_ROOT, pagePath)).href);
  await page.evaluate(() => document.fonts.ready);
  if (condition.density) {
    await page.evaluate((density) => {
      document.documentElement.setAttribute('data-cb-density', density);
    }, condition.density);
  }
  await page.evaluate(stopAnimations);

  const applies = await page.evaluate(conditionApplies, condition);
  let result = { skipped: `${options.engine} cannot emulate this condition` };
  if (applies) {
    result = await page.evaluate(readComputedStyles);
  }
  await page.close();

  if (pageErrors.length > 0) {
    console.error(`${pagePath} ${condition.name}: page error: ${pageErrors[0]}`);
    process.exit(2);
  }
  return result;
}

// Moves one condition's distinct styles into the snapshot's shared tables: each value string is
// stored once in `values`, each style once in `styles` as a list of value ids. Conditions and
// pages share most of their styles, so this keeps the file small.
function internStyles(snapshot, tables, result) {
  const styleIds = [];
  for (const values of result.distinctStyles) {
    const valueIds = [];
    for (const value of values) {
      let valueId = tables.valueIds.get(value);
      if (valueId === undefined) {
        valueId = snapshot.values.length;
        snapshot.values.push(value);
        tables.valueIds.set(value, valueId);
      }
      valueIds.push(valueId);
    }
    const styleKey = valueIds.join(',');
    let styleId = tables.styleIds.get(styleKey);
    if (styleId === undefined) {
      styleId = snapshot.styles.length;
      snapshot.styles.push(valueIds);
      tables.styleIds.set(styleKey, styleId);
    }
    styleIds.push(styleId);
  }

  const boxes = [];
  for (const [key, label, styleIndex] of result.boxes) {
    boxes.push([key, label, styleIds[styleIndex]]);
  }
  return { properties: result.properties, boxes };
}

async function captureSnapshot(options) {
  const engine = loadPlaywright(options.engine);
  const browser = await engine.launch();
  const snapshot = {
    engine: options.engine,
    css: options.cssOverride ?? 'dist/cubicle.css',
    values: [],
    styles: [],
    conditions: {},
  };
  const tables = { valueIds: new Map(), styleIds: new Map() };

  for (const pagePath of PAGES) {
    for (const condition of CONDITIONS) {
      const conditionKey = `${pagePath} ${condition.name}`;
      const result = await captureCondition(browser, pagePath, condition, options);
      if (result.skipped) {
        snapshot.conditions[conditionKey] = result;
        console.log(`${conditionKey}: skipped (${result.skipped})`);
        continue;
      }
      snapshot.conditions[conditionKey] = internStyles(snapshot, tables, result);
      console.log(`${conditionKey}: ${result.boxes.length} boxes, ${result.distinctStyles.length} distinct styles`);
    }
  }
  await browser.close();

  const outputPath = resolve(REPOSITORY_ROOT, options.outputFile);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(snapshot));
  console.log(`wrote ${options.outputFile} (${options.engine}, ${snapshot.css})`);
}

// --- Compare -----------------------------------------------------------------------

function readSnapshot(file) {
  return JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, file), 'utf8'));
}

// Gives the style tables of a snapshot a lookup from style id to its value strings and to
// those strings joined, built on first use: value ids differ between snapshots, the strings do not.
function styleReader(snapshot) {
  const cache = new Map();
  return function readStyle(styleId) {
    let style = cache.get(styleId);
    if (!style) {
      const values = [];
      for (const valueId of snapshot.styles[styleId]) {
        values.push(snapshot.values[valueId]);
      }
      style = { values, joined: values.join('\u0000') };
      cache.set(styleId, style);
    }
    return style;
  };
}

// Turns one condition's boxes into a map from box key to { label, values, joined }, where
// `joined` lets two boxes with identical styles be matched without walking every property.
function indexBoxes(result, readStyle) {
  const boxesByKey = new Map();
  for (const [key, label, styleId] of result.boxes) {
    const style = readStyle(styleId);
    boxesByKey.set(key, { label, values: style.values, joined: style.joined });
  }
  return boxesByKey;
}

function differingProperties(beforeResult, beforeValues, afterResult, afterValues) {
  const afterValueByName = new Map();
  for (let i = 0; i < afterResult.properties.length; i++) {
    afterValueByName.set(afterResult.properties[i], afterValues[i]);
  }
  const differences = [];
  for (let i = 0; i < beforeResult.properties.length; i++) {
    const name = beforeResult.properties[i];
    const afterValue = afterValueByName.get(name) ?? '(missing)';
    if (beforeValues[i] !== afterValue) {
      differences.push({ name, text: `${name}: ${beforeValues[i]} -> ${afterValue}` });
    }
  }
  return differences;
}

// Returns the difference lines of one condition and, per property, how many boxes it changed.
function compareCondition(beforeResult, readBeforeStyle, afterResult, readAfterStyle) {
  const lines = [];
  const changedBoxesByProperty = new Map();
  const sameProperties = beforeResult.properties.join(',') === afterResult.properties.join(',');
  const beforeBoxes = indexBoxes(beforeResult, readBeforeStyle);
  const afterBoxes = indexBoxes(afterResult, readAfterStyle);

  for (const [key, beforeBox] of beforeBoxes) {
    const afterBox = afterBoxes.get(key);
    if (!afterBox) {
      lines.push(`${beforeBox.label}: no longer renders`);
      continue;
    }
    if (sameProperties && beforeBox.joined === afterBox.joined) {
      continue;
    }
    const differences = differingProperties(beforeResult, beforeBox.values, afterResult, afterBox.values);
    for (const difference of differences) {
      lines.push(`${beforeBox.label}: ${difference.text}`);
      const count = changedBoxesByProperty.get(difference.name) ?? 0;
      changedBoxesByProperty.set(difference.name, count + 1);
    }
  }
  for (const [key, afterBox] of afterBoxes) {
    if (!beforeBoxes.has(key)) {
      lines.push(`${afterBox.label}: renders now, did not before`);
    }
  }
  return { lines, changedBoxesByProperty };
}

function summariseProperties(changedBoxesByProperty) {
  const counts = [...changedBoxesByProperty.entries()];
  counts.sort((first, second) => second[1] - first[1]);
  const parts = [];
  for (const [name, count] of counts.slice(0, SUMMARY_PROPERTIES)) {
    parts.push(`${name} ${count}`);
  }
  if (counts.length > SUMMARY_PROPERTIES) {
    parts.push(`${counts.length - SUMMARY_PROPERTIES} more properties`);
  }
  return parts.join(', ');
}

function compareSnapshots(options) {
  const before = readSnapshot(options.beforeFile);
  const after = readSnapshot(options.afterFile);
  const readBeforeStyle = styleReader(before);
  const readAfterStyle = styleReader(after);
  if (before.engine !== after.engine) {
    console.log(`note: comparing ${before.engine} with ${after.engine}; engine differences will show`);
  }

  let differingConditions = 0;
  let comparedConditions = 0;
  for (const [conditionKey, beforeResult] of Object.entries(before.conditions)) {
    const afterResult = after.conditions[conditionKey];
    if (!afterResult) {
      console.log(`${conditionKey}: missing from ${options.afterFile}`);
      differingConditions++;
      continue;
    }
    if (beforeResult.skipped || afterResult.skipped) {
      console.log(`${conditionKey}: skipped (${beforeResult.skipped ?? afterResult.skipped})`);
      continue;
    }
    comparedConditions++;
    const { lines, changedBoxesByProperty } = compareCondition(beforeResult, readBeforeStyle, afterResult, readAfterStyle);
    if (lines.length === 0) {
      continue;
    }
    differingConditions++;
    console.log(`${conditionKey}: ${lines.length} differences`);
    if (changedBoxesByProperty.size > 0) {
      console.log(`  boxes changed per property: ${summariseProperties(changedBoxesByProperty)}`);
    }
    for (const line of lines.slice(0, options.limit)) {
      console.log(`  ${line}`);
    }
    if (lines.length > options.limit) {
      console.log(`  ... ${lines.length - options.limit} more (--limit)`);
    }
  }

  if (differingConditions === 0) {
    console.log(`snapshots match: ${comparedConditions} conditions compared`);
    return 0;
  }
  console.log(`snapshots differ in ${differingConditions} of ${Object.keys(before.conditions).length} conditions`);
  return 1;
}

// --- Main --------------------------------------------------------------------------

async function runSnapshot() {
  const options = parseArguments(process.argv);
  if (options.command === 'capture') {
    await captureSnapshot(options);
    return;
  }
  process.exitCode = compareSnapshots(options);
}

await runSnapshot();
