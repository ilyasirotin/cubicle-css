// WCAG 2.2 AA probes that scripts/verify-browser.mjs does not run, for the whole-framework audit.
// Development tool only; it changes nothing on disk.
//
// Run from the repository root (needs the dev dependencies of scripts/, see verify-browser.mjs):
//   node .claude/skills/cubicle-audit/scripts/wcag-probe.mjs [docs/index.html] [--browser chromium|firefox|webkit]
//        [--only target,reflow,resize,spacing,obscured] [--verbose] [--as-served] [--aria "<css selector>"]
//
//   target    2.5.8 Target Size (Minimum): every visible target under 24x24 CSS px, per density,
//             with the spacing exception applied (24px circles centred on undersized targets must
//             not meet another target or its circle). Links inside running text are exempt.
//   reflow    1.4.10 Reflow at 320 x 256 CSS px: page-level horizontal scroll, and the outermost
//             boxes that poke out of the viewport outside a scroll container.
//   resize    1.4.4 Resize Text: root font size at 200% (the kit sizes in rem) at 1360px, then
//             page-level sideways scroll and text clipped by its own box.
//   spacing   1.4.12 Text Spacing: the WCAG override (line 1.5, letters 0.12em, words 0.16em,
//             paragraphs 2em) at 1360 and 360px, then text clipped by its own box.
//   obscured  2.4.11 Focus Not Obscured (Minimum): Tab through the page at 1360 x 800 and at
//             360 x 640 and list focused elements entirely covered by another box
//             (sticky heads, fixed toasts, the app frame).
//   --verbose prints every finding with its location, not one example per group.
//   --as-served measures the page as served. By default closed <details> are opened and hidden
//             ARIA tab panels shown, so the demos inside them count.
//   --aria    prints the accessibility tree (Playwright ariaSnapshot) of the first match of a
//             selector, for reading roles, names and states (4.1.2) instead of guessing them.
//
// Each finding has a signature (tag, first cb-* class, role) and a location (#id of the nearest
// ancestor with an id, usually the catalogue demo or section). Results are measurements to judge,
// not verdicts: a 20px table key may pass by spacing, a clipped box may be a deliberate
// truncation. Exit code 0 always.

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- Configuration -----------------------------------------------------------------

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_PAGE = 'docs/index.html';
const ALL_PROBES = 'target,reflow,resize,spacing,obscured';

const DESKTOP_VIEWPORT = { width: 1360, height: 800 };
const REFLOW_VIEWPORT = { width: 320, height: 256 };
const SPACING_WIDTHS = [1360, 360];
const OBSCURED_VIEWPORTS = [[1360, 800], [360, 640]];
const DENSITIES = ['compact', 'default', 'comfortable'];
// Tab presses per walk at most, in case focus never leaves the page.
const MAX_TAB_STOPS = 2000;
// Places listed per group of findings before "+N more".
const PLACES_SHOWN = 4;

const RESIZE_STYLE = 'html { font-size: 200% !important; }';
const TEXT_SPACING_STYLE = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-block-end: 2em !important; }';

// In-page helpers, inlined into each evaluate: a signature, a location and a short text for an
// element.
const IN_PAGE_HELPERS = `
  const signatureOf = (element) => {
    const firstCubicleClass = [...element.classList].find((className) => className.startsWith('cb-'));
    const role = element.getAttribute('role');
    const typePart = element.localName === 'input' ? '[type=' + element.type + ']' : '';
    const classPart = firstCubicleClass ? '.' + firstCubicleClass : '';
    const rolePart = role ? '[role=' + role + ']' : '';
    return element.localName + typePart + classPart + rolePart;
  };
  const locationOf = (element) => '#' + (element.parentElement?.closest('[id]')?.id ?? '');
  const shortTextOf = (element) => {
    const text = element.textContent || element.getAttribute('aria-label') || '';
    return text.replace(/\\s+/g, ' ').trim().slice(0, 30);
  };
`;

// Text clipped by its own box (overflow hidden or clip), ellipsis truncation excepted.
const CLIPPED_TEXT_PROBE = `(() => {${IN_PAGE_HELPERS}
  const clips = (overflow) => overflow === 'hidden' || overflow === 'clip';
  const hasOwnText = (element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
  const isClipped = (element) => {
    if (element.closest('.docs-nav, pre, [hidden]') || element.matches('.cb-sr-only, [data-cb-sr]')) {
      return false;
    }
    if (!hasOwnText(element)) {
      return false;
    }
    const style = getComputedStyle(element);
    const clippedVertically = clips(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    const clippedHorizontally = clips(style.overflowX) && element.scrollWidth > element.clientWidth + 1 && style.textOverflow !== 'ellipsis';
    return (clippedVertically || clippedHorizontally) && element.getBoundingClientRect().width > 0;
  };
  const findings = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (!isClipped(element)) {
      continue;
    }
    const overTall = element.scrollHeight - element.clientHeight;
    const overWide = element.scrollWidth - element.clientWidth;
    findings.push({
      sig: signatureOf(element),
      at: locationOf(element),
      text: shortTextOf(element),
      detail: 'over by ' + overTall + 'px tall, ' + overWide + 'px wide',
    });
  }
  return findings;
})()`;

// 2.5.8: undersized targets whose 24px circle meets another target or its circle.
const TARGET_SIZE_PROBE = `(() => {${IN_PAGE_HELPERS}
  const TARGETS = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=menuitem], [role=treeitem], [role=option], [tabindex]:not([tabindex="-1"])';
  const isLinkInText = (element) => element.localName === 'a'
    && [...element.parentElement.childNodes].some((node) => node !== element && node.nodeType === 3 && node.textContent.trim());
  const isMeasured = (element) => {
    if (element.closest('.docs-nav, pre, [inert], [hidden]') || isLinkInText(element)) {
      return false;
    }
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
  };

  const targets = [];
  for (const element of document.querySelectorAll(TARGETS)) {
    if (!isMeasured(element)) {
      continue;
    }
    // A native control inside its label: the label is the target.
    const label = element.matches('input') ? element.closest('label') : null;
    const host = label ?? element;
    const box = host.getBoundingClientRect();
    targets.push({
      element,
      box,
      isSmall: box.width < 23.5 || box.height < 23.5,
      centre: [box.left + box.width / 2, box.top + box.height / 2],
    });
  }

  const distanceToBox = ([pointX, pointY], box) => {
    const dx = Math.max(box.left - pointX, 0, pointX - box.right);
    const dy = Math.max(box.top - pointY, 0, pointY - box.bottom);
    return Math.hypot(dx, dy);
  };
  const clashes = (target, other) => {
    if (other === target || other.box === target.box) {
      return false;
    }
    if (other.element.contains(target.element) || target.element.contains(other.element)) {
      return false;
    }
    if (other.isSmall) {
      return Math.hypot(other.centre[0] - target.centre[0], other.centre[1] - target.centre[1]) < 24;
    }
    return distanceToBox(target.centre, other.box) < 12;
  };

  const findings = [];
  for (const target of targets) {
    if (!target.isSmall) {
      continue;
    }
    const clash = targets.find((other) => clashes(target, other));
    if (clash) {
      const size = Math.round(target.box.width) + 'x' + Math.round(target.box.height);
      findings.push({
        sig: signatureOf(target.element),
        at: locationOf(target.element),
        text: shortTextOf(target.element),
        detail: size + ' next to ' + signatureOf(clash.element),
      });
    }
  }
  return findings;
})()`;

// 1.4.10: the outermost boxes whose right edge passes the viewport outside a scroll container.
const REFLOW_PROBE = `(() => {${IN_PAGE_HELPERS}
  const viewportWidth = document.documentElement.clientWidth;
  const isInScroller = (element) => {
    for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(ancestor).overflowX)) {
        return true;
      }
    }
    return false;
  };
  const isPastEdge = (element) => element.getBoundingClientRect().right > viewportWidth + 1;
  const findings = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (element.getBoundingClientRect().width <= 0 || !isPastEdge(element) || isInScroller(element)) {
      continue;
    }
    if (element.parentElement && isPastEdge(element.parentElement)) {
      continue;
    }
    findings.push({
      sig: signatureOf(element),
      at: locationOf(element),
      text: shortTextOf(element),
      detail: 'right edge at ' + Math.round(element.getBoundingClientRect().right) + 'px',
    });
  }
  return findings;
})()`;

// 2.4.11: the focused element, and whether other boxes cover all five sample points of it.
// "end" means focus left the page; "skip" means a dialog or popover holds focus, or the element
// has no box.
const FOCUS_COVER_PROBE = `(() => {${IN_PAGE_HELPERS}
  const element = document.activeElement;
  if (!element || element === document.body) {
    return { end: true };
  }
  if (element.closest('dialog[open], :popover-open')) {
    return { skip: true };
  }
  const box = element.getBoundingClientRect();
  if (!box.width || !box.height) {
    return { skip: true };
  }
  const samplePoints = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([fractionX, fractionY]) => {
    return [box.left + box.width * fractionX, box.top + box.height * fractionY];
  });
  const covers = (topElement) => {
    if (!topElement) {
      return true;
    }
    const isLabelOfElement = element.labels && [...element.labels].includes(topElement);
    return !element.contains(topElement) && !topElement.contains(element) && topElement.control !== element && !isLabelOfElement;
  };
  const topElements = samplePoints.map(([pointX, pointY]) => document.elementFromPoint(pointX, pointY));
  const entirelyCovered = topElements.every(covers);
  const documentPosition = [...document.querySelectorAll('*')].indexOf(element);
  return {
    key: signatureOf(element) + '@' + documentPosition,
    all: entirelyCovered,
    sig: signatureOf(element),
    at: locationOf(element),
    text: shortTextOf(element),
    detail: entirelyCovered && topElements[0] ? 'under ' + signatureOf(topElements[0]) : '',
  };
})()`;

// --- Helpers -----------------------------------------------------------------------

// Reads the command line; options are removed as they are read, so the first word left is the page.
function parseArguments(argv) {
  const remaining = argv.slice(2);
  const takeOption = (name, fallback) => {
    const index = remaining.indexOf(name);
    if (index < 0) {
      return fallback;
    }
    const [, value] = remaining.splice(index, 2);
    return value ?? '';
  };
  const takeFlag = (name) => {
    const index = remaining.indexOf(name);
    if (index < 0) {
      return false;
    }
    remaining.splice(index, 1);
    return true;
  };

  const engine = takeOption('--browser', 'chromium');
  const probes = takeOption('--only', ALL_PROBES).split(',').filter(Boolean);
  const ariaSelector = takeOption('--aria', null);
  const verbose = takeFlag('--verbose');
  const asServed = takeFlag('--as-served');
  const pageUrl = pathToFileURL(resolve(REPOSITORY_ROOT, remaining[0] ?? DEFAULT_PAGE)).href;
  return { engine, probes, ariaSelector, verbose, asServed, pageUrl };
}

// Prints a titled list of findings: every finding with --verbose, otherwise one line per
// signature (most frequent first) with an example and the places it occurs.
function printFindings(title, findings, verbose) {
  console.log(`${title}: ${findings.length}`);
  if (verbose) {
    for (const finding of findings) {
      console.log(`    ${finding.sig}  ${finding.at}  "${finding.text}"  ${finding.detail}`);
    }
    return;
  }

  const groups = new Map();
  for (const finding of findings) {
    const group = groups.get(finding.sig) ?? { count: 0, example: finding, places: new Set() };
    group.count += 1;
    group.places.add(finding.at);
    groups.set(finding.sig, group);
  }
  const sortedGroups = [...groups].sort((first, second) => second[1].count - first[1].count);
  for (const [signature, group] of sortedGroups) {
    const places = [...group.places];
    const shownPlaces = places.slice(0, PLACES_SHOWN).join(' ');
    const morePlaces = places.length > PLACES_SHOWN ? ` +${places.length - PLACES_SHOWN}` : '';
    const count = String(group.count).padStart(4);
    console.log(`    ${count} ${signature}  e.g. "${group.example.text}" ${group.example.detail}  in ${shownPlaces}${morePlaces}`);
  }
}

// Loads the page; unless --as-served, opens every <details> and shows every hidden tab panel.
async function loadPage(page, options) {
  await page.goto(options.pageUrl);
  if (options.asServed) {
    return;
  }
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details:not([open])')) {
      details.open = true;
    }
    for (const panel of document.querySelectorAll('[role="tabpanel"][hidden]')) {
      panel.removeAttribute('hidden');
    }
  });
}

function measureSidewaysScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// --- Probes ------------------------------------------------------------------------

async function probeTargetSize(page, options) {
  console.log('2.5.8 Target size: undersized targets that fail the spacing exception');
  for (const density of DENSITIES) {
    await page.evaluate((densityName) => {
      if (densityName === 'default') {
        document.documentElement.removeAttribute('data-cb-density');
      } else {
        document.documentElement.dataset.cbDensity = densityName;
      }
    }, density);
    const findings = await page.evaluate(TARGET_SIZE_PROBE);
    printFindings(`  ${density}`, findings, options.verbose);
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-cb-density'));
}

async function probeReflow(page, options) {
  await page.setViewportSize(REFLOW_VIEWPORT);
  const findings = await page.evaluate(REFLOW_PROBE);
  console.log(`\n1.4.10 Reflow at 320px: page scrolls sideways by ${await measureSidewaysScroll(page)}px`);
  printFindings('  outermost boxes past the edge outside a scroller', findings, options.verbose);
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

async function probeResizeText(page, options) {
  const style = await page.addStyleTag({ content: RESIZE_STYLE });
  console.log(`\n1.4.4 Resize text (root 200%) at 1360px: page scrolls sideways by ${await measureSidewaysScroll(page)}px`);
  printFindings('  boxes that clip their text', await page.evaluate(CLIPPED_TEXT_PROBE), options.verbose);
  await style.evaluate((styleElement) => styleElement.remove());
}

async function probeTextSpacing(page, options) {
  const style = await page.addStyleTag({ content: TEXT_SPACING_STYLE });
  for (const width of SPACING_WIDTHS) {
    await page.setViewportSize({ width, height: DESKTOP_VIEWPORT.height });
    console.log('');
    const findings = await page.evaluate(CLIPPED_TEXT_PROBE);
    printFindings(`1.4.12 Text spacing at ${width}px, boxes that clip their text`, findings, options.verbose);
  }
  await style.evaluate((styleElement) => styleElement.remove());
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

async function probeFocusObscured(page, options) {
  // WebKit, like Safari, moves Tab between form controls only; Option+Tab reaches every control.
  const tabKey = options.engine === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (const [width, height] of OBSCURED_VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await loadPage(page, options);
    const covered = [];
    const seenStops = new Set();
    let lastStop = null;
    // Date and time fields take one Tab per segment, so a repeat of the last stop is not the end.
    for (let i = 0; i < MAX_TAB_STOPS; i++) {
      await page.keyboard.press(tabKey);
      const stop = await page.evaluate(FOCUS_COVER_PROBE);
      if (stop.end) {
        break;
      }
      if (stop.skip) {
        await page.keyboard.press('Escape');
        continue;
      }
      if (stop.key === lastStop) {
        continue;
      }
      if (seenStops.has(stop.key)) {
        break;
      }
      seenStops.add(stop.key);
      lastStop = stop.key;
      if (stop.all) {
        covered.push(stop);
      }
    }
    console.log('');
    printFindings(`2.4.11 Focus not obscured at ${width}px (${seenStops.size} stops), entirely covered`, covered, options.verbose);
  }
}

async function printAccessibilityTree(page, options) {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  console.log(`\nAccessibility tree of ${options.ariaSelector}:`);
  console.log(await page.locator(options.ariaSelector).first().ariaSnapshot());
}

// --- Main --------------------------------------------------------------------------

async function runProbes() {
  const options = parseArguments(process.argv);
  // Playwright is a dev dependency of scripts/, resolved from there.
  const requireFromScripts = createRequire(resolve(REPOSITORY_ROOT, 'scripts/package.json'));
  const playwright = requireFromScripts('playwright');
  if (!playwright[options.engine]) {
    console.error(`unknown --browser ${options.engine}`);
    process.exit(2);
  }

  // Firefox moves Tab between form controls only unless told otherwise (as in verify-browser.mjs).
  const launchOptions = options.engine === 'firefox' ? { firefoxUserPrefs: { 'accessibility.tabfocus': 7 } } : {};
  const browser = await playwright[options.engine].launch(launchOptions);
  const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
  await loadPage(page, options);

  if (options.probes.includes('target')) {
    await probeTargetSize(page, options);
  }
  if (options.probes.includes('reflow')) {
    await probeReflow(page, options);
  }
  if (options.probes.includes('resize')) {
    await probeResizeText(page, options);
  }
  if (options.probes.includes('spacing')) {
    await probeTextSpacing(page, options);
  }
  if (options.probes.includes('obscured')) {
    await probeFocusObscured(page, options);
  }
  if (options.ariaSelector) {
    await printAccessibilityTree(page, options);
  }

  await browser.close();
}

await runProbes();
