// Cubicle browser verification. Development tool only; not part of the shipped kit.
//
// Setup (once):   cd scripts && npm install && npx playwright install chromium firefox webkit
// Run:            node scripts/verify-browser.mjs [docs/index.html] [--browser chromium|firefox|webkit]
//                                                 [--css dist/cubicle.min.css] [--js dist/cubicle.min.js]
//                                                 [--only forms,keyboard] [--shots tmp/shots/x]
//                                                 [--theme glacier]
//                 --browser picks the engine (chromium by default).
//                 --only runs the named groups of checks (GROUPS below) plus the console check,
//                 for quick runs while working on one part; the full run is the verdict.
//                 --shots writes the screenshots to another directory (tmp/shots by default),
//                 so runs can go side by side (scripts/verify-matrix.mjs does that); --shots none
//                 saves none, for quick runs.
//                 --css / --js serve the given file in place of dist/cubicle.css / dist/cubicle.js
//                 (to check the minified build). The repository is served over local HTTP, so
//                 these overrides hold in every engine; check 0 fails when one was not served.
//                 --theme serves the page with data-cb-theme="<name>" on <html>, so every check runs
//                 in that palette; the catalogue's contrast table (check 22) documents the default
//                 palette and is not compared then.
//                 Known engine limits (ENGINE_LIMITS below) are reported as "skip", with the reason.
// Output:         a pass/fail report and screenshots in tmp/shots/ (git-ignored, or --shots), including
//                 state-<element>-<rest|hover|focus|active>.png for every interactive demo control
//                 badges-<width>.png and tables-<width>.png of those sections, and
//                 tables-sticky-360.png of the wide grid scrolled sideways, and
//                 alerts-<width>.png, tabs-<width>.png, nav-<width>.png, meters-<width>.png
//                 segmented-<width>.png, details-<width>.png, dialog-<id>.png and
//                 pagination-<width>.png and utilities-<width>.png, and
//                 forms-matrix.png of the native form-control fixture, props-<width>.png and
//                 busy-<n>-<width>.png of each busy container's demo, empty-<width>.png,
//                 toasts-<width>.png, menu-<down|up|nojs>-<width>.png, log-<width>.png and
//                 forced-<section>.png of sections in forced colours; print-example.pdf (Chromium).
//                 The tokens group drives the token field with and without the script.
//                 The targets group measures WCAG 2.5.8 target size at default and comfortable density
//                 and checks the catalogue's target-size table at all three densities.
//                 Contrast pairs live in scripts/contrast-pairs.mjs, shared with the catalogue table.
// Exit code:      0 when every check passes, 1 otherwise.


import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measurePairs, contrastRatio, colourLabel } from './contrast-pairs.mjs';

// =====================================================================================
// Configuration
// =====================================================================================

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINES = { chromium, firefox, webkit };
// The pages are served over local HTTP, not file://: Firefox does not route file:// requests,
// so --css, --js and --theme are applied by the server, the same way in every engine.
const SERVER_HOST = '127.0.0.1';
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const DEFAULT_ENGINE = 'chromium';
const DEFAULT_PAGE = 'docs/index.html';
const DEFAULT_SHOTS_DIRECTORY = 'tmp/shots';

// Groups of checks, in run order; --only picks some of them.
const GROUPS = [
  'layout', 'controls', 'contrast', 'states', 'script', 'badges', 'tables', 'alerts', 'tabs', 'nav', 'meters',
  'segmented', 'details', 'dialogs', 'pagination', 'utilities', 'frame', 'density', 'keyboard', 'snippets', 'forms',
  'props', 'busy', 'empty', 'toasts', 'menu', 'log', 'split', 'forced', 'rtl', 'recipes', 'print', 'targets', 'tokens',
  'themes', 'example',
];

// The named themes of dist/cubicle.css (2.10), the one :root paints, and what --theme accepts.
const THEME_NAMES = ['steel', 'glacier', 'industrial', 'monochrome'];
const DEFAULT_THEME = 'glacier';
const THEME_NAME_PATTERN = /^[a-z-]+$/;
// The palette a theme redefines (the backdrop and the shades derive from it, section 2.9).
const PALETTE_TOKENS = [
  '--cb-bg-canvas', '--cb-bg-surface', '--cb-bg-raised', '--cb-bg-btn', '--cb-bg-recessed', '--cb-bg-header',
  '--cb-bg-zebra', '--cb-bg-hover', '--cb-bg-selected',
  '--cb-text-main', '--cb-text-muted', '--cb-text-disabled', '--cb-text-inverse',
  '--cb-border-subtle', '--cb-border-main', '--cb-border-strong',
  '--cb-accent', '--cb-ok', '--cb-warn', '--cb-danger', '--cb-info',
];
// Check 39: surface pairs that must stay apart (RGB distance, colourDistance), so zebra, hover,
// selection, header bars and wells stay visible; and the status tones, so LEDs stay apart. Steel's
// closest pairs are zebra/surface (10) and warn/danger (52).
const LAYER_PAIRS = [
  ['--cb-bg-canvas', '--cb-bg-surface'], ['--cb-bg-header', '--cb-bg-surface'], ['--cb-bg-zebra', '--cb-bg-surface'],
  ['--cb-bg-hover', '--cb-bg-zebra'], ['--cb-bg-selected', '--cb-bg-hover'], ['--cb-bg-recessed', '--cb-bg-surface'],
];
const LAYER_MIN_DISTANCE = 8;
const STATUS_TONES_FOR_LAMPS = ['--cb-ok', '--cb-warn', '--cb-danger', '--cb-info'];
const LAMP_MIN_DISTANCE = 40;

// The main page's viewport, and the widths checked for layout and section screenshots.
const DESKTOP_VIEWPORT = { width: 1360, height: 900 };
const PHONE_WIDTH = 360;
const SECTION_HEIGHT = 900;
// How long a check waits for something the page does on its own (a live region filling on the next
// frame, a transition ending) before it judges. Generous, because a loaded CI machine runs frames late.
const ANNOUNCEMENT_WAIT_MS = 1000;
const TRANSITION_WAIT_MS = 1000;
const SCROLL_WAIT_MS = 1000;
// What the live region says after a successful copy ("Copied to clipboard").
const COPIED_ANNOUNCEMENT = /copied/i;

// Differences that come from an engine or from automation, not from the stylesheet. A failing
// check whose name matches one of these, in that engine, is reported as "skip" with the reason.
const ENGINE_LIMITS = [
  {
    engine: 'firefox',
    check: /^meter ruler:/,
    reason: 'Firefox paints the meter track on the element itself, so there is no ruler strip for ticks and marks',
  },
  {
    engine: 'webkit',
    check: /reaches the clipboard|falls back when the async clipboard/,
    reason: 'WebKit refuses clipboard reads from automation, so the copied text cannot be compared',
  },
  {
    engine: 'webkit',
    check: /^selected options in a multi-select/,
    reason: 'WebKit paints list-box selection natively and ignores option backgrounds',
  },
  {
    engine: 'webkit',
    check: /^Escape clears a search field/,
    reason: 'WebKit does not clear a search field on Escape',
  },
  {
    engine: 'webkit',
    check: /^states of input\.cb-input\[type=color\]/,
    reason: 'WebKit leaves colour fields out of the Tab order, even with Option+Tab',
  },
  {
    engine: 'firefox',
    check: /^states of input\.cb-input\[type=(date|time|datetime-local)\]\[readonly\]/,
    reason: 'Firefox does not let a readonly date or time field take focus',
  },
  {
    engine: 'firefox',
    check: /^forced colours: selected list-box options/,
    reason: 'Firefox paints list-box selection itself in forced colours (a light grey), not option backgrounds',
  },
  {
    engine: 'webkit',
    check: /^forced colours: selected list-box options/,
    reason: 'WebKit paints list-box selection natively and ignores option backgrounds',
  },
];

// Date and time fields: Tab walks their segments, and WebKit never matches :focus-visible on them
// (the stylesheet draws the same ring on :focus there), so focus checks accept :focus.
const SEGMENTED_DATE_FIELDS = 'input:is([type="date"], [type="time"], [type="datetime-local"], [type="month"], [type="week"])';

// Check 3: the control types whose first visible instance must show the focus ring.
const FOCUS_RING_CONTROLS = ['a[href]', 'button:not([disabled])', 'input:not([type=hidden])', 'select', 'textarea', 'summary'];
// Check 4: the first plain button key (a link key would navigate, a modal opener open).
const PLAIN_BUTTON = 'button.cb-btn[type="button"]:not([disabled], [aria-disabled], [data-cb-modal], [data-cb-dismiss], [popovertarget]):visible';
// Check 7: every enabled, idle interactive control inside a catalogue demo.
const DEMO_CONTROLS = '.docs-demo :is(button, a[href], input, select, textarea, summary):not([disabled], [aria-disabled="true"], [aria-busy="true"])';
// Check 7: attributes that make a control look different, so each value gets its own capture.
const LOOK_ATTRIBUTES = ['type', 'aria-pressed', 'aria-invalid', 'readonly'];
// Check 9: the controls cubicle.js drives with data-cb-* attributes.
const ACTIONS = '[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-select-all], [data-cb-dismiss], [data-cb-modal], [data-cb-toggle]';
const ACTION_ATTRIBUTES = ['data-cb-copy', 'data-cb-reveal', 'data-cb-download', 'data-cb-select-all', 'data-cb-dismiss', 'data-cb-modal', 'data-cb-toggle'];
// Check 10: badges and LEDs in the demos.
const INDICATORS = '.docs-demo :is(.cb-badge, .cb-led)';
// Check 10: chip frames are measured at these [density, viewport width] pairs.
const CHIP_FRAME_CASES = [
  ['compact', 1360], ['default', 1360], ['comfortable', 1360],
  ['compact', 360], ['default', 360], ['comfortable', 360],
];
// Check 11: focusable table wrappers and the outline offset each must draw (outside on a sticky
// table's wrapper, inside on any other).
const WRAPPER_RING_OFFSETS = [
  ['.docs-demo .cb-table-wrap[tabindex="0"]:has(> .cb-table--sticky)', '1px'],
  ['.docs-demo .cb-table-wrap[tabindex="0"]:not(:has(> .cb-table--sticky))', '-3px'],
];
// Check 15: the tones a meter pixel is matched against (--cb-<name>).
const METER_TONES = ['ok', 'warn', 'danger', 'accent', 'border-main', 'text-main', 'bg-surface'];
// Check 24: [control, small key, table row, panel head] heights in px per density.
const DENSITY_SIZES = {
  compact: [22, 18, 24, 26],
  default: [26, 20, 28, 32],
  comfortable: [30, 24, 32, 38],
};
// Check 25: every single-line input type of the native form fixture, with its value.
const FORM_FIELD_VALUES = {
  text: 'gw-eu-1',
  password: 'secret',
  search: 'peer',
  email: 'soc@corp.example.net',
  url: 'https://idp.corp.example.net',
  tel: '+1 555 0100',
  number: '51820',
  date: '2026-11-01',
  time: '23:30',
  'datetime-local': '2026-11-01T23:30',
  month: '2026-11',
  week: '2026-W44',
  file: '',
  color: '#1e4b85',
};
// Check 27: containers that can be busy.
const BUSY = '[aria-busy="true"]:is(.cb-panel__body, .cb-props, .cb-table, .cb-table > tbody)';
// Check 30: the key of the probe menu.
const MENU_KEY = '.docs-demo [popovertarget="m-peer-1"]';
// Check 33: states that must take Highlight / HighlightText in forced colours...
const FORCED_STATE_SELECTORS = [
  '.cb-btn[aria-pressed="true"]:not(:disabled)',
  '.cb-segmented > .cb-btn:has(> input:checked:not(:disabled))',
  '.cb-pagination .cb-btn[aria-current="page"]',
  '.cb-table tbody tr[aria-selected="true"]:not([aria-busy="true"] tr) > td',
  '.cb-table tbody tr:has(> td > .cb-check:checked):not([aria-busy="true"] tr) > td',
  '.cb-nav__link[aria-current="page"]',
  '[role="treeitem"][aria-selected="true"] > .cb-nav__link',
  '.cb-tabs__tab[aria-selected="true"]',
];
// ...unavailable controls that must take GrayText...
const FORCED_DISABLED_SELECTORS = [
  '.cb-btn:disabled',
  '.cb-btn[aria-disabled="true"]',
  '.cb-input:disabled',
  '.cb-input[aria-disabled="true"]',
  '.cb-select:disabled',
  '.cb-nav__link[aria-disabled="true"]',
  '.cb-tabs__tab:disabled',
  '.cb-table tbody tr[aria-disabled="true"] > td',
  '.cb-menu__item:disabled',
  '.cb-choice:has(:disabled)',
  '.cb-fieldset:disabled > legend',
];
// ...and the sections shot in forced colours.
const FORCED_SHOT_SECTIONS = ['fields', 'badges', 'meters', 'buttons', 'tables', 'nav'];
// Check 35: the recipe filter bar, and the recipes shot.
const RECIPE_FILTER_FORM = '#recipes-filter ~ .docs-demo form[role="search"]';
const RECIPE_SHOT_SECTIONS = [
  'recipes-filter', 'recipes-inspector', 'recipes-signin', 'recipes-account', 'recipes-bulk', 'recipes-permissions',
  'recipes-health', 'recipes-password', 'recipes-mfa', 'recipes-timeout', 'recipes-errors',
];
// Check 35b: the account menu of the catalogue's recipe and of the example's top bar.
const ACCOUNT_MENUS = ['#ra-menu', '#x-account-menu'];
// Check 36: what print hides.
const HIDDEN_IN_PRINT = '[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-dismiss], [data-cb-modal], [data-cb-toggle], .cb-chip__remove, .cb-toasts';
// Check 36b: the rows of the catalogue's target-size table, in its order.
const TARGET_ROWS = [
  { name: 'Navigation and tree rows', sel: '#nav .cb-nav__link' },
  { name: 'Stacked check boxes and radios', sel: '#fields .cb-stack--tight .cb-choice' },
  { name: 'Attached page keys', sel: '#pagination .cb-btn' },
  { name: 'Small keys in table rows', sel: '#tables .cb-table .cb-btn--sm' },
  { name: 'Keys stacked in a column', sel: '#secrets .cb-secret__actions .cb-btn' },
  { name: 'Keys in a row', sel: '#buttons .cb-btn:not(.cb-btn--sm)' },
  { name: 'Chip remove keys', sel: '#badges .cb-chip__remove' },
];
// Check 36c: the catalogue token field the behaviour checks drive.
const TOKEN_ENTRY = '#tk-ips';

// =====================================================================================
// Command line
// =====================================================================================

// Reads the options. Each recognised option is removed as it is read; the first word left is
// the page. Values are checked by runChecks(), in the order the tool has always checked them.
function parseArguments(argv) {
  const remaining = argv.slice(2);
  // The value after `name`, or undefined (option given without a value), or `absent` when the
  // option is not given at all.
  const takeOption = (name, absent) => {
    const index = remaining.indexOf(name);
    if (index < 0) {
      return absent;
    }
    const [, value] = remaining.splice(index, 2);
    return value;
  };

  const cssOverride = takeOption('--css', null);
  const jsOverride = takeOption('--js', null);
  const engine = takeOption('--browser', DEFAULT_ENGINE);
  const shotsArgument = takeOption('--shots', DEFAULT_SHOTS_DIRECTORY) ?? '';
  const onlyArgument = takeOption('--only', null);
  const only = onlyArgument === null ? null : (onlyArgument ?? '').split(',').filter(Boolean);
  const theme = takeOption('--theme', null);

  return {
    cssOverride: cssOverride === null ? null : resolve(REPOSITORY_ROOT, cssOverride ?? ''),
    jsOverride: jsOverride === null ? null : resolve(REPOSITORY_ROOT, jsOverride ?? ''),
    engine,
    shotsArgument,
    only,
    theme: theme === null ? null : theme ?? '',
    pagePath: resolve(REPOSITORY_ROOT, remaining[0] ?? DEFAULT_PAGE),
  };
}

// =====================================================================================
// Helpers
// =====================================================================================

// Serves the repository on a free local port, with the overrides of the command line: the --css
// and --js files in place of dist/cubicle.css and dist/cubicle.js, and the page under test with
// data-cb-theme on <html> for --theme. `served` counts each override delivered, so a run can tell
// that its options took effect. Resolves to { server, origin, served }.
function startRepositoryServer(options) {
  const served = { css: 0, js: 0, theme: 0 };
  const overrideFiles = new Map();
  if (options.cssOverride) {
    overrideFiles.set(resolve(REPOSITORY_ROOT, 'dist/cubicle.css'), ['css', options.cssOverride]);
  }
  if (options.jsOverride) {
    overrideFiles.set(resolve(REPOSITORY_ROOT, 'dist/cubicle.js'), ['js', options.jsOverride]);
  }

  const handleRequest = (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://host').pathname);
    const filePath = resolve(REPOSITORY_ROOT, `.${requestPath}`);
    const insideRepository = filePath === REPOSITORY_ROOT || filePath.startsWith(REPOSITORY_ROOT + sep);
    if (!insideRepository || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    const contentType = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
    let body = null;
    const override = overrideFiles.get(filePath);
    if (override) {
      const [kind, overridePath] = override;
      served[kind] += 1;
      body = readFileSync(overridePath);
    } else if (options.theme && filePath === options.pagePath) {
      served.theme += 1;
      body = readFileSync(filePath, 'utf8').replace('<html', `<html data-cb-theme="${options.theme}"`);
    } else {
      body = readFileSync(filePath);
    }
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(body);
  };

  const server = createServer(handleRequest);
  return new Promise((started) => {
    server.listen(0, SERVER_HOST, () => {
      started({ server, origin: `http://${SERVER_HOST}:${server.address().port}`, served });
    });
  });
}

// Reading the clipboard from automation is refused in WebKit; null means "could not read".
function readClipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
}

// A control inside an idle ARIA tab panel, a closed <details> or a closed popover menu (as on the
// example screen) is shown first: its tab is clicked, its details and its menu opened.
function exposeControl(page, selector) {
  return page.evaluate((controlSelector) => {
    const control = document.querySelector(controlSelector);
    for (let ancestor = control; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.matches('[role="tabpanel"][hidden]')) {
        document.querySelector(`[role="tab"][aria-controls="${ancestor.id}"]`)?.click();
      }
      if (ancestor.matches('details:not([open])')) {
        ancestor.open = true;
      }
    }
    // A popover (a row's action menu) opens once its tab panel shows.
    control.closest('[popover]:not(:popover-open)')?.showPopover();
  }, selector);
}

// Opens every hidden ARIA tab panel and every closed <details> of a page, so the content behind
// them is laid out and measured.
function openEveryPanel() {
  for (const panel of document.querySelectorAll('[role="tabpanel"][hidden]')) {
    panel.removeAttribute('hidden');
  }
  for (const details of document.querySelectorAll('details:not([open])')) {
    details.open = true;
  }
}

// Resolves once running CSS transitions (--cb-duration) have ended: a frame for the style to
// change, the transitions' end, then a frame for the paint.
function settleTransitions(page) {
  return page.evaluate(() => new Promise((done) => {
    requestAnimationFrame(() => {
      const transitions = document.getAnimations().filter((animation) => animation instanceof CSSTransition);
      const finished = transitions.map((transition) => transition.finished.catch(() => {}));
      Promise.all(finished).then(() => requestAnimationFrame(done));
    });
  }));
}

function centreOf(box) {
  return [box.x + box.width / 2, box.y + box.height / 2];
}

// One report line: status, name, detail and, for an engine limit, the reason.
function formatResult(result, engine) {
  let status = result.ok ? 'ok  ' : 'FAIL';
  if (result.skip) {
    status = 'skip';
  }
  const detail = result.detail ? '  (' + result.detail + ')' : '';
  const limit = result.skip ? `  [${engine}: ${result.skip}]` : '';
  return `${status}  ${result.name}${detail}${limit}`;
}

// =====================================================================================
// Run context
// =====================================================================================

// Everything the check groups share: the engine and its keys, the browser, the main page, the
// result list and the screenshot writer. Created once by runChecks().
async function createRun(options) {
  const { engine } = options;
  // --shots none saves no screenshot (pixel checks still take theirs in memory) and skips the
  // width changes made only for them, keeping the last width, which later checks start from.
  const saving = options.shotsArgument !== 'none';
  const shotsDirectory = saving ? resolve(REPOSITORY_ROOT, options.shotsArgument) : null;
  const { server, origin, served } = await startRepositoryServer(options);
  const pageUrl = `${origin}/${relative(REPOSITORY_ROOT, options.pagePath).split(sep).join('/')}`;
  const results = [];

  const check = (ok, name, detail = '') => {
    const limit = !ok && ENGINE_LIMITS.find((entry) => entry.engine === engine && entry.check.test(name));
    if (limit) {
      results.push({ ok: true, skip: limit.reason, name, detail });
    } else {
      results.push({ ok, name, detail });
    }
  };

  // caret: 'initial' skips the caret-hiding style Playwright injects, a full restyle of the page per shot.
  const snap = (target, name, screenshotOptions = {}) => {
    if (!saving) {
      return Promise.resolve();
    }
    return target.screenshot({ caret: 'initial', ...screenshotOptions, path: resolve(shotsDirectory, name) });
  };

  // Firefox on macOS skips links on Tab unless "full keyboard access" is on; keyboard users turn it
  // on, and the audit must walk the same path, so the preference is set here.
  const launchOptions = engine === 'firefox' ? { firefoxUserPrefs: { 'accessibility.tabfocus': 7 } } : {};
  const browser = await ENGINES[engine].launch(launchOptions);
  const contextOptions = { colorScheme: 'light', viewport: DESKTOP_VIEWPORT };
  // Playwright grants clipboard permissions in Chromium only.
  const clipboardPermissions = engine === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {};
  const context = await browser.newContext({ ...contextOptions, acceptDownloads: true, ...clipboardPermissions });
  const page = await context.newPage();

  // A fresh tab of the page under test: optional setup before load (a clock, an init script),
  // an optional viewport, then the page.
  const openPage = async ({ browserContext = context, beforeLoad, viewport } = {}) => {
    const freshPage = await browserContext.newPage();
    if (beforeLoad) {
      await beforeLoad(freshPage);
    }
    if (viewport) {
      await freshPage.setViewportSize(viewport);
    }
    await freshPage.goto(pageUrl);
    return freshPage;
  };

  return {
    engine,
    // WebKit, like Safari, moves Tab between form controls only; Option+Tab reaches every control.
    tabKey: engine === 'webkit' ? 'Alt+Tab' : 'Tab',
    shiftTabKey: engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab',
    only: options.only,
    theme: options.theme,
    wants: (group) => !options.only || options.only.includes(group),
    saving,
    shotsDirectory,
    pageUrl,
    results,
    check,
    snap,
    openPage,
    server,
    served,
    browser,
    engineVersion: browser.version(),
    contextOptions,
    context,
    page,
  };
}

// Screenshots of one catalogue section, found by its id (a :has() lookup takes the first section
// whose demos contain a class, which later demos in other sections can steal).
async function captureSectionShots(run, sectionId) {
  const { page, check, snap } = run;
  const section = page.locator(`#${sectionId}`);
  if (!await section.count()) {
    check(false, `section #${sectionId} exists for its screenshots`);
    return;
  }
  const widths = run.saving ? [DESKTOP_VIEWPORT.width, PHONE_WIDTH] : [PHONE_WIDTH];
  for (const width of widths) {
    await page.setViewportSize({ width, height: SECTION_HEIGHT });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `${sectionId}-${width}.png`);
  }
}

// =====================================================================================
// Check groups, in run order. Each takes the run context; numbers are the check numbers
// the reports and the catalogue refer to.
// =====================================================================================

// 1. No console errors
function checkConsole(run, consoleProblems) {
  run.check(consoleProblems.length === 0, 'no console errors or warnings', consoleProblems.join(' | '));
}

// In-page: scroll boxes that cannot be reached from the keyboard, as "#section tag.classes".
// A box that scrolls must be reachable from the keyboard, or WebKit (Safari, which never focuses
// a scroll box itself) cannot scroll it: a native field, a box that holds a control, or a box
// with tabindex plus a role and a name (catalogue, Accessibility > Focus).
function findUnreachableScrollBoxes() {
  const scope = document.querySelector('.docs-demo') ? '.docs-demo *' : 'body *';
  const scrolls = (element) => {
    const style = getComputedStyle(element);
    const scrollsSideways = /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    const scrollsDown = /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    return scrollsSideways || scrollsDown;
  };
  const isUnreachable = (element) => {
    if (!element.getClientRects().length || !scrolls(element)) {
      return false;
    }
    if (element.matches('textarea, select')) {
      return false;
    }
    if (element.querySelector('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')) {
      return false;
    }
    // A name on a generic box (div, pre, span) needs a role to count; a list or a table has one.
    const hasRole = element.getAttribute('role') || !element.matches('div, pre, span');
    const hasName = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby');
    return !(element.getAttribute('tabindex') === '0' && hasRole && hasName);
  };
  const unreachable = [];
  for (const element of document.querySelectorAll(scope)) {
    if (isUnreachable(element)) {
      const sectionId = element.parentElement.closest('[id]')?.id;
      unreachable.push(`#${sectionId} ${element.localName}.${[...element.classList].join('.')}`);
    }
  }
  return unreachable;
}

// In-page, at 320px with every panel open: the page's sideways overflow, and demo content that
// runs past its demo frame outside a scroll wrapper of its own.
function measureReflow() {
  for (const panel of document.querySelectorAll('[role="tabpanel"][hidden]')) {
    panel.removeAttribute('hidden');
  }
  for (const details of document.querySelectorAll('details:not([open])')) {
    details.open = true;
  }
  const wide = [];
  for (const demo of document.querySelectorAll('.docs-demo')) {
    const edge = demo.getBoundingClientRect().right + 1;
    // Content inside a scroll wrapper below the demo is that wrapper's business.
    const hasNoScrollerBetween = (element) => {
      for (let ancestor = element.parentElement; ancestor !== demo; ancestor = ancestor.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(ancestor).overflowX)) {
          return false;
        }
      }
      return true;
    };
    for (const element of demo.querySelectorAll('*')) {
      const right = element.getBoundingClientRect().right;
      const parentRight = element.parentElement.getBoundingClientRect().right;
      if (right > edge && parentRight <= edge && hasNoScrollerBetween(element)) {
        const sectionId = demo.closest('[id]')?.id;
        const overhang = Math.round(element.getBoundingClientRect().right - edge);
        wide.push(`#${sectionId} ${element.localName}.${[...element.classList].join('.')} +${overhang}px`);
      }
    }
  }
  const pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return { page: pageOverflow, wide };
}

// In-page, every panel open: field controls that stop short of their field's content edge.
function findShortFieldControls() {
  for (const panel of document.querySelectorAll('[role="tabpanel"][hidden]')) {
    panel.removeAttribute('hidden');
  }
  for (const details of document.querySelectorAll('details:not([open])')) {
    details.open = true;
  }
  const controls = document.querySelectorAll('.cb-field > :is(.cb-input, .cb-select, .cb-input-group, .cb-range, .cb-secret, .cb-tokens)');
  const short = [];
  for (const control of controls) {
    if (!control.getClientRects().length || control.closest('[dir="rtl"]')) {
      continue;
    }
    const field = control.parentElement;
    const fieldStyle = getComputedStyle(field);
    const contentEnd = field.getBoundingClientRect().right - parseFloat(fieldStyle.paddingRight) - parseFloat(fieldStyle.borderRightWidth);
    const gap = Math.round(contentEnd - control.getBoundingClientRect().right);
    if (gap > 1) {
      const label = `#${field.closest('[id]')?.id} ${control.localName}.${[...control.classList].join('.')}`;
      short.push(`${label} ${gap}px short`);
    }
  }
  return short;
}

// In-page: appends a wide table in its wrapper and a one-line log, each with a .cb-sr-only label
// past the right edge, and returns how far the page scrolls sideways; removes them again.
function measureHiddenTextOverflow() {
  const fixture = document.body.appendChild(document.createElement('div'));
  const longText = 'x'.repeat(120);
  fixture.innerHTML = `<div class="cb-table-wrap"><table class="cb-table"><tbody><tr><td>${longText}</td><td><span class="cb-sr-only">hidden label</span>end</td></tr></tbody></table></div>`
    + `<ol class="cb-log cb-log--nowrap"><li><span class="cb-log__time">10:00</span><span class="cb-log__level">INFO</span><span class="cb-log__msg">${longText}<span class="cb-sr-only">hidden label</span></span></li></ol>`;
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  fixture.remove();
  return overflow;
}

// 2b. A .cb-sr-only label past the right edge of a sideways scroller (a wide table, a one-line log)
//     stays inside it: the page does not scroll sideways at 360px (WCAG 1.4.10).
async function checkHiddenTextInScrollers(run) {
  if (!run.wants('layout')) {
    return;
  }
  const fixturePage = await run.openPage({ viewport: { width: 360, height: 900 } });
  const overflow = await fixturePage.evaluate(measureHiddenTextOverflow);
  await fixturePage.close();
  run.check(overflow === 0, 'hidden text past the edge of a wide table or a one-line log does not widen the page at 360px', `${overflow}px`);
}

// 2. No horizontal overflow at 360, 800 and 1360px, and none at 320px with every panel open
async function checkLayout(run) {
  if (!run.wants('layout')) {
    return;
  }
  const { page, check, snap } = run;
  const unreachable = new Set();
  for (const width of [360, 800, 1360]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `no horizontal overflow at ${width}px`, overflow > 0 ? `${overflow}px too wide` : '');
    const boxes = await page.evaluate(findUnreachableScrollBoxes);
    for (const box of boxes) {
      unreachable.add(`${box} (${width}px)`);
    }
    // Firefox refuses screenshots taller than 32767px; the catalogue is longer, so it gets the viewport.
    await snap(page, `page-${width}.png`, { fullPage: true }).catch(() => snap(page, `page-${width}.png`));
  }
  check(!unreachable.size, 'every scroll box can be reached with the keyboard (a control inside, or tabindex, role and name)', [...unreachable].join('; '));

  // Reflow at 320px (WCAG 1.4.10), with every tab panel and details open on a fresh page, so
  // content behind an idle tab counts. A catalogue demo scrolls sideways when its content is too
  // wide, which hides the fault from the page check: a demo must wrap (.cb-break) or scroll in its
  // own wrapper (.cb-table-wrap).
  const reflowPage = await run.openPage({ viewport: { width: 320, height: 900 } });
  const reflow = await reflowPage.evaluate(measureReflow);
  await reflowPage.close();
  check(reflow.page <= 0, 'no horizontal overflow at 320px with every panel open (WCAG 1.4.10)', reflow.page > 0 ? `${reflow.page}px too wide` : '');
  if (await page.locator('.docs-demo').count()) {
    check(!reflow.wide.length, 'at 320px no demo content runs past its frame outside a scroll wrapper', reflow.wide.join('; '));
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);

  // Ids are unique: a duplicate sends labels, dismiss keys and getElementById to the wrong element.
  const duplicates = await page.evaluate(() => {
    const countById = {};
    for (const element of document.querySelectorAll('[id]')) {
      countById[element.id] = (countById[element.id] ?? 0) + 1;
    }
    return Object.keys(countById).filter((id) => countById[id] > 1);
  });
  check(!duplicates.length, 'every id on the page is unique', duplicates.join(', '));

  // A flush panel body frames its children: each one loses margin, border and radius, whatever
  // component it is (tables, wrappers, lists and wells come later in the stylesheet).
  const framed = await page.$$eval('.cb-panel__body--flush > *', (children) => {
    const offenders = [];
    for (const child of children) {
      if (!child.getClientRects().length) {
        continue;
      }
      const style = getComputedStyle(child);
      const edge = [style.margin, style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderTopLeftRadius];
      if (edge.some((value) => value !== '0px')) {
        offenders.push({ el: `${child.localName}.${[...child.classList].join('.')}`, edge });
      }
    }
    return offenders;
  });
  check(!framed.length, 'children of a flush panel body have no margin, border or radius', framed.map((offender) => `${offender.el} ${offender.edge.join(' ')}`).join('; '));

  // A field's control fills its column to the field's end, stacked or horizontal, whatever kind it
  // is; idle tab panels and closed details are opened on a fresh page so every field is measured.
  const fieldPage = await run.openPage({ viewport: DESKTOP_VIEWPORT });
  const short = await fieldPage.evaluate(findShortFieldControls);
  await fieldPage.close();
  check(!short.length, 'a field control fills its column to the end of the field, stacked or horizontal', short.join('; '));
}

// 3. Visible focus ring on the first instance of each control type
// 4. Key travel on press
// 5. Popover dialogs open and close with Escape (menus are check 30)
async function checkControls(run) {
  if (!run.wants('controls')) {
    return;
  }
  const { page, check, snap } = run;
  for (const selector of FOCUS_RING_CONTROLS) {
    const control = page.locator(`${selector}:visible`).first();
    if (await control.count() === 0) {
      continue;
    }
    // Tab away and back with Shift+Tab: keyboard focus, and it stays inside the page even for
    // the first control (Shift+Tab from it would leave for the browser UI).
    await control.focus();
    await page.keyboard.press(run.tabKey);
    await page.keyboard.press(run.shiftTabKey);
    const ring = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { focusVisible: element.matches(':focus-visible'), width: parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    check(ring.focusVisible && ring.width >= 2 && ring.style !== 'none', `focus ring visible on ${selector}`, `${ring.width}px ${ring.style}`);
  }

  // 4. Key travel on press (first plain button key: a link key would navigate, a modal opener open)
  const button = page.locator(PLAIN_BUTTON).first();
  if (await button.count()) {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    const readPressState = () => button.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.translate}|${style.boxShadow}`;
    });
    const before = await readPressState();
    await page.mouse.move(...centreOf(box));
    await page.mouse.down();
    await settleTransitions(page);
    const during = await readPressState();
    await page.mouse.up();
    await page.mouse.move(2, 2);
    await settleTransitions(page);
    const after = await readPressState();
    const travel = `${before.split('|')[0]} -> ${during.split('|')[0]}`;
    check(during !== before && after === before, 'button travels down and inverts bevel on press, returns on release', travel);
  }

  // 5. Popover dialogs open and close with Escape (menus are check 30)
  const dialogIds = await page.$$eval('[popovertarget]:not([popovertargetaction])', (openers) => {
    const ids = new Set(openers.map((opener) => opener.getAttribute('popovertarget')));
    return [...ids].filter((id) => document.getElementById(id)?.matches('.cb-dialog'));
  });
  for (const dialogId of dialogIds) {
    await page.click(`[popovertarget="${dialogId}"]:not([popovertargetaction])`);
    await page.waitForTimeout(250);
    const opened = await page.evaluate((id) => document.getElementById(id).matches(':popover-open'), dialogId);
    await snap(page, `dialog-${dialogId}.png`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const closed = await page.evaluate((id) => !document.getElementById(id).matches(':popover-open'), dialogId);
    check(opened && closed, `dialog #${dialogId} opens and closes with Escape`);
  }
}

// 6. Contrast of the palette pairs (scripts/contrast-pairs.mjs): text >= 4.5, non-text >= 3.
// Returns the measured pairs; check 22 compares them with the catalogue's table.
async function checkContrastPairs(run) {
  const measured = run.wants('contrast') ? await measurePairs(run.page) : [];
  for (const pair of measured) {
    const pairName = `contrast ${colourLabel(pair.fg)} on ${colourLabel(pair.bg)}`;
    if (pair.ratio === null) {
      run.check(false, pairName, 'colour missing');
      continue;
    }
    run.check(pair.ratio >= pair.need, `${pairName} >= ${pair.need}`, pair.ratio.toFixed(2));
  }
  return measured;
}

// In-page, on one control: the colour pairs to judge and their minimum ratio.
// Text controls need text >= 4.5 against their bottom background colour (or nearest painted
// ancestor; gradient overlays such as --cb-grad-btn are ignored). Checkboxes and radios have no
// text, so their boundary (top border vs. surrounding surface) and, when on, their mark vs. fill
// need >= 3 (WCAG 1.4.11). Range thumbs are engine pseudo-elements and are judged from the shots.
// Self-contained: Playwright sends it to the page as source.
function readControlContrast(control) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  const toRgba = (colour) => {
    canvasContext.clearRect(0, 0, 1, 1);
    canvasContext.fillStyle = '#000';
    canvasContext.fillStyle = colour;
    canvasContext.fillRect(0, 0, 1, 1);
    return [...canvasContext.getImageData(0, 0, 1, 1).data];
  };
  const toRgb = (colour) => toRgba(colour).slice(0, 3);
  const paintedBackground = (start) => {
    for (let ancestor = start; ancestor; ancestor = ancestor.parentElement) {
      const background = toRgba(getComputedStyle(ancestor).backgroundColor);
      if (background[3] > 0) {
        return background.slice(0, 3);
      }
    }
    return [255, 255, 255];
  };

  const style = getComputedStyle(control);
  if (control.matches('input[type=range]')) {
    return { need: 0, pairs: [] };
  }
  // A segmented-control input is a transparent cover over its key: judge the key's text.
  if (control.closest('.cb-segmented')) {
    const key = control.parentElement;
    return { need: 4.5, pairs: [['text', toRgb(getComputedStyle(key).color), paintedBackground(key)]] };
  }
  if (control.matches('input[type=checkbox], input[type=radio]')) {
    const isOn = control.checked || control.indeterminate;
    const pairs = [['boundary', toRgb(style.borderTopColor), paintedBackground(control.parentElement)]];
    if (isOn) {
      const markColour = toRgb(getComputedStyle(control, '::before').backgroundColor);
      pairs.push(['mark', markColour, toRgb(style.backgroundColor)]);
    }
    return { need: 3, pairs };
  }
  return { need: 4.5, pairs: [['text', toRgb(style.color), paintedBackground(control)]] };
}

// In-page: the key that names a control's look: tag, classes, look attributes and whether it
// sits in a segmented control.
function describeControlLook(control, lookAttributes) {
  let look = control.tagName.toLowerCase();
  for (const className of control.classList) {
    look += `.${className}`;
  }
  for (const attribute of lookAttributes) {
    if (!control.hasAttribute(attribute) || (attribute === 'type' && control.tagName !== 'INPUT')) {
      continue;
    }
    const value = control.getAttribute(attribute);
    look += `[${attribute}${value ? `=${value}` : ''}]`;
  }
  if (control.closest('.cb-segmented')) {
    look += ' in .cb-segmented';
  }
  return look;
}

// 7. Live states of every distinct interactive control in the catalogue demos:
//    rest, hover, keyboard focus and active are captured and the focus ring is checked.
//    Contrast is measured in each pointer state (readControlContrast). Disabled and busy
//    controls are skipped.
async function checkControlStates(run) {
  if (!run.wants('states')) {
    return;
  }
  const { page, check, snap } = run;
  const controls = await page.$$(DEMO_CONTROLS);
  const seenLooks = new Set();
  for (const control of controls) {
    // A control in a closed <details> or a hidden panel cannot be judged; a shown one of its look is.
    const isRendered = await control.evaluate((element) => element.getClientRects().length > 0);
    if (!isRendered) {
      continue;
    }
    // One capture per distinct look: tag, classes, input type and state attributes.
    const look = await control.evaluate(describeControlLook, LOOK_ATTRIBUTES);
    if (seenLooks.has(look)) {
      continue;
    }
    seenLooks.add(look);
    const slug = look.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');

    await control.scrollIntoViewIfNeeded();
    const shoot = async (state) => {
      await control.scrollIntoViewIfNeeded().catch(() => {});
      const box = await control.boundingBox();
      // e.g. a skip link at rest is off screen
      if (!box || box.y + box.height < 0 || box.x + box.width < 0) {
        return;
      }
      const clip = { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 };
      await snap(page, `state-${slug}-${state}.png`, { clip });
    };
    const measureContrast = async () => {
      const { need, pairs } = await control.evaluate(readControlContrast);
      return pairs.map(([name, foreground, background]) => ({ name, need, ratio: contrastRatio(foreground, background) }));
    };
    const box = await control.boundingBox();
    const centre = centreOf(box);
    const ratiosByState = {};

    await page.mouse.move(2, 2);
    await settleTransitions(page);
    ratiosByState.rest = await measureContrast();
    await shoot('rest');

    await page.mouse.move(...centre);
    await settleTransitions(page);
    ratiosByState.hover = await measureContrast();
    await shoot('hover');

    await page.mouse.down();
    await settleTransitions(page);
    ratiosByState.active = await measureContrast();
    await shoot('active');
    await control.evaluate((element) => element.addEventListener('click', (event) => event.preventDefault(), { once: true }));
    await page.mouse.up();
    // A mouse press opens a select's native list on Linux; it stays open, and swallows the keys below,
    // unless something closes it (a screenshot does, which is why --shots none once failed there).
    await page.keyboard.press('Escape');
    await page.mouse.move(2, 2);

    // Forward first, then back: after a mouse press WebKit on Linux does not move focus on the first
    // Shift+Tab. Either order ends on the control by keyboard, so its :focus-visible ring is judged.
    await control.focus();
    await page.keyboard.press(run.tabKey);
    await page.keyboard.press(run.shiftTabKey);
    // Shift+Tab re-enters a radio group at its checked radio, so judge whichever radio of the group took focus.
    // A token field's entry shows its ring on the well.
    const hasRing = await control.evaluate((element, dateFields) => {
      const focused = document.activeElement;
      const judged = element.type === 'radio' && focused?.name === element.name ? focused : element;
      const ringHolder = judged.matches('.cb-tokens__entry') ? judged.closest('.cb-tokens') : judged;
      const style = getComputedStyle(ringHolder);
      const isFocused = judged.matches(':focus-visible') || (judged.matches(dateFields) && judged.matches(':focus'));
      return isFocused && parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none';
    }, SEGMENTED_DATE_FIELDS);
    await shoot('focus');
    await control.evaluate((element) => element.blur());

    const measurements = [];
    for (const [state, list] of Object.entries(ratiosByState)) {
      for (const measurement of list) {
        measurements.push({ state, ...measurement });
      }
    }
    const low = measurements.filter((measurement) => measurement.ratio < measurement.need);
    let detail = 'contrast n/a';
    if (measurements.length) {
      detail = measurements.map((measurement) => `${measurement.state} ${measurement.name} ${measurement.ratio.toFixed(2)}`).join(', ');
    }
    if (!hasRing) {
      detail += ', NO FOCUS RING';
    }
    check(!low.length && hasRing, `states of ${look}: contrast at rest/hover/active, focus ring visible`, detail);
  }
}

// 8. Every button and button-styled link has an accessible name (text or aria-label).
async function checkAccessibleNames(run) {
  if (!run.wants('controls')) {
    return;
  }
  const unnamed = await run.page.$$eval('button, a.cb-btn', (buttons) => {
    const isUnnamed = (button) => !(button.getAttribute('aria-label') ?? '').trim() && !button.textContent.trim();
    return buttons.filter(isUnnamed).map((button) => button.outerHTML.slice(0, 80));
  });
  run.check(unnamed.length === 0, 'every button has an accessible name', unnamed.join(' | '));
}

// --- 9. Behaviour of dist/cubicle.js ------------------------------------------------
// On the catalogue: copy, reveal, auto re-mask, download, table select-all, alert dismiss, ARIA
// tabs and trees, meter marks, the plain-HTTP copy fallback, and hiding of script-only controls
// without JavaScript. Every part that changes the page for good starts from a fresh page so
// earlier clicks do not leak state.

// The value a script action reads from its target: a field's value or an element's text.
function readTargetValue(page, targetId) {
  return page.evaluate((id) => {
    const target = document.getElementById(id);
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value;
    }
    return target.textContent;
  }, targetId);
}

// The value of `attribute` on every element that has it.
function readAttributeValues(page, attribute) {
  return page.$$eval(`[${attribute}]`, (elements, name) => elements.map((element) => element.getAttribute(name)), attribute);
}

// The text of the shared live region, empty until the script has announced something.
function readAnnouncement(page) {
  return page.evaluate(() => document.querySelector('[role="status"][data-cb-sr]')?.textContent ?? '');
}

// Empties the live region, so a wait after the next click sees only the new announcement and not the
// previous one.
function clearAnnouncement(page) {
  return page.evaluate(() => {
    const liveRegion = document.querySelector('[role="status"][data-cb-sr]');
    if (liveRegion) {
      liveRegion.textContent = '';
    }
  });
}

// The script clears the live region and fills it on the next animation frame, which a busy machine
// delays. Waits up to ANNOUNCEMENT_WAIT_MS for text matching `pattern`; when none arrives the
// caller's check reports what the region holds.
async function waitForAnnouncement(page, pattern) {
  try {
    await page.waitForFunction(
      ({ source, flags }) => new RegExp(source, flags).test(document.querySelector('[role="status"][data-cb-sr]')?.textContent ?? ''),
      { source: pattern.source, flags: pattern.flags },
      { timeout: ANNOUNCEMENT_WAIT_MS },
    );
  } catch {
    // The check that follows reports the live region as it is.
  }
}

async function checkCopyButtons(run, scriptPage) {
  const { check } = run;
  for (const targetId of await readAttributeValues(scriptPage, 'data-cb-copy')) {
    await exposeControl(scriptPage, `[data-cb-copy="${targetId}"]`);
    const button = scriptPage.locator(`[data-cb-copy="${targetId}"]`);
    await button.scrollIntoViewIfNeeded();
    await clearAnnouncement(scriptPage);
    await button.click();
    await waitForAnnouncement(scriptPage, COPIED_ANNOUNCEMENT);
    const copied = await readClipboard(scriptPage);
    const flagged = await button.evaluate((element) => element.hasAttribute('data-cb-copied'));
    const announced = await readAnnouncement(scriptPage);
    check(flagged && COPIED_ANNOUNCEMENT.test(announced), `copy #${targetId}: button and live region confirm`, `data-cb-copied ${flagged}, live "${announced}"`);
    const expected = await readTargetValue(scriptPage, targetId);
    let detail = copied === expected ? '' : 'MISMATCH';
    if (copied === null) {
      detail = 'clipboard unreadable';
    }
    check(copied === expected, `copy #${targetId} reaches the clipboard`, detail);
  }
}

async function checkRevealButtons(run, scriptPage) {
  for (const targetId of await readAttributeValues(scriptPage, 'data-cb-reveal')) {
    await exposeControl(scriptPage, `[data-cb-reveal="${targetId}"]`);
    const button = scriptPage.locator(`[data-cb-reveal="${targetId}"]`);
    const readState = async () => {
      const type = await scriptPage.$eval(`#${targetId}`, (field) => field.type);
      const pressed = await button.getAttribute('aria-pressed');
      return `${type}/${pressed}`;
    };
    const before = await readState();
    await button.click();
    const shown = await readState();
    await button.click();
    const after = await readState();
    const toggles = before === 'password/false' && shown === 'text/true' && after === 'password/false';
    run.check(toggles, `reveal #${targetId} toggles type and aria-pressed`, `${before} -> ${shown} -> ${after}`);
  }
}

async function checkRevealTimeouts(run, scriptPage) {
  const timed = await scriptPage.$$eval('[data-cb-reveal][data-cb-reveal-timeout]', (buttons) => {
    return buttons.map((button) => [button.getAttribute('data-cb-reveal'), Number(button.getAttribute('data-cb-reveal-timeout'))]);
  });
  for (const [targetId, seconds] of timed) {
    const clockPage = await run.openPage({ beforeLoad: (freshPage) => freshPage.clock.install() });
    await clockPage.locator(`[data-cb-reveal="${targetId}"]`).click();
    const shown = await clockPage.$eval(`#${targetId}`, (field) => field.type);
    await clockPage.clock.fastForward(seconds * 1000 + 100);
    const later = await clockPage.$eval(`#${targetId}`, (field) => field.type);
    run.check(shown === 'text' && later === 'password', `reveal #${targetId} masks again after ${seconds}s`, `${shown} -> ${later}`);
    await clockPage.close();
  }
}

async function checkDownloads(run, scriptPage) {
  for (const targetId of await readAttributeValues(scriptPage, 'data-cb-download')) {
    await exposeControl(scriptPage, `[data-cb-download="${targetId}"]`);
    const button = scriptPage.locator(`[data-cb-download="${targetId}"]`);
    await button.scrollIntoViewIfNeeded();
    const [download] = await Promise.all([scriptPage.waitForEvent('download'), button.click()]);
    const content = readFileSync(await download.path(), 'utf8');
    const fileName = await button.getAttribute('data-cb-filename');
    const saved = download.suggestedFilename() === fileName && content === await readTargetValue(scriptPage, targetId);
    run.check(saved, `download #${targetId} saves ${fileName} with the value`, `${download.suggestedFilename()}, ${content.length} chars`);
  }
}

// Select-all: checks every row, follows the rows (indeterminate when mixed), highlights the
// checked rows and fires a bubbling change event for each box it changes.
async function checkSelectAll(run, scriptPage) {
  for (const tableId of await readAttributeValues(scriptPage, 'data-cb-select-all')) {
    await exposeControl(scriptPage, `[data-cb-select-all="${tableId}"]`);
    const master = scriptPage.locator(`[data-cb-select-all="${tableId}"]`);
    await master.scrollIntoViewIfNeeded();
    await scriptPage.mouse.move(2, 2);
    const readState = () => scriptPage.evaluate((id) => {
      const masterBox = document.querySelector(`[data-cb-select-all="${id}"]`);
      const boxes = [...document.getElementById(id).querySelectorAll('tbody input[type="checkbox"]:not(:disabled)')];
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = 'var(--cb-bg-selected)';
      const selectedColour = getComputedStyle(probe).color;
      probe.remove();
      const litCount = boxes.filter((box) => getComputedStyle(box.closest('td')).backgroundColor === selectedColour).length;
      let masterState = 'off';
      if (masterBox.checked) {
        masterState = 'on';
      } else if (masterBox.indeterminate) {
        masterState = 'mixed';
      }
      return { master: masterState, on: boxes.filter((box) => box.checked).length, lit: litCount, total: boxes.length };
    }, tableId);
    // One listener for every table of the page; the count restarts per table.
    await scriptPage.evaluate(() => {
      window.__changes = 0;
      if (window.__countsChanges) {
        return;
      }
      window.__countsChanges = true;
      document.addEventListener('change', (event) => {
        if (!event.target.matches('[data-cb-select-all]')) {
          window.__changes++;
        }
      });
    });
    const start = await readState();
    await master.click();
    const all = await readState();
    const changeCount = await scriptPage.evaluate(() => window.__changes);
    await scriptPage.locator(`#${tableId} tbody input[type="checkbox"]`).first().click();
    await scriptPage.mouse.move(2, 2);
    const mixed = await readState();
    await master.click();
    await master.click();
    const none = await readState();
    const checksAll = all.master === 'on' && all.on === all.total && all.lit === all.total && changeCount === all.total - start.on;
    const followsRows = mixed.master === 'mixed' && none.master === 'off' && none.on === 0 && none.lit === 0;
    const detail = `start ${start.master} ${start.on}/${start.total}; all ${all.on}/${all.total} lit ${all.lit}, ${changeCount} change events; one off -> ${mixed.master}; cleared -> ${none.master} ${none.on}`;
    run.check(checksAll && followsRows, `select-all #${tableId} checks rows, follows them and highlights them`, detail);
  }
}

// Select-all after server swaps, with no click: new rows, a row box turned disabled and a
// whole table inserted with its master inside resync the master. On a fresh page, because
// the table is replaced.
async function checkSelectAllSwaps(run, scriptPage) {
  const [tableId] = await readAttributeValues(scriptPage, 'data-cb-select-all');
  if (!tableId) {
    return;
  }
  const swapPage = await run.openPage();
  const swaps = await swapPage.evaluate(async (id) => {
    const tick = () => new Promise((resolveTick) => setTimeout(resolveTick, 0));
    const masterState = () => {
      const masterBox = document.querySelector(`[data-cb-select-all="${id}"]`);
      if (masterBox.checked) {
        return 'on';
      }
      return masterBox.indeterminate ? 'mixed' : 'off';
    };
    const rowMarkup = (checked) => `<tr><td><input class="cb-check" type="checkbox"${checked ? ' checked' : ''} aria-label="row"></td></tr>`;
    const table = () => document.getElementById(id);

    document.querySelector(`[data-cb-select-all="${id}"]`).click();
    await tick();
    const all = masterState();

    table().tBodies[0].outerHTML = `<tbody>${rowMarkup(false)}${rowMarkup(false)}</tbody>`;
    await tick();
    const swapped = masterState();

    table().tBodies[0].innerHTML = rowMarkup(true) + rowMarkup(false);
    await tick();
    const mixed = masterState();

    table().tBodies[0].rows[1].querySelector('input').disabled = true;
    await tick();
    const disabled = masterState();

    const insertedTable = document.createElement('table');
    insertedTable.id = id;
    const headMarkup = `<thead><tr><th><input type="checkbox" data-cb-select-all="${id}" aria-label="all"></th></tr></thead>`;
    insertedTable.innerHTML = `${headMarkup}<tbody>${rowMarkup(true)}${rowMarkup(true)}</tbody>`;
    table().replaceWith(insertedTable);
    await tick();
    const inserted = masterState();

    return { all, swapped, mixed, disabled, inserted };
  }, tableId);
  await swapPage.close();
  const follows = swaps.all === 'on' && swaps.swapped === 'off' && swaps.mixed === 'mixed' && swaps.disabled === 'on' && swaps.inserted === 'on';
  run.check(follows, `select-all #${tableId} follows rows swapped in or disabled and a table inserted with its master`, JSON.stringify(swaps));
}

// Toggle: a click flips aria-expanded; collapsing with focus inside the target returns focus
// to the key (the catalogue's shell demo, whose sidebar folds below 50rem).
async function checkToggles(run, scriptPage) {
  for (const targetId of await readAttributeValues(scriptPage, 'data-cb-toggle')) {
    const togglePage = await run.openPage();
    await togglePage.setViewportSize({ width: 360, height: 900 });
    const flip = await togglePage.evaluate(async (id) => {
      const key = document.querySelector(`[data-cb-toggle="${id}"]`);
      const tick = () => new Promise((resolveTick) => setTimeout(resolveTick, 0));
      const before = key.getAttribute('aria-expanded');
      key.click();
      await tick();
      const opened = key.getAttribute('aria-expanded');
      const link = document.getElementById(id).querySelector('a[href]');
      link.focus();
      const inside = document.activeElement === link;
      key.click();
      await tick();
      return {
        before,
        opened,
        after: key.getAttribute('aria-expanded'),
        inside,
        focus: document.activeElement === key,
        hidden: link.getClientRects().length === 0,
      };
    }, targetId);
    await togglePage.close();
    const works = flip.before === 'false' && flip.opened === 'true' && flip.after === 'false' && flip.inside && flip.focus;
    run.check(works, `toggle #${targetId} flips aria-expanded and gives focus back to the key when it closes`, JSON.stringify(flip));
  }
}

// Dismiss from the keyboard: the target is hidden and focus moves to a rendered control
// outside it, never to <body>.
async function checkDismissButtons(run, scriptPage) {
  for (const targetId of await readAttributeValues(scriptPage, 'data-cb-dismiss')) {
    await exposeControl(scriptPage, `[data-cb-dismiss="${targetId}"]`);
    const button = scriptPage.locator(`[data-cb-dismiss="${targetId}"]`);
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    await scriptPage.keyboard.press('Enter');
    const outcome = await scriptPage.evaluate((id) => {
      const target = document.getElementById(id);
      const focused = document.activeElement;
      return {
        hidden: target.hidden && getComputedStyle(target).display === 'none',
        focus: focused === document.body ? 'body' : focused.outerHTML.slice(0, 60),
        ok: focused !== document.body && !target.contains(focused) && focused.getClientRects().length > 0,
      };
    }, targetId);
    run.check(outcome.hidden && outcome.ok, `dismiss #${targetId} hides the alert and moves focus on`, `hidden ${outcome.hidden}, focus ${outcome.focus}`);
  }
}

// ARIA tabs: a click selects, arrows (by orientation), Home and End move focus and
// selection, wrap and skip disabled tabs; exactly one tab and one panel are live.
async function checkTabSets(run, scriptPage) {
  const tabLists = await scriptPage.$$eval('[data-cb-tabs] [role="tablist"]', (lists) => lists.map((list, index) => {
    list.dataset.vbList = index;
    return { index, vertical: list.getAttribute('aria-orientation') === 'vertical' };
  }));
  for (const { index, vertical } of tabLists) {
    const readState = () => scriptPage.$eval(`[data-vb-list="${index}"]`, (list) => {
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const selectedTabs = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
      const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
      const shownPanels = panels.filter((panel) => panel && !panel.hidden && getComputedStyle(panel).display !== 'none');
      return {
        on: selectedTabs.map((tab) => tab.id).join(),
        roving: tabs.filter((tab) => tab.tabIndex === 0).map((tab) => tab.id).join(),
        shown: shownPanels.map((panel) => panel.id).join(),
        focus: document.activeElement?.id ?? '',
        enabled: tabs.filter((tab) => !tab.matches(':disabled, [aria-disabled="true"]')).map((tab) => tab.id),
        panelOf: Object.fromEntries(tabs.map((tab) => [tab.id, tab.getAttribute('aria-controls')])),
      };
    });
    const first = await readState();
    const isConsistent = (state, tabId) => state.on === tabId && state.roving === tabId && state.shown === state.panelOf[tabId];
    const secondTab = first.enabled[1];
    await scriptPage.locator(`#${secondTab}`).scrollIntoViewIfNeeded();
    await scriptPage.locator(`#${secondTab}`).click();
    const clicked = await readState();
    const [nextKey, previousKey] = vertical ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft'];
    const trail = [];
    for (const key of ['End', nextKey, 'Home', previousKey]) {
      await scriptPage.keyboard.press(key);
      const state = await readState();
      const landed = state.focus === state.on && isConsistent(state, state.on) ? state.on : 'BROKEN ' + JSON.stringify(state);
      trail.push(`${key}:${landed}`);
    }
    const enabled = first.enabled;
    const expected = [enabled.at(-1), enabled[0], enabled[0], enabled.at(-1)];
    const ok = isConsistent(clicked, secondTab) && trail.every((step, i) => step.endsWith(`:${expected[i]}`));
    const name = `tabs ${index + 1}${vertical ? ' (vertical)' : ''}: click, ${nextKey}/${previousKey}, Home and End select one tab and its panel`;
    run.check(ok, name, `click ${clicked.on}; ${trail.join(', ')}`);
  }
}

// ARIA trees: arrows walk visible rows with a roving tabindex, → opens a closed branch
// (firing cb-toggle) then enters it, ← goes to the parent and closes an open branch,
// Enter selects, a click selects and toggles, and the focus ring is on the row label.
async function checkTrees(run, scriptPage) {
  const treeIndexes = await scriptPage.$$eval('[data-cb-tree] [role="tree"]', (trees) => trees.map((tree, index) => {
    tree.dataset.vbTree = index;
    return index;
  }));
  for (const index of treeIndexes) {
    const tree = `[data-vb-tree="${index}"]`;
    await scriptPage.evaluate(() => {
      window.__toggles = [];
      document.addEventListener('cb-toggle', (event) => window.__toggles.push(event.detail.expanded));
    });
    const readFocusedRow = () => scriptPage.evaluate((treeSelector) => {
      const focused = document.activeElement;
      const label = focused.querySelector(':scope > .cb-nav__link');
      const selectedItems = [...document.querySelectorAll(`${treeSelector} [aria-selected="true"]`)];
      return {
        name: label?.textContent.trim() ?? '',
        expanded: focused.getAttribute('aria-expanded'),
        roving: document.querySelectorAll(`${treeSelector} [role="treeitem"][tabindex="0"]`).length,
        ring: getComputedStyle(focused).outlineStyle === 'none' && getComputedStyle(label).outlineStyle !== 'none',
        selected: selectedItems.map((item) => item.querySelector(':scope > .cb-nav__link').textContent.trim()),
      };
    }, tree);
    const closedBranch = scriptPage.locator(`${tree} [role="treeitem"][aria-expanded="false"]:not([aria-busy="true"])`).first();
    await closedBranch.scrollIntoViewIfNeeded();
    await closedBranch.focus();
    const start = await readFocusedRow();
    await scriptPage.keyboard.press('ArrowRight');
    const opened = await readFocusedRow();
    await scriptPage.keyboard.press('ArrowRight');
    const child = await readFocusedRow();
    await scriptPage.keyboard.press('ArrowLeft');
    const back = await readFocusedRow();
    await scriptPage.keyboard.press('ArrowLeft');
    const shut = await readFocusedRow();
    await scriptPage.keyboard.press('Home');
    const home = await readFocusedRow();
    await scriptPage.keyboard.press('End');
    const end = await readFocusedRow();
    await scriptPage.keyboard.press('ArrowUp');
    const up = await readFocusedRow();
    await scriptPage.keyboard.press('Enter');
    const chosen = await readFocusedRow();
    const toggles = await scriptPage.evaluate(() => window.__toggles.join());
    const walks = opened.expanded === 'true' && child.name !== start.name && back.name === start.name && shut.expanded === 'false';
    const jumps = home.name !== end.name && up.name !== end.name && chosen.selected.length === 1 && chosen.selected[0] === up.name;
    const steps = [start, opened, child, back, shut, home, end, up];
    const keepsOneStopWithRing = steps.every((step) => step.roving === 1 && step.ring);
    const detail = `${start.name}: → open, → ${child.name}, ← ${back.name}, ← closed; Home ${home.name}, End ${end.name}, ↑ ${up.name}, Enter selects ${chosen.selected}; cb-toggle ${toggles}`;
    run.check(walks && jumps && keepsOneStopWithRing && toggles.startsWith('true,false'), `tree ${index + 1}: arrows, Home, End and Enter walk, open, close and select; ring on the row`, detail);

    const row = scriptPage.locator(`${tree} [role="treeitem"][aria-expanded] > .cb-nav__link`).first();
    const before = await row.evaluate((label) => label.parentElement.getAttribute('aria-expanded'));
    await row.click();
    const after = await row.evaluate((label) => [label.parentElement.getAttribute('aria-expanded'), label.parentElement.getAttribute('aria-selected')]);
    run.check(after[0] !== before && after[1] === 'true', `tree ${index + 1}: a click selects the row and toggles its branch`, `${before} -> ${after[0]}, selected ${after[1]}`);
  }
}

// Meter marks follow attribute changes and meters swapped in later, with no call.
async function checkMeterMarks(run, scriptPage) {
  if (!await scriptPage.locator('meter[data-cb-marks]').count()) {
    return;
  }
  const marks = await scriptPage.evaluate(async () => {
    const meter = document.querySelector('meter[data-cb-marks]');
    const fractionOf = (target, value) => String((value - target.min) / (target.max - target.min));
    const before = meter.style.getPropertyValue('--_high');
    meter.setAttribute('high', String(meter.min + (meter.max - meter.min) / 2));
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    const changed = meter.style.getPropertyValue('--_high') === fractionOf(meter, meter.high);
    const clone = meter.cloneNode(true);
    clone.removeAttribute('style');
    clone.removeAttribute('id');
    meter.parentElement.append(clone);
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    const inserted = clone.style.getPropertyValue('--_low') === fractionOf(clone, clone.low);
    clone.remove();
    return { before, changed, inserted };
  });
  run.check(marks.changed && marks.inserted, 'meter marks follow a changed high and a meter inserted later', JSON.stringify(marks));
}

// Readouts: an <output data-cb-output for> follows its control, also when both arrive later.
async function checkOutputs(run, scriptPage) {
  if (!await scriptPage.locator('output[data-cb-output]').count()) {
    return;
  }
  const controlId = await scriptPage.locator('output[data-cb-output]').first().evaluate((output) => output.htmlFor[0]);
  const readPair = (id) => scriptPage.evaluate((pairId) => ({
    control: document.getElementById(pairId).value,
    output: document.querySelector(`output[data-cb-output][for~="${pairId}"]`).value,
  }), id);
  const start = await readPair(controlId);
  await exposeControl(scriptPage, `#${controlId}`);
  await scriptPage.locator(`#${controlId}`).focus();
  await scriptPage.keyboard.press('ArrowRight');
  await scriptPage.keyboard.press('ArrowRight');
  const moved = await readPair(controlId);
  run.check(moved.control !== start.control && moved.output === moved.control, 'an output readout follows its control', `${JSON.stringify(start)} -> ${JSON.stringify(moved)}`);

  const later = await scriptPage.evaluate(async (id) => {
    const field = document.getElementById(id).closest('.cb-field').cloneNode(true);
    const control = field.querySelector(`#${id}`);
    const output = field.querySelector('output[data-cb-output]');
    control.id = `${id}-later`;
    output.id = `${output.id}-later`;
    output.htmlFor.value = control.id;
    document.getElementById(id).closest('.cb-field').after(field);
    control.value = control.max;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    const pair = { control: control.value, output: output.value };
    field.remove();
    return pair;
  }, controlId);
  run.check(later.output === later.control, 'an output readout swapped in later follows its control', JSON.stringify(later));
}

// Plain-HTTP pages have no navigator.clipboard: the hidden-buffer fallback must still copy.
async function checkCopyFallback(run, scriptPage) {
  const [targetId] = await readAttributeValues(scriptPage, 'data-cb-copy');
  if (!targetId) {
    return;
  }
  await scriptPage.evaluate(() => navigator.clipboard.writeText('sentinel')).catch(() => {});
  const removeClipboard = (freshPage) => freshPage.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  const insecurePage = await run.openPage({ beforeLoad: removeClipboard });
  await exposeControl(insecurePage, `[data-cb-copy="${targetId}"]`);
  await insecurePage.locator(`[data-cb-copy="${targetId}"]`).click();
  await insecurePage.waitForTimeout(100);
  // The clipboard is shared by the context; read it from the page whose API still works.
  const copied = await readClipboard(scriptPage);
  const expected = await readTargetValue(insecurePage, targetId);
  run.check(copied === expected, `copy #${targetId} falls back when the async clipboard is missing`, copied === 'sentinel' ? 'clipboard unchanged' : '');
  await insecurePage.close();
}

// Without JavaScript the actions are hidden and the values stay visible.
async function checkWithoutScript(run) {
  const { check } = run;
  const noScriptContext = await run.browser.newContext({ ...run.contextOptions, javaScriptEnabled: false });
  const noScriptPage = await run.openPage({ browserContext: noScriptContext });

  const actions = await noScriptPage.evaluate(([actionSelector, actionAttributes]) => {
    const buttons = [...document.querySelectorAll(actionSelector)];
    // A dialog target is closed (display: none) by design; every other target must show.
    const targets = [];
    for (const button of buttons) {
      if (button.hasAttribute('data-cb-modal')) {
        continue;
      }
      let targetId = null;
      for (const attribute of actionAttributes) {
        const value = button.getAttribute(attribute);
        if (value !== null) {
          targetId = value;
          break;
        }
      }
      targets.push(document.getElementById(targetId));
    }
    return {
      hidden: buttons.every((button) => getComputedStyle(button).display === 'none'),
      visible: targets.every((target) => target && getComputedStyle(target).display !== 'none'),
    };
  }, [ACTIONS, ACTION_ATTRIBUTES]);
  check(actions.hidden && actions.visible, 'without JavaScript, script-only actions are hidden and values stay visible', JSON.stringify(actions));

  const tabSets = await noScriptPage.evaluate(() => {
    const sets = [...document.querySelectorAll('[data-cb-tabs]')];
    const allMatch = (selector, test) => sets.every((set) => [...set.querySelectorAll(selector)].every(test));
    return {
      sets: sets.length,
      listsHidden: allMatch('[role="tablist"]', (list) => getComputedStyle(list).display === 'none'),
      panelsShown: allMatch('[role="tabpanel"]', (panel) => getComputedStyle(panel).display !== 'none'),
      headings: allMatch('.cb-tabs__heading', (heading) => getComputedStyle(heading).display !== 'none'),
    };
  });
  if (tabSets.sets) {
    check(tabSets.listsHidden && tabSets.panelsShown && tabSets.headings, 'without JavaScript, ARIA tab sets show every panel under its heading', JSON.stringify(tabSets));
  }

  const branches = await noScriptPage.$$eval('[data-cb-tree] [role="group"]', (groups) => ({
    groups: groups.length,
    shown: groups.filter((group) => getComputedStyle(group).display !== 'none').length,
  }));
  if (branches.groups) {
    check(branches.shown === branches.groups, 'without JavaScript, ARIA trees show every branch', JSON.stringify(branches));
  }

  const markedCount = await noScriptPage.$$eval('meter[data-cb-marks]', (meters) => {
    return meters.filter((meter) => meter.style.getPropertyValue('--_low') || meter.style.getPropertyValue('--_high')).length;
  });
  check(markedCount === 0, 'without JavaScript, meters carry no marks', `${markedCount} marked`);

  const readouts = await noScriptPage.$$eval('output[data-cb-output]', (outputs) => outputs.map((output) => ({
    out: output.textContent,
    control: document.getElementById(output.htmlFor[0])?.value,
    shown: getComputedStyle(output).display !== 'none',
  })));
  if (readouts.length) {
    const served = readouts.every((readout) => readout.shown && readout.out === readout.control);
    check(served, 'without JavaScript, output readouts show the value they were served with', JSON.stringify(readouts));
  }
  await noScriptContext.close();
}

// 9. Behaviour of dist/cubicle.js (see the parts above).
async function checkScriptBehaviour(run) {
  if (!run.wants('script') || !await run.page.locator(ACTIONS).count()) {
    return;
  }
  const { check } = run;
  const scriptPage = await run.openPage();
  const marked = await scriptPage.evaluate(() => document.documentElement.hasAttribute('data-cb-js'));
  check(marked, 'cubicle.js marks the root with data-cb-js');

  // A broken or missing script must show up as a failed check, not as a crash; the first
  // failure ends this sequence.
  if (marked) {
    try {
      await checkCopyButtons(run, scriptPage);
      await checkRevealButtons(run, scriptPage);
      await checkRevealTimeouts(run, scriptPage);
      await checkDownloads(run, scriptPage);
      await checkSelectAll(run, scriptPage);
      await checkSelectAllSwaps(run, scriptPage);
      await checkToggles(run, scriptPage);
      await checkDismissButtons(run, scriptPage);
      await checkTabSets(run, scriptPage);
      await checkTrees(run, scriptPage);
      await checkMeterMarks(run, scriptPage);
      await checkOutputs(run, scriptPage);
      await checkCopyFallback(run, scriptPage);
    } catch (error) {
      check(false, 'script behaviours run without errors', String(error.message).split('\n')[0]);
    }
  }
  await scriptPage.close();

  await checkWithoutScript(run);
}

// In-page, for every badge and LED in the demos, once per distinct look: its text and
// background, its lamp rim (when lit), height and spin animation.
function measureIndicators(indicators) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  const toRgba = (colour) => {
    canvasContext.clearRect(0, 0, 1, 1);
    canvasContext.fillStyle = '#000';
    canvasContext.fillStyle = colour;
    canvasContext.fillRect(0, 0, 1, 1);
    return [...canvasContext.getImageData(0, 0, 1, 1).data];
  };
  const paintedBackground = (start) => {
    for (let ancestor = start; ancestor; ancestor = ancestor.parentElement) {
      const background = toRgba(getComputedStyle(ancestor).backgroundColor);
      if (background[3] > 0) {
        return background.slice(0, 3);
      }
    }
    return [255, 255, 255];
  };

  const seenLooks = new Set();
  const measured = [];
  for (const indicator of indicators) {
    const busy = indicator.getAttribute('aria-busy') === 'true';
    const look = `${indicator.className}${busy ? '[aria-busy]' : ''}`;
    if (seenLooks.has(look)) {
      continue;
    }
    seenLooks.add(look);
    const style = getComputedStyle(indicator);
    const lamp = getComputedStyle(indicator, '::before');
    const lit = !busy && lamp.display !== 'none' && lamp.content !== 'none';
    measured.push({
      key: look,
      busy,
      height: indicator.getBoundingClientRect().height,
      text: [toRgba(style.color).slice(0, 3), paintedBackground(indicator)],
      rim: lit ? [toRgba(lamp.borderTopColor).slice(0, 3), paintedBackground(indicator)] : null,
      spin: lamp.animationName,
    });
  }
  return measured;
}

// In-page, at one density: rendered chips whose chip or remove key is off the --cb-row-h-sm
// frame or whose value comes closer to the frame than one line centred in it, how many chips
// there are, and whether one wraps its value.
function measureChipFrames(density) {
  if (density === 'default') {
    document.documentElement.removeAttribute('data-cb-density');
  } else {
    document.documentElement.dataset.cbDensity = density;
  }

  // The first and last line boxes of the chip's own text (not its box or key).
  const textLinesOf = (chip) => {
    const textNodes = [...chip.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (!textNodes.length) {
      return null;
    }
    const range = document.createRange();
    range.setStartBefore(textNodes[0]);
    range.setEndAfter(textNodes[textNodes.length - 1]);
    const lines = [...range.getClientRects()];
    return { first: lines[0], last: lines[lines.length - 1] };
  };

  const chips = [...document.querySelectorAll('.cb-chip')].filter((chip) => chip.getClientRects().length);
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const bad = [];
  for (const chip of chips) {
    const chipStyle = getComputedStyle(chip);
    const rowHeight = parseFloat(chipStyle.getPropertyValue('--cb-row-h-sm')) * rootFontSize;
    const chipBox = chip.getBoundingClientRect();
    const removeKey = chip.querySelector(':scope > .cb-chip__remove');
    const label = `"${chip.textContent.trim().slice(0, 24)}"`;

    // One line centred in the frame leaves this much room above and below it; a wrapped value
    // keeps it too. One pixel of slack covers the text's content box inside its line.
    const borderWidth = parseFloat(chipStyle.borderTopWidth);
    const centredRoom = (rowHeight - 2 * borderWidth - parseFloat(chipStyle.lineHeight)) / 2;
    const lines = textLinesOf(chip);
    if (lines) {
      const roomAbove = lines.first.top - chipBox.top - borderWidth;
      const roomBelow = chipBox.bottom - borderWidth - lines.last.bottom;
      if (Math.min(roomAbove, roomBelow) < centredRoom - 1) {
        bad.push(`${label} text ${roomAbove.toFixed(1)}/${roomBelow.toFixed(1)}px from the frame for ${centredRoom.toFixed(1)}`);
      }
    }

    if (!removeKey) {
      if (Math.abs(chipBox.height - rowHeight) > 0.5) {
        bad.push(`${label} ${chipBox.height.toFixed(1)}px for ${rowHeight}`);
      }
      continue;
    }
    const keyBox = removeKey.getBoundingClientRect();
    const endGap = getComputedStyle(chip).direction === 'rtl' ? keyBox.left - chipBox.left : chipBox.right - keyBox.right;
    const wrapped = chipBox.height > rowHeight + 0.5;
    const keyIsSquare = Math.abs(keyBox.height - rowHeight) <= 0.5 && Math.abs(keyBox.width - rowHeight) <= 0.5;
    const keyMeetsEdges = Math.abs(keyBox.top - chipBox.top) <= 0.5 && Math.abs(endGap) <= 0.5 && (wrapped || Math.abs(chipBox.bottom - keyBox.bottom) <= 0.5);
    if (!(keyIsSquare && keyMeetsEdges)) {
      const offsets = `${(keyBox.top - chipBox.top).toFixed(1)}/${(chipBox.bottom - keyBox.bottom).toFixed(1)}/${endGap.toFixed(1)}`;
      bad.push(`${label} chip ${chipBox.width.toFixed(1)}x${chipBox.height.toFixed(1)}, key ${keyBox.width.toFixed(1)}x${keyBox.height.toFixed(1)} off top/bottom/end ${offsets} for ${rowHeight}`);
    }
  }
  const hasWrappedChip = chips.some((chip) => {
    const removeKey = chip.querySelector(':scope > .cb-chip__remove');
    return removeKey && chip.getBoundingClientRect().height > removeKey.getBoundingClientRect().height + 0.5;
  });
  return { count: chips.length, wrapped: hasWrappedChip, bad };
}

// 10. Badges and LEDs, once per distinct look: text >= 4.5 against the painted background,
//     the LED lamp rim >= 3 against it (WCAG 1.4.11), at most 20px high so badges fit
//     .cb-btn--sm table rows, and busy badges spin except under reduced motion. Then chips.
async function checkBadges(run) {
  if (!run.wants('badges') || !await run.page.locator(INDICATORS).count()) {
    return;
  }
  const { page, check } = run;
  const indicators = await page.$$eval(INDICATORS, measureIndicators);
  for (const indicator of indicators) {
    const textRatio = contrastRatio(...indicator.text);
    const rimRatio = indicator.rim && contrastRatio(...indicator.rim);
    const ok = textRatio >= 4.5 && (!indicator.rim || rimRatio >= 3) && indicator.height <= 20 && (!indicator.busy || indicator.spin === 'cb-spin');
    const lampDetail = indicator.rim ? `, lamp ${rimRatio.toFixed(2)}` : '';
    const spinDetail = indicator.busy ? `, ${indicator.spin}` : '';
    check(ok, `indicator .${indicator.key.replace(/ /g, '.')}: text, lamp and height`, `text ${textRatio.toFixed(2)}${lampDetail}, ${indicator.height}px${spinDetail}`);
  }

  const calmContext = await run.browser.newContext({ ...run.contextOptions, reducedMotion: 'reduce' });
  const calmPage = await run.openPage({ browserContext: calmContext });
  const spins = await calmPage.$$eval('.docs-demo .cb-badge[aria-busy="true"]', (badges) => {
    return badges.map((badge) => getComputedStyle(badge, '::before').animationName);
  });
  check(spins.length > 0 && spins.every((animation) => animation === 'none'), 'busy badges stop spinning under reduced motion', spins.join(', '));
  await calmContext.close();

  // Chips: the chip and its square remove key are --cb-row-h-sm tall at every density and share
  // one frame (the key meets the chip's top, bottom and end edges); at 360px a long value wraps,
  // keeps the key square at the top and keeps the room a centred line has above and below it. Every key is a <button> named "Remove ..." with its chip's value,
  // and every list has a name. The catalogue must show chips.
  const isCatalogue = await page.locator('#accessibility').count();
  if (isCatalogue || await page.locator('.cb-chip').count()) {
    const frameProblems = [];
    for (const [density, width] of CHIP_FRAME_CASES) {
      await page.setViewportSize({ width, height: 900 });
      const frames = await page.evaluate(measureChipFrames, density);
      for (const problem of frames.bad) {
        frameProblems.push(`${density} ${width}px: ${problem}`);
      }
      if (!frames.count) {
        frameProblems.push(`${density} ${width}px: no chips`);
      }
      if (width === 360 && isCatalogue && !frames.wrapped) {
        frameProblems.push('360px: no chip with a wrapped value');
      }
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-cb-density'));
    await page.setViewportSize(DESKTOP_VIEWPORT);
    check(!frameProblems.length, 'chips: chip and square remove key are --cb-row-h-sm tall in one frame, text clear of the frame, at every density', frameProblems.slice(0, 4).join(' | '));

    const nameProblems = await page.$$eval('.cb-chips, .cb-chip__remove', (elements) => {
      const problems = [];
      for (const element of elements) {
        if (element.matches('.cb-chips')) {
          if (!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) {
            problems.push(`unnamed list "${element.textContent.trim().slice(0, 24)}"`);
          }
          continue;
        }
        const otherNodes = [...element.closest('.cb-chip').childNodes].filter((node) => node !== element);
        const value = otherNodes.map((node) => node.textContent).join('').trim();
        const name = element.getAttribute('aria-label') ?? '';
        if (!(element.localName === 'button' && name.startsWith('Remove') && name.includes(value))) {
          problems.push(`${element.localName} "${name}" for "${value}"`);
        }
      }
      return problems;
    });
    check(!nameProblems.length, 'chips: every list is named and every remove key is a button named "Remove ..." with its value', nameProblems.slice(0, 3).join(' | '));
  }

  await captureSectionShots(run, 'badges');
}

// In-page: rendered demo tables, their expected row height and the distinct row heights found.
function measureTableRowHeights(tables) {
  const rendered = tables.filter((table) => table.getClientRects().length);
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return rendered.map((table, i) => {
    const rows = [...table.querySelectorAll('tbody tr, thead tr, tfoot tr')].filter((row) => !row.querySelector('.cb-table__empty'));
    // The row height comes from the density tokens in force on this table (rem -> px).
    const tokenName = table.classList.contains('cb-table--compact') ? '--cb-row-h-sm' : '--cb-row-h';
    const token = getComputedStyle(table).getPropertyValue(tokenName).trim();
    const expected = Math.round(parseFloat(token) * rootFontSize);
    const heights = new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)));
    return { index: i, expected, wraps: table.classList.contains('cb-table--wrap'), heights: [...heights] };
  });
}

// In-page: scrolls each sticky table's wrapper to its far end and back, and reports where the
// pinned columns and the header were before and after.
function measureStickyTables(tables) {
  return tables.map((table, i) => {
    const wrapper = table.closest('.cb-table-wrap');
    if (!wrapper) {
      return { index: i, skip: true };
    }
    const wrapperLeft = () => wrapper.getBoundingClientRect().left;
    const row = table.querySelector('tbody tr');
    const pinnedCount = table.querySelector('.cb-table__select:first-child') ? 2 : 1;
    const pinnedOffsets = () => [...row.children].slice(0, pinnedCount).map((cell) => cell.getBoundingClientRect().left - wrapperLeft());
    const before = pinnedOffsets();
    wrapper.scrollLeft = wrapper.scrollWidth;
    const after = pinnedOffsets();
    const scrolledX = wrapper.scrollLeft;
    wrapper.scrollTop = wrapper.scrollHeight;
    // From the inner edge of the wrapper.
    const headTop = table.querySelector('thead th').getBoundingClientRect().top - wrapper.getBoundingClientRect().top - wrapper.clientTop;
    const scrolledY = wrapper.scrollTop;
    wrapper.scrollLeft = 0;
    wrapper.scrollTop = 0;
    return { index: i, pinned: pinnedCount, before, after, scrolledX, headTop, scrolledY };
  });
}

// In-page: the text and background of every text cell in the demo tables' bodies and footers.
function readTableCellPaints(rows) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  const toRgb = (colour) => {
    canvasContext.clearRect(0, 0, 1, 1);
    canvasContext.fillStyle = '#000';
    canvasContext.fillStyle = colour;
    canvasContext.fillRect(0, 0, 1, 1);
    return [...canvasContext.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const cells = [];
  for (const row of rows) {
    for (const cell of row.children) {
      if (cell.querySelector('a, .cb-badge, .cb-btn, .cb-check') || !cell.textContent.trim()) {
        continue;
      }
      const style = getComputedStyle(cell);
      cells.push({ key: style.backgroundColor, fg: toRgb(style.color), bg: toRgb(style.backgroundColor) });
    }
  }
  return cells;
}

// 11. Data tables: one row height (28px, compact 24px) with or without .cb-btn--sm,
//     sticky first column(s) and header that stay put while their wrapper scrolls,
//     text contrast in every row paint (zebra, hover, selected, totals), and a visible
//     sort arrow for each aria-sort value.
async function checkTables(run) {
  if (!run.wants('tables') || !await run.page.locator('.docs-demo .cb-table').count()) {
    return;
  }
  const { page, check, snap } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  // Tables inside closed dialogs are not rendered; they are measured by check 18 instead.
  const tableHeights = await page.$$eval('.docs-demo .cb-table', measureTableRowHeights);
  for (const table of tableHeights) {
    let ok = table.heights.length === 1 && table.heights[0] === table.expected;
    if (table.wraps) {
      ok = table.heights.every((height) => height >= table.expected);
    }
    check(ok, `table ${table.index + 1}: rows are ${table.expected}px${table.wraps ? ' or taller (wrapping)' : ''}`, `${table.heights.join(', ')}px`);
  }

  // Sticky checks run at 360px, where the wide grid scrolls inside its wrapper.
  await page.setViewportSize({ width: 360, height: 900 });
  const stickyTables = await page.$$eval('.docs-demo .cb-table--sticky', measureStickyTables);
  for (const sticky of stickyTables.filter((table) => !table.skip)) {
    const columnsHold = !sticky.scrolledX || sticky.after.every((offset, i) => Math.abs(offset - sticky.before[i]) < 1);
    const headHolds = !sticky.scrolledY || Math.abs(sticky.headTop) < 1;
    const detail = `scrolled x ${sticky.scrolledX} y ${sticky.scrolledY}; first ${sticky.pinned} column(s) ${sticky.before.map(Math.round)} -> ${sticky.after.map(Math.round)}; header top ${Math.round(sticky.headTop)}`;
    check(columnsHold && headHolds && (sticky.scrolledX || sticky.scrolledY), `sticky table ${sticky.index + 1}: pinned columns and header stay in place while scrolled`, detail);
  }

  // A sticky table's header and first column paint over a ring drawn inside its wrapper, so a
  // focusable sticky wrapper takes the standard outer ring; any other wrapper keeps it inside.
  const rings = [];
  for (const [selector, expectedOffset] of WRAPPER_RING_OFFSETS) {
    for (const wrapper of await page.locator(selector).all()) {
      await wrapper.focus();
      await page.keyboard.press(run.shiftTabKey);
      await page.keyboard.press(run.tabKey);
      const ring = await wrapper.evaluate((element, offset) => {
        const style = getComputedStyle(element);
        const labelledBy = document.getElementById(element.getAttribute('aria-labelledby'));
        return {
          name: element.getAttribute('aria-label') ?? labelledBy?.textContent.trim(),
          want: offset,
          ring: `${element.matches(':focus-visible')} ${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`,
        };
      }, expectedOffset);
      rings.push(ring);
    }
  }
  const misplaced = rings.filter((ring) => ring.ring !== `true solid 2px ${ring.want}`);
  const ringDetail = misplaced.map((ring) => `${ring.name}: ${ring.ring}, want offset ${ring.want}`).join('; ') || `${rings.length} wrappers`;
  check(rings.some((ring) => ring.want === '1px') && !misplaced.length, 'a focused sticky table wrapper draws the ring outside, other table wrappers inside', ringDetail);

  const wideTable = page.locator('.docs-demo .cb-table--sticky').first();
  await wideTable.scrollIntoViewIfNeeded();
  await wideTable.evaluate((table) => {
    table.closest('.cb-table-wrap').scrollLeft = 300;
  });
  await snap(wideTable.locator('xpath=..'), 'tables-sticky-360.png');
  await wideTable.evaluate((table) => {
    table.closest('.cb-table-wrap').scrollLeft = 0;
  });
  await page.setViewportSize(DESKTOP_VIEWPORT);

  // Contrast of every row paint, live: hover is forced by moving the pointer onto a row.
  // Disabled rows are exempt (WCAG 1.4.3) and checked on their own below; busy rows paint a
  // hatch, not a colour, and are measured by check 27.
  const readPaints = () => page.$$eval('.docs-demo .cb-table :is(tbody, tfoot) tr:not([aria-disabled="true"], [aria-busy="true"] tr)', readTableCellPaints);
  const hoveredRow = page.locator('.docs-demo .cb-table tbody tr:not(:has(:checked))').first();
  await hoveredRow.scrollIntoViewIfNeeded();
  await hoveredRow.hover();
  const hoveredCells = await readPaints();
  await page.mouse.move(2, 2);
  const restingCells = await readPaints();
  const lowestRatioByPaint = new Map();
  for (const cell of [...hoveredCells, ...restingCells]) {
    const ratio = contrastRatio(cell.fg, cell.bg);
    if (!lowestRatioByPaint.has(cell.key) || ratio < lowestRatioByPaint.get(cell.key)) {
      lowestRatioByPaint.set(cell.key, ratio);
    }
  }
  for (const [paint, ratio] of lowestRatioByPaint) {
    check(ratio >= 4.5, `table cell text on ${paint} >= 4.5`, ratio.toFixed(2));
  }

  // A disabled row takes the disabled ink and keeps its fill under the pointer.
  const disabledRow = page.locator('.docs-demo .cb-table tbody tr[aria-disabled="true"]').first();
  if (await disabledRow.count()) {
    await disabledRow.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    const readLook = () => disabledRow.evaluate((row) => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = 'var(--cb-text-disabled)';
      const disabledInk = getComputedStyle(probe).color;
      probe.remove();
      const cell = row.querySelector('td');
      return { want: disabledInk, ink: getComputedStyle(cell).color, fill: getComputedStyle(cell).backgroundColor };
    });
    const rest = await readLook();
    await disabledRow.hover();
    const hovered = await readLook();
    await page.mouse.move(2, 2);
    const detail = `ink ${rest.ink} (want ${rest.want}), fill ${rest.fill} -> ${hovered.fill}`;
    check(rest.ink === rest.want && hovered.fill === rest.fill, 'a disabled table row takes the disabled ink and no hover fill', detail);
  }

  const arrows = await page.$$eval('.docs-demo th[aria-sort] > .cb-table__sort', (sortKeys) => sortKeys.map((sortKey) => {
    const arrow = getComputedStyle(sortKey, '::after');
    return {
      sort: sortKey.parentElement.getAttribute('aria-sort'),
      width: parseFloat(arrow.width),
      height: parseFloat(arrow.height),
      clip: arrow.clipPath !== 'none',
    };
  }));
  const sortValues = new Set(arrows.map((arrow) => arrow.sort));
  for (const sort of sortValues) {
    const arrow = arrows.find((candidate) => candidate.sort === sort);
    check(arrow.width > 0 && arrow.height > 0 && arrow.clip, `sort arrow visible for aria-sort="${sort}"`, `${arrow.width}x${arrow.height}px`);
  }

  await captureSectionShots(run, 'tables');
}

// 11b. Names in data tables, on the catalogue's demos or on any other page: every table has a name
//     (a caption, aria-label, or aria-labelledby pointing at text), and the keys in a table body
//     name their row, so no two share a name ("Disconnect alice.ng", not six "Disconnect").
async function checkTableNames(run) {
  if (!run.wants('tables') || !await run.page.locator('.cb-table').count()) {
    return;
  }
  const names = await run.page.evaluate(() => {
    const tableSelector = document.querySelector('.docs-demo') ? '.docs-demo table.cb-table' : 'table.cb-table';
    const tables = [...document.querySelectorAll(tableSelector)];
    const locationOf = (table) => `#${table.parentElement.closest('[id]')?.id}`;
    const textOfIds = (ids) => ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent.trim() ?? '').join(' ').trim();
    const accessibleName = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      return element.getAttribute('aria-label')?.trim() || (labelledBy ? textOfIds(labelledBy) : '') || element.textContent.trim();
    };
    const hasName = (table) => {
      const labelledBy = table.getAttribute('aria-labelledby');
      return table.caption?.textContent.trim() || table.getAttribute('aria-label')?.trim() || (labelledBy && textOfIds(labelledBy));
    };

    const unnamed = [];
    for (const table of tables) {
      if (hasName(table)) {
        continue;
      }
      const headings = [...table.querySelectorAll('thead th')].map((heading) => heading.textContent.trim()).filter(Boolean);
      unnamed.push(`${locationOf(table)} [${headings.slice(0, 2).join(', ')}]`);
    }

    const repeated = [];
    for (const table of tables) {
      const countByName = {};
      // Items of a row's menu are named within the menu, which its key names.
      for (const key of table.querySelectorAll('tbody :is(button, a[href]):not([role="menu"] *)')) {
        const name = accessibleName(key);
        countByName[name] = (countByName[name] ?? 0) + 1;
      }
      for (const [name, count] of Object.entries(countByName)) {
        if (count > 1) {
          repeated.push(`${locationOf(table)} "${name}" x${count}`);
        }
      }
    }
    return { unnamed, repeated };
  });
  run.check(!names.unnamed.length, 'every data table has a name (caption, aria-label or aria-labelledby)', names.unnamed.join('; '));
  run.check(!names.repeated.length, 'row keys name their row: no two keys in one table share a name', names.repeated.join('; '));
}

// In-page: the edge, glyph tile, colours, size and corners of every demo alert.
function measureAlerts(alerts) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  const toRgb = (colour) => {
    canvasContext.clearRect(0, 0, 1, 1);
    canvasContext.fillStyle = '#000';
    canvasContext.fillStyle = colour;
    canvasContext.fillRect(0, 0, 1, 1);
    return [...canvasContext.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  return alerts.map((alert) => {
    const style = getComputedStyle(alert);
    const glyph = getComputedStyle(alert, '::before');
    const title = alert.querySelector('.cb-alert__title');
    const height = alert.getBoundingClientRect().height;
    const frameHeight = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const lines = Math.round((height - frameHeight) / parseFloat(style.lineHeight));
    return {
      key: alert.className + (alert.id ? `#${alert.id}` : ''),
      banner: alert.classList.contains('cb-alert--banner'),
      sm: alert.classList.contains('cb-alert--sm'),
      edge: style.borderInlineStartWidth,
      edgeColour: toRgb(style.borderLeftColor),
      tone: toRgb(glyph.backgroundColor),
      glyph: glyph.content,
      glyphInk: toRgb(glyph.color),
      bg: toRgb(style.backgroundColor),
      ink: toRgb(style.color),
      titleInk: title ? toRgb(getComputedStyle(title).color) : null,
      height,
      lines,
      radius: style.borderTopLeftRadius,
    };
  });
}

// 12. Alerts: a 4px edge in the tone, a rendered glyph tile with readable inverse ink,
//     readable title and body text, one-line compact alerts 28px high (27px as a banner,
//     which has no top border), and square banners.
async function checkAlerts(run) {
  if (!run.wants('alerts') || !await run.page.locator('.docs-demo .cb-alert').count()) {
    return;
  }
  await run.page.setViewportSize(DESKTOP_VIEWPORT);
  const alerts = await run.page.$$eval('.docs-demo .cb-alert', measureAlerts);
  for (const alert of alerts) {
    const glyphRatio = contrastRatio(alert.glyphInk, alert.tone);
    const textRatio = contrastRatio(alert.ink, alert.bg);
    const titleRatio = alert.titleInk ? contrastRatio(alert.titleInk, alert.bg) : null;
    const expectedHeight = alert.banner ? 27 : 28;
    const edgeOk = alert.edge === '4px' && alert.edgeColour.join() === alert.tone.join();
    const glyphOk = /"\S+"/.test(alert.glyph) && glyphRatio >= 4.5;
    const textOk = textRatio >= 4.5 && (titleRatio === null || titleRatio >= 4.5);
    const heightOk = !alert.sm || alert.lines > 1 || Math.round(alert.height) === expectedHeight;
    const cornersOk = !alert.banner || alert.radius === '0px';
    const name = `alert .${alert.key.replace(/ /g, '.')}: edge, glyph, contrast${alert.sm ? ', height' : ''}${alert.banner ? ', square' : ''}`;
    const titleDetail = titleRatio ? `, title ${titleRatio.toFixed(2)}` : '';
    const heightDetail = alert.sm ? `, ${Math.round(alert.height)}px` : '';
    const detail = `edge ${alert.edge}, glyph ${alert.glyph.split(' /')[0]} ${glyphRatio.toFixed(2)}, text ${textRatio.toFixed(2)}${titleDetail}${heightDetail}`;
    run.check(edgeOk && glyphOk && textOk && heightOk && cornersOk, name, detail);
  }
  await captureSectionShots(run, 'alerts');
}

// 13. Tabs: the selected tab takes its panel's colour and hides the line under it (one
//     sheet), long link lists scroll inside themselves at 360px, the tab chosen with End
//     stays in view, and vertical lists turn horizontal below 30rem.
async function checkTabs(run) {
  if (!run.wants('tabs') || !await run.page.locator('.docs-demo .cb-tabs').count()) {
    return;
  }
  const { page, check } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  // Right-to-left demos are measured by check 34; the physical edges here assume left to right.
  const sheets = await page.$$eval('.docs-demo .cb-tabs:not([dir="rtl"] *)', (sets) => sets.map((set, i) => {
    const tab = set.querySelector('.cb-tabs__tab:is([aria-selected="true"], [aria-current="page"])');
    const panel = set.querySelector('.cb-tabs__panel:not([hidden])');
    const surfaceOf = (element) => {
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const colour = getComputedStyle(ancestor).backgroundColor;
        if (colour !== 'rgba(0, 0, 0, 0)') {
          return colour;
        }
      }
      return '';
    };
    const vertical = getComputedStyle(tab.parentElement).flexDirection === 'column';
    const edge = getComputedStyle(tab)[vertical ? 'borderRightColor' : 'borderBottomColor'];
    return { index: i, bg: getComputedStyle(tab).backgroundColor, panel: surfaceOf(panel), edge, vertical };
  }));
  for (const sheet of sheets) {
    const name = `tab set ${sheet.index + 1}: selected tab and panel form one sheet${sheet.vertical ? ' (vertical)' : ''}`;
    const detail = `tab ${sheet.bg}, panel ${sheet.panel}, ${sheet.vertical ? 'end' : 'bottom'} edge ${sheet.edge}`;
    check(sheet.bg === sheet.panel && sheet.edge === sheet.bg, name, detail);
  }

  await page.setViewportSize({ width: 360, height: 900 });
  const narrow = await page.evaluate(() => {
    const lists = [...document.querySelectorAll('.docs-demo .cb-tabs__list')];
    const longList = lists.find((list) => list.scrollWidth > list.clientWidth);
    const verticalList = document.querySelector('.docs-demo .cb-tabs--vertical > .cb-tabs__list');
    return {
      scrolls: Boolean(longList),
      overflow: document.documentElement.scrollWidth > innerWidth,
      verticalRow: verticalList ? getComputedStyle(verticalList).flexDirection : 'none',
    };
  });
  check(narrow.scrolls && !narrow.overflow, 'tab lists scroll inside themselves at 360px, page does not', JSON.stringify(narrow));
  const scrolledList = page.locator('.docs-demo [data-cb-tabs] [role="tablist"]').first();
  await scrolledList.locator('[aria-selected="true"]').focus();
  await page.keyboard.press('End');
  const inView = await scrolledList.evaluate((list) => {
    const tabBox = list.querySelector('[aria-selected="true"]').getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    return tabBox.left >= listBox.left - 1 && tabBox.right <= listBox.right + 1;
  });
  await page.keyboard.press('Home');
  check(inView, 'the tab selected with End is scrolled into view');
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const wideDirection = await page.$eval('.docs-demo .cb-tabs--vertical > .cb-tabs__list', (list) => getComputedStyle(list).flexDirection).catch(() => 'none');
  check(wideDirection === 'column' && narrow.verticalRow === 'row', 'vertical tabs stand at 1360px and lie flat at 360px', `${wideDirection} / ${narrow.verticalRow}`);

  await captureSectionShots(run, 'tabs');
}

// 13b. A native disabled tab (a <button role="tab" disabled>) looks like an aria-disabled one.
async function checkDisabledTab(run) {
  if (!run.wants('tabs') || !await run.page.locator('.docs-demo .cb-tabs__tab:disabled').count()) {
    return;
  }
  const look = await run.page.locator('.docs-demo .cb-tabs__tab:disabled').first().evaluate((tab) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-text-disabled)';
    const disabledInk = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(tab);
    return { want: disabledInk, ink: style.color, cursor: style.cursor };
  });
  run.check(look.ink === look.want && look.cursor === 'not-allowed', 'a native disabled tab takes the disabled ink', JSON.stringify(look));
}

// In-page: navigation and tree measurements on the demos.
function measureNavigation() {
  // Left-to-right rows only: right-to-left offsets mirror (check 34).
  const rows = [...document.querySelectorAll('.docs-demo .cb-nav__link:not([dir="rtl"] *)')].filter((row) => row.getClientRects().length);
  const heights = [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)))];
  const current = document.querySelector('.docs-demo .cb-nav__link[aria-current="page"], .docs-demo [aria-selected="true"] > .cb-nav__link');
  const probe = document.body.appendChild(document.createElement('i'));
  probe.style.color = 'var(--cb-bg-selected)';
  const selectedColour = getComputedStyle(probe).color;
  probe.remove();
  const currentStyle = getComputedStyle(current);

  // Text start of each visible row, relative to its list item, grouped by nesting depth.
  const startsByGroup = {};
  for (const row of rows) {
    const textNode = [...row.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim()) ?? row.querySelector('.cb-nav__kind');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    let depth = 0;
    for (let ancestor = row.parentElement; ancestor && !ancestor.classList.contains('cb-nav'); ancestor = ancestor.parentElement) {
      if (ancestor.classList.contains('cb-nav__list')) {
        depth++;
      }
    }
    const navId = row.closest('.cb-nav').dataset.vbNav ??= Math.random();
    const group = `${navId}${depth}`;
    startsByGroup[group] ??= new Set();
    startsByGroup[group].add(String(Math.round(range.getBoundingClientRect().left)));
  }
  const raggedCount = Object.values(startsByGroup).filter((starts) => starts.size > 1).length;

  const lineItems = [...document.querySelectorAll('.docs-demo .cb-nav--lines .cb-nav__list .cb-nav__list > li')].filter((item) => item.getClientRects().length);
  const badLineCount = lineItems.filter((item) => {
    const line = getComputedStyle(item, '::before');
    const lineHeight = parseFloat(line.height);
    if (line.borderLeftWidth !== '1px') {
      return true;
    }
    return item.matches(':last-child') ? Math.abs(lineHeight - 12) > 0.5 : lineHeight < 23;
  }).length;
  const busyRow = document.querySelector('.docs-demo [aria-busy="true"] > .cb-nav__link');
  const separators = [...document.querySelectorAll('.docs-demo .cb-breadcrumb > li + li')].map((item) => getComputedStyle(item, '::before').content);
  return {
    heights,
    bg: currentStyle.backgroundColor,
    selected: selectedColour,
    bar: currentStyle.backgroundImage.startsWith('linear-gradient') && currentStyle.backgroundSize.startsWith('2px'),
    ragged: raggedCount,
    lines: lineItems.length,
    badLines: badLineCount,
    spin: busyRow ? getComputedStyle(busyRow, '::before').animationName : 'none',
    seps: separators,
  };
}

// 14. Navigation and trees: 24px rows, the current or selected row paints the selected
//     tint with a 2px accent bar, leaf and branch labels line up, --lines draws a 1px
//     vertical per nested item (stopping at the row centre on the last one), a loading
//     branch spins (and stops under reduced motion), and breadcrumb separators are silent.
async function checkNavigation(run) {
  if (!run.wants('nav') || !await run.page.locator('.docs-demo .cb-nav').count()) {
    return;
  }
  const { page, check } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const nav = await page.evaluate(measureNavigation);
  check(nav.heights.length === 1 && nav.heights[0] === 24, 'navigation rows are 24px', `${nav.heights.join(', ')}px`);
  check(nav.bg === nav.selected && nav.bar, 'current and selected rows paint the selected tint and a 2px accent bar', `${nav.bg}, bar ${nav.bar}`);
  check(nav.ragged === 0, 'leaf and branch labels start at the same offset per level', `${nav.ragged} ragged levels`);
  check(nav.lines > 0 && nav.badLines === 0, 'tree lines: a 1px vertical per nested item, the last one stops at the row centre', `${nav.lines} items, ${nav.badLines} wrong`);
  check(nav.spin === 'cb-spin', 'a loading branch shows the spinner in place of the chevron', nav.spin);
  const silentSeparators = nav.seps.length > 0 && nav.seps.every((content) => /\/ ""$/.test(content));
  check(silentSeparators, 'breadcrumb separators have empty alt text', nav.seps[0] ?? 'none');

  const calmContext = await run.browser.newContext({ ...run.contextOptions, reducedMotion: 'reduce' });
  const calmPage = await run.openPage({ browserContext: calmContext });
  const spin = await calmPage.$eval('.docs-demo [aria-busy="true"] > .cb-nav__link', (row) => getComputedStyle(row, '::before').animationName).catch(() => 'missing');
  check(spin === 'none', 'loading branches stop spinning under reduced motion', spin);
  await calmContext.close();

  await captureSectionShots(run, 'nav');
}

// 14b. A disabled navigation link (aria-disabled, no href) takes the disabled ink and no hover fill.
async function checkDisabledNavLink(run) {
  if (!run.wants('nav') || !await run.page.locator('.docs-demo .cb-nav__link[aria-disabled="true"]').count()) {
    return;
  }
  const { page } = run;
  const link = page.locator('.docs-demo .cb-nav__link[aria-disabled="true"]').first();
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  const look = await link.evaluate((element) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-text-disabled)';
    const disabledInk = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    return { want: disabledInk, ink: style.color, hoverFill: style.backgroundColor, cursor: style.cursor };
  });
  await page.mouse.move(2, 2);
  const ok = look.ink === look.want && look.hoverFill === 'rgba(0, 0, 0, 0)' && look.cursor === 'not-allowed';
  run.check(ok, 'a disabled navigation link is muted, refuses the pointer and takes no hover fill', JSON.stringify(look));
}

// Engine pseudo-elements cannot be read through getComputedStyle, so meters are checked on
// pixels: the element is screenshotted and the PNG decoded in the page. Returns a reader of the
// pixel at a fraction (x, y) of the element's box, as [r, g, b].
async function readPixels(page, locator) {
  const pngBase64 = (await locator.screenshot({ animations: 'disabled' })).toString('base64');
  return (fractionX, fractionY) => page.evaluate(async ([base64, x, y]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const canvasContext = canvas.getContext('2d');
    canvasContext.drawImage(image, 0, 0);
    const pixelX = Math.min(image.width - 1, Math.floor(x * image.width));
    const pixelY = Math.min(image.height - 1, Math.floor(y * image.height));
    return [...canvasContext.getImageData(pixelX, pixelY, 1, 1).data].slice(0, 3);
  }, [pngBase64, fractionX, fractionY]);
}

function colourDistance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

// In-page: what one meter or progress bar should show: the tone its value implies, its sizes,
// filled fraction, ruler and animation.
function describeMeter(element) {
  const isMeter = element.tagName === 'METER';
  const has = (attribute) => element.hasAttribute(attribute);
  let tone = 'accent';
  if (isMeter && (has('low') || has('high'))) {
    const { min, max, low, high, value } = element;
    const optimum = has('optimum') ? element.optimum : (min + max) / 2;
    if (optimum < low) {
      if (value < low) {
        tone = 'ok';
      } else {
        tone = value <= high ? 'warn' : 'danger';
      }
    } else if (optimum > high) {
      if (value > high) {
        tone = 'ok';
      } else {
        tone = value >= low ? 'warn' : 'danger';
      }
    } else {
      tone = value >= low && value <= high ? 'ok' : 'warn';
    }
  }
  const style = getComputedStyle(element);
  const stripHeight = parseFloat(style.paddingBottom);
  const indeterminate = element.matches(':indeterminate');
  const height = element.getBoundingClientRect().height;
  const minimum = element.min ?? 0;
  const maximum = element.max ?? 1;
  const fraction = isMeter || !indeterminate ? (element.value - minimum) / (maximum - minimum) : 0;
  return {
    key: `${element.tagName.toLowerCase()} ${element.className} ${tone}${indeterminate ? ' indeterminate' : ''}`,
    tone,
    indeterminate,
    h: height,
    track: height - stripHeight,
    strip: stripHeight,
    sm: element.classList.contains('cb-meter--sm'),
    fraction,
    ticks: element.classList.contains('cb-meter--ticks'),
    low: element.style.getPropertyValue('--_low'),
    high: element.style.getPropertyValue('--_high'),
    animation: style.animationName,
  };
}

// 15. Meters and progress, on pixels (readPixels). The fill at 5% must be nearest to the tone
//     the browser's own reading implies (low / high / optimum; neutral meters and progress use
//     the accent) and stand >= 3:1 against the empty track; tracks are 12px (6px compact);
//     indeterminate progress stands still; --ticks and data-cb-marks draw into the strip under
//     the track.
async function checkMeters(run) {
  if (!run.wants('meters') || !await run.page.locator('.docs-demo .cb-meter').count()) {
    return;
  }
  const { page, check } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const tones = await page.evaluate((toneNames) => {
    const rgbByTone = {};
    const probe = document.body.appendChild(document.createElement('i'));
    for (const toneName of toneNames) {
      probe.style.color = `var(--cb-${toneName})`;
      rgbByTone[toneName] = getComputedStyle(probe).color.match(/\d+/g).slice(0, 3).map(Number);
    }
    probe.remove();
    return rgbByTone;
  }, METER_TONES);
  const nearestTone = (pixel, toneNames) => toneNames.reduce((best, toneName) => {
    return colourDistance(pixel, tones[toneName]) < colourDistance(pixel, tones[best]) ? toneName : best;
  });

  const meters = page.locator('.docs-demo .cb-meter');
  const seenLooks = new Set();
  for (let i = 0; i < await meters.count(); i++) {
    const meter = meters.nth(i);
    // A meter inside a closed dialog (the session-timeout recipe) has no box to read.
    if (!await meter.isVisible()) {
      continue;
    }
    const info = await meter.evaluate(describeMeter);
    if (seenLooks.has(info.key)) {
      continue;
    }
    seenLooks.add(info.key);
    await meter.scrollIntoViewIfNeeded();
    const pixelAt = await readPixels(page, meter);
    const midTrack = (info.track / 2) / info.h;
    const expectedTrack = info.sm ? 6 : 12;
    const findings = [];
    let ok = Math.round(info.track) === expectedTrack;
    findings.push(`track ${info.track}px`);
    if (!info.indeterminate) {
      const fill = await pixelAt(0.05, midTrack);
      const empty = await pixelAt((Math.min(info.fraction, 0.96) + 1) / 2, midTrack);
      const fillTone = nearestTone(fill, ['ok', 'warn', 'danger', 'accent']);
      const fillRatio = contrastRatio(fill, empty);
      ok &&= fillTone === info.tone && (info.fraction > 0.97 || fillRatio >= 3);
      findings.push(`fill ${fillTone} (want ${info.tone}), vs track ${fillRatio.toFixed(2)}`);
    } else {
      const firstShot = (await meter.screenshot()).toString('base64');
      await page.waitForTimeout(300);
      const secondShot = (await meter.screenshot()).toString('base64');
      ok &&= info.animation === 'none' && firstShot === secondShot;
      findings.push(`still ${firstShot === secondShot}, animation ${info.animation}`);
      // The hatch is drawn: about half of the track is the darker stripe (Firefox once drew a
      // repeating gradient with a color-mix() stop as hairlines on a flat track).
      const samples = [];
      for (let sample = 0; sample < 40; sample++) {
        samples.push(await pixelAt(0.05 + 0.9 * sample / 39, midTrack));
      }
      const black = [0, 0, 0];
      const lightest = samples.reduce((lighter, candidate) => (contrastRatio(candidate, black) > contrastRatio(lighter, black) ? candidate : lighter));
      const stripeCount = samples.filter((sample) => contrastRatio(sample, lightest) >= 1.4).length;
      ok &&= stripeCount >= 10;
      findings.push(`${stripeCount}/40 samples on a stripe`);
    }
    check(ok, `meter: ${info.key.trim()}`, findings.join(', '));

    const ruler = [];
    let rulerOk = true;
    const stripY = (info.h - 1) / info.h;
    if (info.ticks) {
      const tick = await pixelAt(0.5, stripY);
      const tickTone = nearestTone(tick, ['border-main', 'bg-surface', 'text-main']);
      rulerOk &&= tickTone !== 'bg-surface';
      ruler.push(`tick at 50% ${tickTone}`);
    }
    if (info.low || info.high) {
      const width = (await meter.boundingBox()).width;
      const markFractions = [info.low, info.high].filter(Boolean).map(Number);
      for (const fraction of markFractions) {
        const markX = ((width - 2) * fraction + 1) / width;
        const mark = await pixelAt(markX, stripY);
        const markTone = nearestTone(mark, ['text-main', 'border-main', 'bg-surface']);
        rulerOk &&= markTone === 'text-main';
        ruler.push(`mark at ${(fraction * 100).toFixed(0)}% ${markTone}`);
      }
    }
    // Without a ruler strip (Firefox) there is nothing to probe: the pixels under the track
    // could land on its border and pass by chance, so the check fails as an engine limit.
    if (ruler.length) {
      check(info.strip > 0 && rulerOk, `meter ruler: ${info.key.trim()}`, info.strip > 0 ? ruler.join(', ') : 'no ruler strip');
    }
  }
  const rowHeights = await page.$$eval('.docs-demo .cb-table:has(.cb-meter--sm) tbody tr', (rows) => {
    return [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)))];
  });
  if (rowHeights.length) {
    check(rowHeights.length === 1 && rowHeights[0] === 28, 'table rows with compact meters stay 28px', `${rowHeights.join(', ')}px`);
  }

  await captureSectionShots(run, 'meters');
}

// 16. Segmented controls: the checked key is sunk on the selected tint and the others are
//     not, a click and the arrow keys move the choice, the input covers its key exactly (so
//     the focus ring frames the key), disabled keys and disabled fieldsets refuse a choice,
//     checkbox groups keep several keys on, and --fill keys share the row equally.
async function checkSegmented(run) {
  if (!run.wants('segmented') || !await run.page.locator('.docs-demo .cb-segmented').count()) {
    return;
  }
  const { page, check } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const look = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-selected)';
    const selectedColour = getComputedStyle(probe).color;
    probe.style.boxShadow = 'var(--cb-shadow-pressed)';
    const pressedShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    const keys = [...document.querySelectorAll('.docs-demo .cb-segmented > .cb-btn')].filter((key) => !key.querySelector(':disabled'));
    const wrong = keys.filter((key) => {
      const style = getComputedStyle(key);
      if (key.querySelector(':checked')) {
        return style.backgroundColor !== selectedColour || style.boxShadow !== pressedShadow;
      }
      return style.backgroundColor === selectedColour;
    }).map((key) => key.textContent.trim());
    const covers = keys.every((key) => {
      const keyBox = key.getBoundingClientRect();
      const inputBox = key.querySelector('input').getBoundingClientRect();
      return Math.abs(keyBox.x - inputBox.x) < 0.5 && Math.abs(keyBox.y - inputBox.y) < 0.5
        && Math.abs(keyBox.width - inputBox.width) < 0.5 && Math.abs(keyBox.height - inputBox.height) < 0.5;
    });
    return { keys: keys.length, wrong, covers };
  });
  check(look.wrong.length === 0, 'segmented: checked keys are sunk on the selected tint, others are not', `${look.keys} keys${look.wrong.length ? ', wrong: ' + look.wrong.join(', ') : ''}`);
  check(look.covers, 'segmented: each input covers its key exactly, so the focus ring frames the key');

  // A group of three or more keys, so ArrowRight from a first key needs no wrap-around (WebKit does not wrap).
  const group = page.locator('.docs-demo .cb-segmented[role="radiogroup"]:has(> .cb-btn:nth-child(3))').first();
  const readCheckedValue = () => group.evaluate((element) => element.querySelector(':checked')?.value);
  const start = await readCheckedValue();
  await group.locator('.cb-btn:not(:has(:checked))').first().click();
  const clicked = await readCheckedValue();
  await group.locator(':checked').focus();
  await page.keyboard.press('ArrowRight');
  const arrowed = await readCheckedValue();
  check(clicked !== start && arrowed !== clicked, 'segmented: a click and the arrow keys move the choice', `${start} -> click ${clicked} -> ArrowRight ${arrowed}`);

  const refused = await page.evaluate(() => {
    const key = document.querySelector('.docs-demo .cb-segmented > .cb-btn:has(> input:disabled:not(:checked))');
    const input = key.querySelector('input');
    key.click();
    const fieldset = document.querySelector('.docs-demo fieldset.cb-segmented[disabled]');
    const fieldsetAll = fieldset ? [...fieldset.querySelectorAll('input')].every((fieldInput) => fieldInput.matches(':disabled')) : null;
    return { keyChecked: input.checked, keyCursor: getComputedStyle(key).cursor, fieldsetAll };
  });
  const refuses = !refused.keyChecked && refused.keyCursor === 'not-allowed' && refused.fieldsetAll !== false;
  check(refuses, 'segmented: disabled keys and disabled fieldsets refuse a choice', JSON.stringify(refused));

  const checkedCount = await page.$eval('.docs-demo .cb-segmented[role="group"]', (element) => element.querySelectorAll(':checked').length);
  check(checkedCount > 1, 'segmented: a checkbox group keeps several keys on', `${checkedCount} on`);

  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const fill = await page.$eval('.docs-demo .cb-segmented--fill', (element) => {
      const widths = [...element.children].map((key) => key.getBoundingClientRect().width);
      const parentWidth = element.parentElement.getBoundingClientRect().width;
      return {
        spread: Math.max(...widths) - Math.min(...widths),
        span: Math.abs(element.getBoundingClientRect().width - parentWidth),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    check(fill.spread <= 1 && fill.span <= 1 && !fill.overflow, `segmented --fill keys share the row equally at ${width}px`, JSON.stringify(fill));
  }

  await captureSectionShots(run, 'segmented');
}

// In-page: summary rows whose chevron does not follow the one chevron rule.
function measureChevrons() {
  const summarySelector = '.docs-demo :is(summary.cb-panel__head, summary.cb-nav__link, [aria-expanded]:not([aria-busy="true"]) > .cb-nav__link, .cb-details > summary):not([dir="rtl"] *)';
  const rows = [...document.querySelectorAll(summarySelector)].filter((row) => row.getClientRects().length);
  const bad = rows.filter((row) => {
    const chevron = getComputedStyle(row, '::before');
    const open = row.parentElement.matches('details[open], [aria-expanded="true"]');
    return chevron.rotate !== (open ? '45deg' : '-45deg') || chevron.marginLeft !== '4px' || !/flex/.test(getComputedStyle(row).display);
  }).map((row) => row.textContent.trim().slice(0, 20));
  return { rows: rows.length, bad };
}

// In-page: summary heights, seams between stacked blocks, meta at the row end, and the inline
// variant's frame and alignment.
function measureDetailsGeometry() {
  const blocks = [...document.querySelectorAll('.docs-demo .cb-details')];
  const wrongHeights = [];
  for (const block of blocks) {
    const summary = block.querySelector(':scope > summary');
    const height = Math.round(summary.getBoundingClientRect().height);
    const expected = block.matches('.cb-details--sm, .cb-details--inline') ? 24 : 28;
    if (height !== expected) {
      wrongHeights.push(`${summary.textContent.trim()} ${height}px`);
    }
  }
  const wrongSeams = [];
  for (const block of blocks) {
    if (!block.nextElementSibling?.matches('.cb-details') || block.parentElement.matches('.cb-stack, .cb-grid, .cb-cluster')) {
      continue;
    }
    const gap = block.nextElementSibling.getBoundingClientRect().top - block.getBoundingClientRect().bottom;
    if (Math.abs(gap + 1) >= 0.5) {
      wrongSeams.push(`${gap}px`);
    }
  }
  const metaOffsets = [...document.querySelectorAll('.docs-demo .cb-details > summary > :is(.cb-badge, .cb-led):last-child')].map((meta) => {
    const summaryBox = meta.parentElement.getBoundingClientRect();
    const contentEnd = summaryBox.right - parseFloat(getComputedStyle(meta.parentElement).paddingRight);
    return Math.abs(contentEnd - meta.getBoundingClientRect().right);
  });
  const inline = document.querySelector('.docs-demo .cb-details--inline');
  const inlineStyle = getComputedStyle(inline);
  const summaryText = document.createRange();
  summaryText.selectNodeContents(inline.querySelector('summary').firstChild);
  const textLeft = summaryText.getBoundingClientRect().left;
  inline.open = true;
  const body = inline.querySelector('.cb-details__body');
  const bodyLeft = body.getBoundingClientRect().left + parseFloat(getComputedStyle(body).paddingLeft);
  inline.open = false;
  return {
    heights: wrongHeights,
    seams: wrongSeams,
    metaOff: Math.max(...metaOffsets),
    inlineFrame: inlineStyle.borderTopWidth === '0px' && inlineStyle.backgroundColor === 'rgba(0, 0, 0, 0)',
    align: Math.abs(textLeft - bodyLeft),
  };
}

// 17. Details and disclosure: one chevron rule reaches every summary (panels, nav, tree,
//     details): -45deg closed, 45deg open, 0.25rem margin, no native marker. Summary rows are
//     28px (24px compact and inline), stacked blocks share a 1px seam, Enter and Space toggle,
//     a named group keeps one block open, meta sits at the row end, and inline blocks have no
//     frame and line their body up with the summary text.
async function checkDetails(run) {
  if (!run.wants('details') || !await run.page.locator('.docs-demo .cb-details').count()) {
    return;
  }
  const { page, check } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const chevrons = await page.evaluate(measureChevrons);
  const chevronDetail = `${chevrons.rows} rows${chevrons.bad.length ? ', wrong: ' + chevrons.bad.join(' | ') : ''}`;
  check(chevrons.rows > 0 && chevrons.bad.length === 0, 'one chevron rule: every summary row turns -45deg / 45deg with a 0.25rem margin and no marker', chevronDetail);

  const geometry = await page.evaluate(measureDetailsGeometry);
  check(geometry.heights.length === 0, 'summary rows are 28px (24px compact and inline)', geometry.heights.join(', ') || 'all match');
  check(geometry.seams.length === 0, 'stacked details share a 1px seam (outside gap layouts)', geometry.seams.join(', ') || 'all seams 1px');
  check(geometry.metaOff < 1, 'summary meta sits at the end of the row', `${geometry.metaOff.toFixed(2)}px off`);
  const inlineDetail = `frameless ${geometry.inlineFrame}, offset ${geometry.align.toFixed(2)}px`;
  check(geometry.inlineFrame && geometry.align < 1, 'inline details have no frame and their body lines up with the summary text', inlineDetail);

  const named = page.locator('.docs-demo .cb-details[name]');
  const firstSummary = named.nth(0).locator('summary');
  const secondSummary = named.nth(1).locator('summary');
  await firstSummary.scrollIntoViewIfNeeded();
  await secondSummary.focus();
  await page.keyboard.press('Enter');
  const afterEnter = await named.evaluateAll((blocks) => blocks.map((block) => block.open));
  await page.keyboard.press('Space');
  const afterSpace = await named.evaluateAll((blocks) => blocks.map((block) => block.open));
  check(afterEnter[1] && !afterEnter[0] && !afterSpace[1], 'Enter and Space toggle a summary; a named group keeps one block open', `Enter ${afterEnter}, Space ${afterSpace}`);
  await firstSummary.click();

  await captureSectionShots(run, 'details');
}

// In-page, with one dialog open: whether it is a proper modal, and its size and frame.
function measureOpenDialog([dialogId, backdropColour]) {
  const dialog = document.getElementById(dialogId);
  const box = dialog.getBoundingClientRect();
  const style = getComputedStyle(dialog);
  const autofocusElement = dialog.querySelector('[autofocus]');
  const body = dialog.querySelector('.cb-panel__body');
  const footBox = dialog.querySelector('.cb-panel__foot').getBoundingClientRect();
  // The page under the modal must not take the pointer: probe a navigation link.
  const navBox = document.querySelector('.docs-nav__link').getBoundingClientRect();
  const hit = document.elementFromPoint(navBox.x + 2, navBox.y + 2);
  return {
    modal: dialog.matches(':modal'),
    focusInside: dialog.contains(document.activeElement),
    onAutofocus: !autofocusElement || document.activeElement === autofocusElement,
    backdrop: getComputedStyle(dialog, '::backdrop').backgroundColor === backdropColour,
    inert: !hit || !hit.closest('.docs-nav'),
    width: Math.round(box.width),
    height: box.height,
    stripe: style.borderTopWidth,
    scrolls: body.scrollHeight > body.clientHeight,
    footIn: footBox.bottom <= innerHeight,
    sm: dialog.classList.contains('cb-dialog--sm'),
    lg: dialog.classList.contains('cb-dialog--lg'),
    danger: dialog.classList.contains('cb-dialog--danger'),
  };
}

// 18. Modal dialogs: a data-cb-modal button opens its dialog as a modal with focus inside
//     (on the autofocus element when there is one) and the page inert under the backdrop
//     token; Escape closes it and focus returns to the opener; a method="dialog" button
//     reports its value; a typed confirmation refuses a wrong name; widths follow --sm,
//     default and --lg, --danger has a 3px stripe, a long dialog fits the viewport with a
//     scrolling body, and below 40rem a dialog fills the screen.
async function checkDialogs(run) {
  if (!run.wants('dialogs') || !await run.page.locator('.docs-demo [data-cb-modal]').count()) {
    return;
  }
  const { page, check, snap } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const backdropColour = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-backdrop)';
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  const dialogIds = await page.$$eval('.docs-demo [data-cb-modal]', (openers) => openers.map((opener) => opener.getAttribute('data-cb-modal')));
  for (const dialogId of dialogIds) {
    const opener = page.locator(`[data-cb-modal="${dialogId}"]`);
    await opener.scrollIntoViewIfNeeded();
    await opener.focus();
    await page.keyboard.press('Enter');
    const opened = await page.evaluate(measureOpenDialog, [dialogId, backdropColour]);
    await snap(page, `dialog-${dialogId}.png`);
    let expectedWidth = 576;
    if (opened.sm) {
      expectedWidth = 384;
    } else if (opened.lg) {
      expectedWidth = 896;
    }
    const sized = opened.width === expectedWidth && opened.height <= 900 - 48 && opened.footIn && (!opened.danger || opened.stripe === '3px');
    const isModal = opened.modal && opened.focusInside && opened.onAutofocus && opened.backdrop && opened.inert;
    const detail = `${opened.width}x${Math.round(opened.height)}, stripe ${opened.stripe}${opened.scrolls ? ', body scrolls' : ''}`;
    check(isModal && sized, `dialog #${dialogId} opens as a modal: focus inside, page inert, backdrop token, ${expectedWidth}px wide`, detail);
    await page.keyboard.press('Escape');
    const closed = await page.evaluate((id) => ({
      open: document.getElementById(id).open,
      back: document.activeElement?.getAttribute('data-cb-modal') === id,
    }), dialogId);
    check(!closed.open && closed.back, `dialog #${dialogId}: Escape closes it and focus returns to the opener`, JSON.stringify(closed));
  }

  // At least one demo dialog (the long form) must overflow and scroll its body.
  const scrollsBody = [];
  for (const dialogId of dialogIds) {
    await page.click(`[data-cb-modal="${dialogId}"]`);
    const scrolls = await page.evaluate((id) => {
      const body = document.getElementById(id).querySelector('.cb-panel__body');
      return body.scrollHeight > body.clientHeight;
    }, dialogId);
    scrollsBody.push(scrolls);
    await page.keyboard.press('Escape');
  }
  check(scrollsBody.some(Boolean), 'a long dialog scrolls its body between a fixed head and foot', `${scrollsBody.filter(Boolean).length} of ${scrollsBody.length} dialogs`);

  const typedField = await page.locator('.docs-demo dialog [pattern][required]').first();
  if (await typedField.count()) {
    const dialogId = await typedField.evaluate((field) => field.closest('dialog').id);
    const pattern = await typedField.getAttribute('pattern');
    const readDialog = () => page.$eval(`#${dialogId}`, (dialog) => ({ open: dialog.open, value: dialog.returnValue }));
    await page.click(`[data-cb-modal="${dialogId}"]`);
    const confirmButton = page.locator(`#${dialogId} .cb-btn--danger-solid`);
    await confirmButton.click();
    const openWhenEmpty = await page.$eval(`#${dialogId}`, (dialog) => dialog.open);
    await typedField.fill('gw-wrong');
    await confirmButton.click();
    const openWhenWrong = await page.$eval(`#${dialogId}`, (dialog) => dialog.open);
    await typedField.fill(pattern);
    await confirmButton.click();
    const confirmed = await readDialog();
    await page.click(`[data-cb-modal="${dialogId}"]`);
    await typedField.fill('');
    await page.locator(`#${dialogId} [formnovalidate]`).click();
    const cancelled = await readDialog();
    const refuses = openWhenEmpty && openWhenWrong;
    const closesRight = !confirmed.open && confirmed.value === await confirmButton.getAttribute('value');
    const closesOnCancel = !cancelled.open && cancelled.value === 'cancel';
    const detail = `empty ${openWhenEmpty}, wrong ${openWhenWrong}, right -> ${confirmed.value}, cancel -> ${cancelled.value}`;
    check(refuses && closesRight && closesOnCancel, 'typed confirmation refuses an empty or wrong name; the right name or Cancel closes it', detail);
  }

  await page.setViewportSize({ width: 360, height: 900 });
  await page.click(`[data-cb-modal="${dialogIds[0]}"]`);
  const narrow = await page.$eval(`#${dialogIds[0]}`, (dialog) => {
    const box = dialog.getBoundingClientRect();
    return { w: box.width, h: box.height, radius: getComputedStyle(dialog).borderTopLeftRadius };
  });
  await snap(page, `dialog-${dialogIds[0]}-360.png`);
  await page.keyboard.press('Escape');
  check(narrow.w === 360 && narrow.h === 900 && narrow.radius === '0px', 'below 40rem a dialog fills the screen', JSON.stringify(narrow));
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// In-page: pagination looks, sizes, seams, disabled arrows, gap cells, collapsed navs and the
// jump field.
function measurePagination() {
  const probe = document.body.appendChild(document.createElement('i'));
  probe.style.color = 'var(--cb-bg-selected)';
  const selectedColour = getComputedStyle(probe).color;
  probe.style.boxShadow = 'var(--cb-shadow-pressed)';
  const pressedShadow = getComputedStyle(probe).boxShadow;
  probe.remove();

  const keys = [...document.querySelectorAll('.docs-demo :is(.cb-pagination__pages, .cb-pagination__sizes) > .cb-btn')].filter((key) => {
    return key.getClientRects().length && key.getAttribute('aria-disabled') !== 'true';
  });
  const wrongSink = keys.filter((key) => {
    const style = getComputedStyle(key);
    const isCurrent = key.hasAttribute('aria-current');
    const looksSunk = style.backgroundColor === selectedColour && style.boxShadow === pressedShadow;
    return isCurrent !== looksSunk;
  }).map((key) => key.textContent.trim());
  const wrongSize = keys.filter((key) => {
    const box = key.getBoundingClientRect();
    return Math.round(box.height) !== 20 || box.width < 27.5;
  }).map((key) => key.textContent.trim());

  const strips = [...document.querySelectorAll('.docs-demo :is(.cb-pagination__pages, .cb-pagination__sizes)')].filter((strip) => strip.getClientRects().length);
  const badGaps = [];
  for (const strip of strips) {
    const children = [...strip.children].filter((child) => child.getClientRects().length);
    const expectedGap = strip.closest('.cb-pagination--spaced') ? 4 : -1;
    for (let i = 1; i < children.length; i++) {
      const gap = children[i].getBoundingClientRect().left - children[i - 1].getBoundingClientRect().right;
      if (Math.abs(gap - expectedGap) > 0.5) {
        badGaps.push(gap);
      }
    }
  }

  // Focusing each disabled arrow shows whether it left the tab order.
  const disabledArrows = [...document.querySelectorAll('.docs-demo .cb-pagination [aria-disabled="true"]')].map((arrow) => {
    arrow.focus();
    return { href: arrow.hasAttribute('href'), tab: document.activeElement === arrow ? 0 : -1, ink: getComputedStyle(arrow).color };
  });
  probe.style.color = 'var(--cb-text-disabled)';
  document.body.append(probe);
  const mutedInk = getComputedStyle(probe).color;
  probe.remove();

  const gapCells = [...document.querySelectorAll('.docs-demo .cb-pagination__gap')].filter((cell) => cell.getClientRects().length);
  const gapsOk = gapCells.every((cell) => cell.getAttribute('aria-hidden') === 'true' && Math.round(cell.getBoundingClientRect().height) === 20);
  const shownPages = (nav) => {
    const shown = [...nav.querySelectorAll('.cb-pagination__pages > *')].filter((child) => child.getClientRects().length);
    return shown.map((child) => child.textContent.trim()).join(' ');
  };
  const navs = [...document.querySelectorAll('.docs-demo .cb-pagination')];
  const narrowNav = navs.find((nav) => nav.closest('.cb-grid'));
  const wideNav = navs.find((nav) => nav.closest('.cb-panel__foot'));

  const jump = document.querySelector('.docs-demo .cb-pagination__jump input');
  const previousValue = jump.value;
  jump.value = String(Number(jump.max) + 1);
  const refusesOverMax = jump.matches(':invalid');
  jump.value = previousValue;

  return {
    keys: keys.length,
    wrongSink,
    wrongSize,
    badGaps,
    disabled: disabledArrows.every((arrow) => !arrow.href && arrow.tab === -1 && arrow.ink === mutedInk) && disabledArrows.length > 0,
    gapsOk,
    narrow: shownPages(narrowNav),
    wide: shownPages(wideNav),
    jump: jump.type === 'number' && jump.hasAttribute('min') && jump.hasAttribute('max') && refusesOverMax,
  };
}

// 19. Pagination: current page and size keys are sunk and the others are not, keys are 20px
//     high and at least 28px wide, attached strips overlap by 1px and spaced ones keep 4px,
//     disabled arrows have no href and leave the tab order, gap cells are silent and key-high,
//     narrow navs keep only the arrows and the current page (at 360px the wide one too),
//     and the jump field refuses a page above max.
async function checkPagination(run) {
  if (!run.wants('pagination') || !await run.page.locator('.docs-demo .cb-pagination').count()) {
    return;
  }
  const { page, check } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const look = await page.evaluate(measurePagination);
  check(look.wrongSink.length === 0, 'pagination: current page and size keys are sunk, the others are not', `${look.keys} keys${look.wrongSink.length ? ', wrong: ' + look.wrongSink.join(' ') : ''}`);
  check(look.wrongSize.length === 0, 'pagination keys are 20px high and at least 28px wide', look.wrongSize.join(' ') || 'all keys');
  check(look.badGaps.length === 0, 'pagination strips overlap by 1px; spaced strips keep 4px', look.badGaps.join(', ') || 'all seams');
  check(look.disabled, 'disabled arrows have no href, leave the tab order and are muted');
  check(look.gapsOk, 'gap cells are aria-hidden and as high as a key');
  check(look.narrow === '‹ 7 ›' && look.wide.split(' ').length > 3, 'a narrow pagination keeps only the arrows and the current page', `narrow "${look.narrow}", wide "${look.wide}"`);
  check(look.jump, 'the jump field is a number with min and max, and refuses a page above max');

  await page.setViewportSize({ width: 360, height: 900 });
  const at360 = await page.evaluate(() => {
    const pages = [...document.querySelector('.docs-demo .cb-panel__foot .cb-pagination__pages').children];
    const shown = pages.filter((child) => child.getClientRects().length).map((child) => child.textContent.trim());
    return { wide: shown.join(' '), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check(at360.wide === '‹ 7 ›' && !at360.overflow, 'at 360px the full pagination collapses with no page overflow', JSON.stringify(at360));

  await captureSectionShots(run, 'pagination');
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// In-page: text and chip utilities against the tokens they stand for.
function measureTextUtilities() {
  const probe = document.body.appendChild(document.createElement('i'));
  const tokenColour = (name) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const tokens = {
    muted: tokenColour('--cb-text-muted'),
    ok: tokenColour('--cb-ok'),
    warn: tokenColour('--cb-warn'),
    danger: tokenColour('--cb-danger'),
    info: tokenColour('--cb-info'),
    recessed: tokenColour('--cb-bg-recessed'),
    btn: tokenColour('--cb-bg-btn'),
  };
  probe.style.fontFamily = 'var(--cb-font-mono)';
  const monoFamily = getComputedStyle(probe).fontFamily;
  probe.remove();
  const styleOf = (selector) => getComputedStyle(document.querySelector(`.docs-demo ${selector}`));
  const keyStyle = styleOf('.cb-kbd');
  const tonesMatch = styleOf('.cb-muted').color === tokens.muted
    && styleOf('.cb-text-ok').color === tokens.ok
    && styleOf('.cb-text-warn').color === tokens.warn
    && styleOf('.cb-text-danger').color === tokens.danger
    && styleOf('.cb-text-info').color === tokens.info;
  return {
    mono: styleOf('.cb-mono').fontFamily === monoFamily && styleOf('.cb-mono').fontVariantLigatures === 'none',
    num: styleOf('.cb-num').fontVariantNumeric === 'tabular-nums',
    tones: tonesMatch,
    xs: styleOf('.cb-text-xs').fontSize === '12px',
    chips: styleOf('.cb-code').backgroundColor === tokens.recessed && keyStyle.backgroundColor === tokens.btn && keyStyle.boxShadow !== 'none',
    nowrap: document.querySelector('.docs-demo .cb-nowrap').getClientRects().length === 1,
  };
}

// 20. Utilities: computed values match their tokens, a truncated table cell ellipsises inside
//     its wrapper, long hashes wrap at 360px, hidden text stays in the accessibility tree,
//     the skip link appears on the first Tab, and the code and key chips use their surfaces.
async function checkUtilities(run) {
  if (!run.wants('utilities') || !await run.page.locator('.docs-demo .cb-mono').count()) {
    return;
  }
  const { page, check } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const utilities = await page.evaluate(measureTextUtilities);
  const textSummary = JSON.stringify({ mono: utilities.mono, num: utilities.num, tones: utilities.tones, xs: utilities.xs });
  check(utilities.mono && utilities.num && utilities.tones && utilities.xs, 'text utilities match their tokens (mono, tabular, tones, 12px)', textSummary);
  check(utilities.chips && utilities.nowrap, '.cb-code and .cb-kbd use their surfaces; .cb-nowrap stays on one line', JSON.stringify({ chips: utilities.chips, nowrap: utilities.nowrap }));

  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const truncation = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.docs-demo td.cb-truncate')];
      const hiddenWidth = (cell) => cell.scrollWidth - cell.clientWidth;
      const longest = cells.reduce((longer, cell) => (hiddenWidth(cell) > hiddenWidth(longer) ? cell : longer));
      const table = longest.closest('table');
      const wrapper = table.closest('.cb-table-wrap');
      return {
        cut: longest.scrollWidth > longest.clientWidth,
        ellipsis: getComputedStyle(longest).textOverflow === 'ellipsis',
        fits: table.getBoundingClientRect().width <= wrapper.clientWidth + 0.5,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const ok = truncation.ellipsis && truncation.fits && !truncation.overflow && (width === 1360 || truncation.cut);
    check(ok, `truncated cells ellipsise inside their wrapper, long hashes wrap (${width}px)`, JSON.stringify(truncation));
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);

  const hidden = await page.evaluate(() => [...document.querySelectorAll('.docs-demo .cb-sr-only')].every((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return style.display !== 'none' && box.width <= 1 && box.height <= 1 && style.clipPath !== 'none';
  }));
  const named = await page.getByRole('table', { name: 'Gateways and their load' }).count();
  const button = await page.getByRole('button', { name: 'Refresh gateways' }).count();
  check(hidden && named === 1 && button === 1, '.cb-sr-only text is invisible but names the table and the icon key', JSON.stringify({ hidden, named, button }));

  // The skip link is judged on a fresh page: the first Tab of a new document.
  const skipPage = await run.openPage();
  const restingBottom = await skipPage.$eval('.cb-skip-link', (link) => link.getBoundingClientRect().bottom);
  await skipPage.keyboard.press(run.tabKey);
  const skip = await skipPage.evaluate(() => {
    const focused = document.activeElement;
    const box = focused.getBoundingClientRect();
    return { cls: focused.className, top: box.top, bottom: box.bottom };
  });
  await skipPage.close();
  const appears = restingBottom < 0 && skip.cls === 'cb-skip-link' && skip.top >= 0 && skip.bottom <= 900;
  check(appears, 'the skip link is off screen until the first Tab, then visible', `rest bottom ${restingBottom}, focused top ${skip.top}`);

  await captureSectionShots(run, 'utilities');
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// In-page: whether the shell's sidebar shows, where it sits, and the Menu key's state.
function readSidebarFold() {
  const app = document.querySelector('body > .cb-app');
  const sidebar = app.querySelector('.cb-app__side');
  const menuKey = app.querySelector('.cb-app__top [data-cb-toggle]');
  const sidebarBox = sidebar.getBoundingClientRect();
  const otherTopKey = app.querySelector('.cb-app__top .cb-btn:not([data-cb-toggle])') ?? menuKey;
  return {
    side: sidebar.getClientRects().length > 0,
    below: sidebarBox.top >= app.querySelector('.cb-app__top').getBoundingClientRect().bottom - 0.5,
    above: sidebarBox.bottom <= app.querySelector('.cb-app__main').getBoundingClientRect().top + 0.5,
    key: menuKey.getClientRects().length > 0,
    expanded: menuKey.getAttribute('aria-expanded'),
    sunk: getComputedStyle(menuKey).boxShadow !== getComputedStyle(otherTopKey).boxShadow,
  };
}

// 23. Application frame (a page whose body holds a .cb-app, such as docs/example.html): at
//     1360 the shell fills the viewport with the top and status bars in view and main as its own
//     scroller; at 360 the sidebar stacks above main and the page scrolls; a sticky table keeps
//     its first column while its wrapper scrolls sideways.
async function checkApplicationFrame(run) {
  if (!run.wants('frame') || !await run.page.locator('body > .cb-app').count()) {
    return;
  }
  const { page, check, snap } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const wide = await page.evaluate(() => {
    const app = document.querySelector('body > .cb-app');
    const boxOf = (selector) => app.querySelector(selector).getBoundingClientRect();
    return {
      app: Math.round(app.getBoundingClientRect().height),
      top: boxOf('.cb-app__top').top,
      status: Math.round(boxOf('.cb-app__status').bottom),
      main: getComputedStyle(app.querySelector('.cb-app__main')).overflowY,
      page: document.documentElement.scrollHeight - innerHeight,
    };
  });
  const fillsViewport = wide.app === 900 && wide.top === 0 && wide.status === 900 && wide.main === 'auto' && wide.page <= 0;
  check(fillsViewport, 'application frame at 1360px: fills the viewport, bars in view, main scrolls on its own', JSON.stringify(wide));
  await page.setViewportSize({ width: 360, height: 900 });
  const narrow = await page.evaluate(() => ({
    page: document.documentElement.scrollHeight > innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  check(narrow.page && !narrow.overflow, 'application frame at 360px: the page scrolls, no overflow', JSON.stringify(narrow));

  // Below 50rem the sidebar folds away behind the top bar's Menu key; the key opens it between
  // the top bar and main and closes it again. Wide, the key is hidden and the sidebar shows.
  const menuKey = page.locator('body > .cb-app > .cb-app__top [data-cb-toggle]');
  if (await menuKey.count()) {
    // The key's look changes over --cb-duration (50ms); read it after that.
    const waitForKeyLook = () => settleTransitions(page);
    const closed = await page.evaluate(readSidebarFold);
    await menuKey.click();
    await waitForKeyLook();
    const opened = await page.evaluate(readSidebarFold);
    await menuKey.click();
    await waitForKeyLook();
    const closedAgain = await page.evaluate(readSidebarFold);
    const startsFolded = !closed.side && closed.key && closed.expanded === 'false';
    const opensBetween = opened.side && opened.below && opened.above && opened.expanded === 'true' && opened.sunk;
    const detail = JSON.stringify({ closed, opened, again: closedAgain });
    check(startsFolded && opensBetween && !closedAgain.side, 'application frame at 360px: the sidebar folds behind the Menu key, which opens it above main and closes it', detail);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const wideFold = await page.evaluate(readSidebarFold);
    check(wideFold.side && !wideFold.key, 'application frame at 1360px: the Menu key is hidden and the sidebar shows', JSON.stringify(wideFold));

    // Without the script the key stays hidden and the sidebar stacks above main.
    const noScriptContext = await run.browser.newContext({ ...run.contextOptions, viewport: { width: 360, height: 900 }, javaScriptEnabled: false });
    const noScriptPage = await run.openPage({ browserContext: noScriptContext });
    const plain = await noScriptPage.evaluate(() => {
      const app = document.querySelector('body > .cb-app');
      const boxOf = (selector) => app.querySelector(selector).getBoundingClientRect();
      return {
        key: app.querySelector('.cb-app__top [data-cb-toggle]').getClientRects().length > 0,
        stacked: boxOf('.cb-app__side').height > 0 && boxOf('.cb-app__side').bottom <= boxOf('.cb-app__main').top + 1,
      };
    });
    await noScriptContext.close();
    check(!plain.key && plain.stacked, 'application frame at 360px without the script: no Menu key, the sidebar stacked above main', JSON.stringify(plain));
    await page.setViewportSize({ width: 360, height: 900 });
  }

  const stickyTable = page.locator('body > .cb-app .cb-table--sticky').first();
  if (await stickyTable.count()) {
    await exposeControl(page, 'body > .cb-app .cb-table--sticky');
    await stickyTable.scrollIntoViewIfNeeded();
    const pinned = await stickyTable.evaluate((table) => {
      const wrapper = table.closest('.cb-table-wrap');
      const cell = table.querySelector('tbody tr > :nth-child(2)');
      const before = cell.getBoundingClientRect().left;
      wrapper.scrollLeft = wrapper.scrollWidth;
      const after = cell.getBoundingClientRect().left;
      const moved = wrapper.scrollLeft;
      wrapper.scrollLeft = 0;
      return { before, after, moved };
    });
    check(pinned.moved > 0 && Math.abs(pinned.before - pinned.after) < 1, 'application frame: the sticky table keeps its pinned column at 360px', JSON.stringify(pinned));
  }
  const widths = run.saving ? [1360, 800, 360] : [360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await snap(page, `example-${width}.png`);
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// 24. Density: inside [data-cb-density] (and at the default) fields and keys take
//     --cb-control-h, small keys --cb-control-h-sm, table rows --cb-row-h, a small key fits
//     its row, and panel heads take --cb-row-h plus --cb-space-1: 22 / 18 / 24 / 26 compact,
//     26 / 20 / 28 / 32 default, 30 / 24 / 32 / 38 comfortable.
async function checkDensity(run) {
  if (!run.wants('density') || !await run.page.locator('.docs-demo [data-cb-density]').count()) {
    return;
  }
  await run.page.setViewportSize(DESKTOP_VIEWPORT);
  const panels = await run.page.$$eval('.docs-demo .cb-grid:has([data-cb-density]) > .cb-panel', (densityPanels) => densityPanels.map((panel) => {
    const heightOf = (selector) => Math.round(panel.querySelector(selector).getBoundingClientRect().height);
    const row = panel.querySelector('tbody tr');
    const rowBox = row.getBoundingClientRect();
    const keyBox = row.querySelector('.cb-btn--sm').getBoundingClientRect();
    return {
      mode: panel.getAttribute('data-cb-density') ?? 'default',
      head: heightOf(':scope > .cb-panel__head'),
      field: heightOf('.cb-input'),
      segment: heightOf('.cb-segmented > .cb-btn'),
      small: heightOf('.cb-panel__head .cb-btn--sm'),
      row: Math.round(rowBox.height),
      fits: keyBox.bottom <= rowBox.bottom && keyBox.top >= rowBox.top,
    };
  }));
  for (const panel of panels) {
    const [control, small, row, head] = DENSITY_SIZES[panel.mode];
    const ok = panel.field === control && panel.segment === control && panel.small === small && panel.row === row && panel.fits && panel.head === head;
    const name = `density ${panel.mode}: controls ${control}px, small keys ${small}px, rows ${row}px with the key inside, panel head ${head}px`;
    const detail = `field ${panel.field}, segment ${panel.segment}, small ${panel.small}, row ${panel.row}, key fits ${panel.fits}, head ${panel.head}`;
    run.check(ok, name, detail);
  }
}

// In-page, on the focused element: its stop id, name, whether it shows the ring, and where the
// ring is clipped or the control partly scrolled out. Returns null when focus left the page.
// The ring must fit wherever the control itself is fully shown. A control partly scrolled out
// (of a scroller or of the viewport) is reported; one hidden entirely, or a whole control with a
// cut ring, fails.
function measureFocusStop(dateFields) {
  const focused = document.activeElement;
  if (!focused || focused === document.body || focused === document.documentElement) {
    return null;
  }
  if (!focused.dataset.vbStop) {
    focused.dataset.vbStop = String(document.querySelectorAll('[data-vb-stop]').length);
  }
  // On a tree item the ring is on its row label; on a token field's entry, on its well.
  let ringHolder = focused;
  if (focused.matches('[data-cb-tree] [role="treeitem"]')) {
    ringHolder = focused.querySelector(':scope > .cb-nav__link');
  } else if (focused.matches('.cb-tokens__entry')) {
    ringHolder = focused.closest('.cb-tokens');
  }
  const style = getComputedStyle(ringHolder);
  const ringWidth = parseFloat(style.outlineWidth);
  const grow = ringWidth + parseFloat(style.outlineOffset);
  const holderBox = ringHolder.getBoundingClientRect();
  const ring = { l: holderBox.left - grow, t: holderBox.top - grow, r: holderBox.right + grow, b: holderBox.bottom + grow };
  const classPart = focused.className && typeof focused.className === 'string' ? '.' + focused.className.trim().split(/\s+/).join('.') : '';
  const label = (focused.getAttribute('aria-label') || focused.textContent || '').trim().slice(0, 24);
  const name = `${focused.tagName.toLowerCase()}${focused.id ? '#' + focused.id : ''}${classPart} "${label}"`;
  const isFocusVisible = focused.matches(':focus-visible') || (focused.matches(dateFields) && focused.matches(':focus'));
  const visible = isFocusVisible && style.outlineStyle !== 'none' && ringWidth >= 2;

  let clip = '';
  let partial = '';
  const checkInside = (box, boxLabel, scrolls = false) => {
    const ringFits = !(ring.l < box.l - 0.5 || ring.t < box.t - 0.5 || ring.r > box.r + 0.5 || ring.b > box.b + 0.5);
    if (ringFits) {
      return;
    }
    // Outer clipping follows from the scroll position already reported.
    if (partial) {
      return;
    }
    const overlaps = holderBox.right > box.l && holderBox.left < box.r && holderBox.bottom > box.t && holderBox.top < box.b;
    const whole = holderBox.left >= box.l - 0.5 && holderBox.top >= box.t - 0.5 && holderBox.right <= box.r + 0.5 && holderBox.bottom <= box.b + 0.5;
    const cutBy = Math.max(box.l - ring.l, box.t - ring.t, ring.r - box.r, ring.b - box.b).toFixed(1);
    if (scrolls && overlaps && !whole) {
      partial = boxLabel;
    } else {
      clip ||= `${boxLabel} (${cutBy}px)`;
    }
  };
  for (let ancestor = ringHolder.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const ancestorStyle = getComputedStyle(ancestor);
    if (ancestorStyle.overflowX === 'visible' && ancestorStyle.overflowY === 'visible') {
      continue;
    }
    const ancestorBox = ancestor.getBoundingClientRect();
    const isScroller = ancestor.scrollWidth > ancestor.clientWidth + 1 || ancestor.scrollHeight > ancestor.clientHeight + 1;
    const left = ancestorBox.left + ancestor.clientLeft;
    const top = ancestorBox.top + ancestor.clientTop;
    const innerBox = { l: left, t: top, r: left + ancestor.clientWidth, b: top + ancestor.clientHeight };
    const ancestorLabel = ancestor.className && typeof ancestor.className === 'string' ? '.' + ancestor.className.trim().split(/\s+/)[0] : ancestor.tagName.toLowerCase();
    checkInside(innerBox, ancestorLabel, isScroller);
  }
  // A control taller or wider than the viewport cannot show its whole ring; judge the rest.
  if (ring.b - ring.t <= innerHeight && ring.r - ring.l <= innerWidth) {
    checkInside({ l: 0, t: 0, r: innerWidth, b: innerHeight }, 'viewport', true);
  }
  return { id: focused.dataset.vbStop, name, visible, clip, partial, segmented: focused.matches(dateFields) };
}

// Tabs through a fresh page at one width until focus leaves it; returns the stops counted and
// the problems found.
async function walkTabStops(run, width) {
  const auditPage = await run.openPage({ viewport: { width, height: 900 } });
  const seenStops = new Set();
  const invisible = [];
  const clipped = [];
  const partly = [];
  let stopCount = 0;
  let trap = '';
  let lastId = '';
  let segmentCount = 0;
  for (let i = 0; i < 3000; i++) {
    await auditPage.keyboard.press(run.tabKey);
    // Firefox and WebKit scroll to the focused control a frame later; measure after it.
    await auditPage.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    let stop = await auditPage.evaluate(measureFocusStop, SEGMENTED_DATE_FIELDS);
    // Under load an engine can scroll to the control later still (seen in WebKit with three runs
    // side by side, up to a quarter of a second and more): a stop the viewport cuts is measured
    // again, for up to a second, before it counts.
    for (let tries = 0; stop?.clip.includes('viewport') && tries < 20; tries++) {
      await auditPage.waitForTimeout(50);
      stop = await auditPage.evaluate(measureFocusStop, SEGMENTED_DATE_FIELDS);
    }
    if (!stop) {
      break;
    }
    // The next segment of a date or time field (at most 8): keep walking.
    if (stop.id === lastId && stop.segmented && segmentCount < 8) {
      segmentCount++;
      continue;
    }
    // Back at the first stop, or still on the last one (focus could not move on): the end.
    if (seenStops.has(stop.id)) {
      if (stop.id !== '0' && stop.id !== lastId) {
        trap = stop.name;
      }
      break;
    }
    lastId = stop.id;
    segmentCount = 0;
    seenStops.add(stop.id);
    stopCount++;
    if (!stop.visible) {
      invisible.push(stop.name);
    }
    if (stop.clip) {
      clipped.push(`${stop.name} by ${stop.clip}`);
    } else if (stop.partial) {
      partly.push(`${stop.name} in ${stop.partial}`);
    }
  }
  await auditPage.close();
  return { stopCount, trap, invisible, clipped, partly };
}

// 21. Keyboard audit: Tab from the top of a fresh page through every stop until focus leaves the
//     page. Each stop must show the indicator (on a tree item, on its row label; on a token field's
//     entry, on its well), and the ring, grown by its width and offset, must lie inside the
//     viewport and inside every clipping ancestor; a stop that repeats before the end is a trap.
//     Browsers do not scroll a partly visible control further on Tab, so a control may stay partly
//     scrolled out of a container or the viewport (allowed by WCAG 2.4.11 as long as it is not
//     hidden entirely); those stops are listed, not failed. A fully shown control with a cut ring
//     fails. Date and time fields take several Tab presses (one per segment) while focus stays on
//     the same element, so a repeat of such a field walks on instead of ending the audit.
async function checkKeyboardAudit(run) {
  const widths = run.wants('keyboard') ? [1360, 360] : [];
  for (const width of widths) {
    const walk = await walkTabStops(run, width);
    const { stopCount, trap, invisible, partly } = walk;
    const trapDetail = trap ? `, trap at ${trap}` : '';
    const ringDetail = invisible.length ? `; no ring: ${invisible.slice(0, 5).join(' | ')}` : '';
    run.check(stopCount >= 5 && !trap && invisible.length === 0, `keyboard audit at ${width}px: every Tab stop shows the focus ring, no trap`, `${stopCount} stops${trapDetail}${ringDetail}`);

    // Firefox and WebKit apply scroll-margin only when Tab has to scroll; a control already fully in view
    // at the viewport edge keeps a ring cut by at most the ring itself (3px). Those are listed, not failed.
    const edgeCuts = [];
    if (run.engine !== 'chromium') {
      for (const cut of walk.clipped) {
        if (!/by viewport \((\d+(?:\.\d+)?)px\)$/.test(cut)) {
          continue;
        }
        const cutBy = Number(cut.match(/\((\d+(?:\.\d+)?)px\)$/)[1]);
        if (cutBy <= 4) {
          edgeCuts.push(cut);
        }
      }
    }
    const clipped = walk.clipped.filter((cut) => !edgeCuts.includes(cut));
    for (const cut of edgeCuts) {
      partly.push(`${cut} [${run.engine}: no scroll-margin when already in view]`);
    }
    const partlyDetail = partly.length ? `${partly.length} partly scrolled out (${partly.join(' | ')})` : 'none partly scrolled out';
    let clippedDetail = '';
    if (clipped.length) {
      const more = clipped.length > 6 ? ` (+${clipped.length - 6})` : '';
      clippedDetail = `; clipped: ${clipped.slice(0, 6).join(' | ')}${more}`;
    }
    run.check(clipped.length === 0, `keyboard audit at ${width}px: no focus ring is clipped`, `${partlyDetail}${clippedDetail}`);
  }
}

// 22. The catalogue's contrast table (generated from scripts/contrast-pairs.mjs) matches the
//     live ratios row for row, in a column per theme (named in its head), so a token change
//     cannot leave it stale. Each theme is measured by setting it on <html> for a moment.
async function checkContrastTable(run, measuredPairs) {
  if (!run.wants('contrast') || run.theme) {
    return;
  }
  const table = await run.page.$eval('#a11y-contrast-table', (element) => ({
    head: [...element.tHead.rows[0].cells].map((cell) => cell.textContent.trim().toLowerCase()),
    rows: [...element.tBodies[0].rows].map((row) => [...row.cells].map((cell) => cell.textContent.trim())),
  })).catch(() => null);
  if (!table) {
    return;
  }
  const minimumColumn = table.head.indexOf('minimum');
  const themeColumns = THEME_NAMES.map((themeName) => [themeName, table.head.indexOf(themeName)]);
  const stale = [];
  for (const [themeName, column] of themeColumns) {
    if (column < 0) {
      stale.push(`no column for ${themeName}`);
    }
  }

  const setTheme = (themeName) => run.page.evaluate((name) => {
    if (name) {
      document.documentElement.dataset.cbTheme = name;
    } else {
      delete document.documentElement.dataset.cbTheme;
    }
  }, themeName);
  const ratiosByTheme = {};
  for (const [themeName] of themeColumns) {
    await setTheme(themeName);
    ratiosByTheme[themeName] = (await measurePairs(run.page)).map((pair) => pair.ratio);
  }
  await setTheme(null);

  measuredPairs.forEach((pair, i) => {
    const row = table.rows[i];
    const foreground = colourLabel(pair.fg);
    const background = colourLabel(pair.bg);
    if (!row) {
      stale.push(`missing row for ${foreground} on ${background}`);
      return;
    }
    if (row[0] !== foreground || row[1] !== background || row[minimumColumn] !== `≥ ${pair.need}`) {
      stale.push(`row ${i + 1}: ${row[0]} ${row[1]} ${row[minimumColumn]} vs live ${foreground} ${background} ≥ ${pair.need}`);
    }
    for (const [themeName, column] of themeColumns) {
      const liveRatio = ratiosByTheme[themeName][i];
      if (column >= 0 && Math.abs(Number(row[column]) - liveRatio) > 0.01) {
        stale.push(`${themeName} ${foreground} on ${background}: ${row[column]} vs live ${liveRatio.toFixed(2)}`);
      }
    }
  });
  if (table.rows.length !== measuredPairs.length) {
    stale.push(`${table.rows.length} rows for ${measuredPairs.length} pairs`);
  }
  run.check(stale.length === 0, 'the catalogue contrast table matches the live ratios of every theme', stale.slice(0, 3).join(' | ') || `${table.rows.length} rows x ${themeColumns.length} themes`);
}

// "rgb(1, 2, 3)" or "rgba(1, 2, 3, 0.5)" -> [1, 2, 3]
function parseRgb(colour) {
  return colour.match(/[\d.]+/g).slice(0, 3).map(Number);
}

// In-page: the colours of the first snippet (background, gutter and four markup token kinds), six
// token kinds from any JavaScript snippet, and the header label of each JavaScript snippet.
function readSnippetPaint() {
  const pre = document.querySelector('pre.docs-snippet');
  const gutter = pre.querySelector('.line-numbers-rows');
  const paint = {
    bg: getComputedStyle(pre).backgroundColor,
    gutter: [getComputedStyle(gutter).color, getComputedStyle(gutter).backgroundColor],
    kinds: {},
    scriptKinds: {},
    scriptLabels: [],
  };
  for (const kind of ['tag', 'attr-name', 'attr-value', 'punctuation']) {
    const token = pre.querySelector(`.token.${kind}`);
    if (token) {
      paint.kinds[kind] = getComputedStyle(token).color;
    }
  }
  for (const kind of ['keyword', 'function', 'string', 'number', 'operator', 'comment']) {
    const token = document.querySelector(`pre.docs-snippet code.language-javascript .token.${kind}`);
    if (token) {
      paint.scriptKinds[kind] = getComputedStyle(token).color;
    }
  }
  for (const code of document.querySelectorAll('pre.docs-snippet code.language-javascript')) {
    const summary = code.closest('.docs-code').querySelector('summary');
    paint.scriptLabels.push(summary.firstChild.textContent.trim());
  }
  return paint;
}

// 24. Catalogue snippets: highlighted, numbered, white, collapsed by default, scrolling past 20 lines,
//     and copied whole by click or key. A mouse selection is left to the browser's own Ctrl+C.
async function checkSnippets(run) {
  const snippetCount = run.wants('snippets') ? await run.page.locator('pre.docs-snippet').count() : 0;
  if (!snippetCount) {
    return;
  }
  const { check, snap } = run;
  const snippetPage = await run.openPage();
  const frameStates = await snippetPage.$$eval('details.docs-code', (frames) => frames.map((frame) => frame.open));
  const openFrameCount = frameStates.filter(Boolean).length;
  check(frameStates.length === snippetCount && frameStates.every((open) => !open), 'every catalogue snippet sits in a frame that starts collapsed', `${frameStates.length} frames, ${openFrameCount} open`);

  const bareCount = await snippetPage.$$eval('pre.docs-snippet', (snippets) => snippets.filter((snippet) => {
    const highlighted = snippet.querySelector('.token');
    const clickable = snippet.hasAttribute('data-docs-copy');
    const oneTabStop = snippet.getAttribute('tabindex') === '0' && !snippet.querySelector('code[tabindex]');
    return !highlighted || !clickable || !oneTabStop;
  }).length);
  check(bareCount === 0, 'every catalogue snippet is highlighted, clickable and has one Tab stop (the block)', `${bareCount} of ${snippetCount} are not`);

  const paint = await snippetPage.evaluate(readSnippetPaint);
  const tokenKinds = Object.keys(paint.kinds);
  const weakKinds = Object.entries(paint.kinds).filter(([, colour]) => contrastRatio(parseRgb(colour), parseRgb(paint.bg)) < 4.5).map(([kind]) => kind);
  check(tokenKinds.length === 4 && weakKinds.length === 0, 'snippet token colours reach 4.5:1 on the snippet background', weakKinds.join(', ') || tokenKinds.join(', '));
  const scriptKinds = Object.keys(paint.scriptKinds);
  const weakScriptKinds = Object.entries(paint.scriptKinds).filter(([, colour]) => contrastRatio(parseRgb(colour), parseRgb(paint.bg)) < 4.5).map(([kind]) => kind);
  check(scriptKinds.length === 6 && weakScriptKinds.length === 0, 'JavaScript snippet token colours reach 4.5:1 on the snippet background', weakScriptKinds.join(', ') || scriptKinds.join(', '));
  const mislabelled = paint.scriptLabels.filter((label) => label !== 'JavaScript');
  check(paint.scriptLabels.length > 0 && mislabelled.length === 0, 'JavaScript snippets are labelled JavaScript in their header', `${paint.scriptLabels.length} snippets, labels: ${[...new Set(paint.scriptLabels)].join(', ')}`);
  const gutterRatio = contrastRatio(parseRgb(paint.gutter[0]), parseRgb(paint.gutter[1]));
  check(gutterRatio >= 4.5, 'snippet line numbers reach 4.5:1 on the gutter', gutterRatio.toFixed(2));
  check(paint.bg === 'rgb(255, 255, 255)', 'snippet background is white', paint.bg);

  // Frames: summary opens and closes by pointer and by key; the hint shows only while open.
  const lineCounts = await snippetPage.$$eval('details.docs-code', (frames) => frames.map((frame) => {
    return Number(frame.querySelector('.docs-code__meta').textContent.match(/\d+/)[0]);
  }));
  const longIndex = lineCounts.findIndex((count) => count > 40);
  const shortIndex = lineCounts.findIndex((count) => count < 10);
  const frame = snippetPage.locator('details.docs-code').nth(longIndex);
  const summary = frame.locator('summary');
  await frame.scrollIntoViewIfNeeded();
  const hintWhenClosed = await frame.locator('.docs-code__hint').isVisible();
  await summary.click();
  const openByClick = await frame.evaluate((details) => details.open);
  const hintWhenOpen = await frame.locator('.docs-code__hint').isVisible();
  await summary.focus();
  await snippetPage.keyboard.press('Enter');
  const closedByEnter = await frame.evaluate((details) => !details.open);
  await snippetPage.keyboard.press('Space');
  const openBySpace = await frame.evaluate((details) => details.open);
  const toggles = openByClick && closedByEnter && openBySpace && !hintWhenClosed && hintWhenOpen;
  const toggleDetail = `click ${openByClick}, Enter ${closedByEnter}, Space ${openBySpace}, hint closed/open ${hintWhenClosed}/${hintWhenOpen}`;
  check(toggles, 'a snippet frame opens and closes by click, Enter and Space; its hint shows only when open', toggleDetail);

  // Scroll: a long block stops at 20 lines and scrolls, a short one shows whole; the gutter holds still sideways.
  const pre = frame.locator('pre');
  const code = pre.locator('code');
  const lineHeight = await code.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
  const geometry = await pre.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    rows: element.querySelector('.line-numbers-rows').children.length,
  }));
  const codeText = await code.evaluate((element) => element.textContent);
  const lineCount = codeText.replace(/\n$/, '').split('\n').length;
  const stopsAt20 = geometry.scrollHeight > geometry.clientHeight && Math.abs(geometry.clientHeight - (20 * lineHeight + 2 * 8)) <= 2;
  check(stopsAt20, `a ${lineCount}-line snippet stops at 20 lines and scrolls`, `client ${geometry.clientHeight}px, content ${geometry.scrollHeight}px, line ${lineHeight}px`);
  check(geometry.rows === lineCount, 'a snippet shows one line number per line', `${geometry.rows} numbers, ${lineCount} lines`);
  const [gutterHolds, scrollsDown] = await pre.evaluate((element) => {
    element.scrollLeft = 60;
    element.scrollTop = 100;
    const gutterBox = element.querySelector('.line-numbers-rows').getBoundingClientRect();
    const holds = Math.abs(gutterBox.left - element.getBoundingClientRect().left) < 2 && element.scrollLeft > 0;
    return [holds, element.scrollTop > 0];
  });
  check(gutterHolds && scrollsDown, 'the line-number gutter stays at the left edge while the code scrolls', `sideways ${gutterHolds}, down ${scrollsDown}`);
  await snap(frame, 'snippet-long.png');
  await pre.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });
  const shortFrame = snippetPage.locator('details.docs-code').nth(shortIndex);
  await shortFrame.locator('summary').click();
  const shownWhole = await shortFrame.locator('pre').evaluate((element) => element.scrollHeight <= element.clientHeight);
  check(shownWhole, 'a short snippet is shown whole, without a scroll bar');
  await snap(shortFrame, 'snippet-short.png');

  // Pointer: no highlight on hover.
  const readLook = (element) => {
    const style = getComputedStyle(element);
    return `${style.backgroundColor}|${style.borderColor}|${style.boxShadow}`;
  };
  const restingLook = await pre.evaluate(readLook);
  await pre.hover();
  check(await pre.evaluate(readLook) === restingLook, 'a snippet does not change under the pointer');

  const text = await code.evaluate((element) => element.textContent);
  await snippetPage.evaluate(() => navigator.clipboard.writeText('stale').catch(() => {}));
  const preBox = await pre.boundingBox();
  await snippetPage.mouse.click(preBox.x + preBox.width - 30, preBox.y + preBox.height - 30);
  await snippetPage.waitForTimeout(100);
  const copied = await readClipboard(snippetPage);
  let copyDetail = copied === text ? '' : 'MISMATCH';
  if (copied === null) {
    copyDetail = 'clipboard unreadable';
  }
  check(copied === text, 'clicking a snippet reaches the clipboard whole, without line numbers', copyDetail);
  const hint = await frame.locator('.docs-code__hint').textContent();
  const flagged = await frame.evaluate((details) => details.hasAttribute('data-docs-copied'));
  // Read only when the header confirmed, as the check always has.
  const announced = flagged && hint === 'Copied' && /copied/i.test(await snippetPage.evaluate(() => document.querySelector('[role="status"][data-cb-sr]')?.textContent ?? ''));
  check(announced, 'a snippet confirms the copy in its header and in the live region', `hint "${hint}"`);

  await snippetPage.evaluate(() => navigator.clipboard.writeText('stale').catch(() => {}));
  await snippetPage.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.querySelector('code .token'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, await pre.elementHandle());
  const clipboardBefore = await readClipboard(snippetPage);
  await pre.evaluate((element) => element.click());
  await snippetPage.waitForTimeout(100);
  check(await readClipboard(snippetPage) === clipboardBefore, 'a click with text selected inside the snippet does not copy', 'selection kept for Ctrl+C');

  await snippetPage.evaluate(() => {
    getSelection().removeAllRanges();
    navigator.clipboard.writeText('stale').catch(() => {});
  });
  await pre.focus();
  await snippetPage.keyboard.press('Enter');
  await snippetPage.waitForTimeout(100);
  check(await readClipboard(snippetPage) === text, 'Enter on a focused snippet reaches the clipboard whole');
  await snap(pre, 'snippet-focus.png');
  await snippetPage.setViewportSize({ width: 360, height: 800 });
  const overflow = await snippetPage.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow <= 0, 'snippets do not widen the page at 360px', `${overflow}px`);
  await snippetPage.close();
}

// In-page: appends the native form-control fixture (every single-line input type and the
// select at both sizes in every density, with probes sized by that density's tokens, plus
// readonly, disabled, invalid and busy extras).
function appendFormFixture(valuesByType) {
  const fieldsMarkup = (small) => {
    let markup = '';
    for (const [type, value] of Object.entries(valuesByType)) {
      const sizeClass = small ? ' cb-input--sm' : '';
      const valueAttribute = value ? ` value="${value}"` : '';
      markup += `<input class="cb-input${sizeClass}" type="${type}"${valueAttribute} aria-label="${type}${small ? '--sm' : ''}">`;
    }
    markup += `<select class="cb-select${small ? ' cb-select--sm' : ''}" aria-label="select${small ? '--sm' : ''}"><option>Operator</option></select>`;
    return markup;
  };
  const densityMarkup = (density) => {
    const densityAttribute = density === 'default' ? '' : ` data-cb-density="${density}"`;
    return `<div data-vb-density="${density}"${densityAttribute}>`
      + `<div data-vb-size="md"><i data-vb-probe></i>${fieldsMarkup(false)}</div>`
      + `<div data-vb-size="sm"><i data-vb-probe></i>${fieldsMarkup(true)}</div></div>`;
  };
  const rolesMarkup = (attributes) => `<select class="cb-select" multiple size="4" aria-label="roles"${attributes}>`
    + '<option selected>admin</option><option>auditor</option><option selected>operator</option><option>viewer</option></select>';
  const fieldsetMarkup = (validity) => `<fieldset class="cb-fieldset" data-vb-group="${validity}"><legend>Roles</legend>`
    + `<label class="cb-choice"><input class="cb-check" type="checkbox"${validity === 'invalid' ? ' aria-invalid="true"' : ''}>Viewer</label>`
    + '<p class="cb-field__error">Choose at least one role.</p></fieldset>';

  const fixtureStyle = '<style>[data-vb-forms] { display: grid; gap: 8px; padding: 8px; background: var(--cb-bg-canvas); }'
    + '[data-vb-forms] :is([data-vb-size], [data-vb-extras]) { display: grid; grid-template-columns: repeat(7, 11rem); gap: 4px; align-items: start; }'
    + '[data-vb-probe] { inline-size: 1px; } [data-vb-size="md"] > [data-vb-probe] { block-size: var(--cb-control-h); }'
    + '[data-vb-size="sm"] > [data-vb-probe] { block-size: var(--cb-control-h-sm); }</style>';
  const extrasMarkup = '<div data-vb-extras><select class="cb-select" readonly aria-label="select readonly"><option>Operator</option></select>'
    + `<input class="cb-input" type="text" readonly value="3f9c2a71" aria-label="input readonly">${rolesMarkup('')}${rolesMarkup(' disabled')}`
    + '<input class="cb-input" type="text" aria-disabled="true" readonly value="ou=staff" aria-label="input aria-disabled">'
    + '<div class="cb-input-group"><input class="cb-input" type="number" disabled value="25" aria-label="group disabled"><span class="cb-input-group__addon">s</span></div>'
    + '<div class="cb-input-group"><select class="cb-select" aria-disabled="true" aria-label="select aria-disabled"><option>Operator</option></select><span class="cb-input-group__addon">role</span></div>'
    + fieldsetMarkup('invalid')
    + fieldsetMarkup('valid')
    + '<div class="cb-input-group"><input class="cb-input" type="text" aria-busy="true" value="ou=staff" aria-label="input busy">'
    + '<span class="cb-input-group__addon" aria-busy="true">Checking</span></div></div>';

  const fixture = document.createElement('section');
  fixture.setAttribute('data-vb-forms', '');
  fixture.innerHTML = fixtureStyle
    + densityMarkup('compact')
    + densityMarkup('default')
    + densityMarkup('comfortable')
    + extrasMarkup;
  document.body.append(fixture);
}

// In-page: the probe height and every field's height and figures, per density and size.
function measureFormMatrix(densityBlocks) {
  return densityBlocks.map((densityBlock) => ({
    density: densityBlock.getAttribute('data-vb-density'),
    sizes: [...densityBlock.querySelectorAll('[data-vb-size]')].map((sizeBlock) => ({
      size: sizeBlock.getAttribute('data-vb-size'),
      probe: sizeBlock.querySelector('[data-vb-probe]').getBoundingClientRect().height,
      fields: [...sizeBlock.querySelectorAll('.cb-input, .cb-select')].map((field) => ({
        name: field.getAttribute('aria-label'),
        height: Math.round(field.getBoundingClientRect().height * 10) / 10,
        numeric: getComputedStyle(field).fontVariantNumeric,
      })),
    })),
  }));
}

// Counts dark pixels in the band before a field's end padding, where engine keys would be drawn.
// The screenshot is decoded on `decodePage`.
async function countDarkPixelsAtEnd(decodePage, field) {
  const geometry = await field.evaluate((element) => {
    const style = getComputedStyle(element);
    return { w: element.offsetWidth, h: element.offsetHeight, end: parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight) };
  });
  const pngBase64 = (await field.screenshot()).toString('base64');
  return decodePage.evaluate(async ([base64, fieldGeometry]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const canvasContext = canvas.getContext('2d');
    canvasContext.drawImage(image, 0, 0);
    const scale = image.width / fieldGeometry.w;
    const bandStart = Math.floor((fieldGeometry.w - fieldGeometry.end - 20) * scale);
    const bandEnd = Math.floor((fieldGeometry.w - fieldGeometry.end) * scale);
    const bandPixels = canvasContext.getImageData(bandStart, Math.floor(3 * scale), bandEnd - bandStart, Math.floor((fieldGeometry.h - 6) * scale)).data;
    let darkCount = 0;
    for (let i = 0; i < bandPixels.length; i += 4) {
      if (bandPixels[i] + bandPixels[i + 1] + bandPixels[i + 2] < 600) {
        darkCount++;
      }
    }
    return darkCount;
  }, [pngBase64, geometry]);
}

// 25. Native form controls, on a fixture appended to a fresh tab, so the stylesheet is tested
//     whatever the page documents: every single-line input type and the select, at both sizes
//     and in every density, against probes sized by that density's own tokens; plus readonly
//     fields and list boxes once.
async function checkNativeForms(run) {
  if (!run.wants('forms')) {
    return;
  }
  const { check, snap } = run;
  const formsPage = await run.openPage({ viewport: DESKTOP_VIEWPORT });
  await formsPage.evaluate(appendFormFixture, FORM_FIELD_VALUES);
  const matrix = await formsPage.$$eval('[data-vb-density]', measureFormMatrix);
  const everyField = [];
  for (const densityBlock of matrix) {
    for (const sizeBlock of densityBlock.sizes) {
      everyField.push(...sizeBlock.fields);
    }
  }
  const proportional = [...new Set(everyField.filter((field) => !field.numeric.includes('tabular-nums')).map((field) => field.name))];
  check(proportional.length === 0, 'native fields use tabular figures', proportional.length ? `proportional: ${proportional.join(', ')}` : `${everyField.length} fields`);
  for (const densityBlock of matrix) {
    const offHeight = [];
    for (const sizeBlock of densityBlock.sizes) {
      for (const field of sizeBlock.fields) {
        if (Math.abs(field.height - sizeBlock.probe) >= 0.5) {
          offHeight.push(`${field.name} ${field.height}`);
        }
      }
    }
    const probes = densityBlock.sizes.map((sizeBlock) => `${sizeBlock.size} ${sizeBlock.probe}px`).join(', ');
    check(offHeight.length === 0, `native fields take the control height (${densityBlock.density})`, `${probes}${offHeight.length ? `; off: ${offHeight.join(', ')}` : ''}`);
  }

  // A colour field is as wide as two control heights, at both sizes and in every density.
  const colourFields = await formsPage.$$eval('[data-vb-density] input[type="color"]', (fields) => fields.map((field) => {
    const box = field.getBoundingClientRect();
    const density = field.closest('[data-vb-density]').getAttribute('data-vb-density');
    return { name: `${density} ${field.getAttribute('aria-label')}`, w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10 };
  }));
  const wrongColourFields = colourFields.filter((field) => Math.abs(field.w - 2 * field.h) >= 0.5);
  const colourDetail = wrongColourFields.map((field) => `${field.name} ${field.w}x${field.h}`).join(', ') || `${colourFields.length} fields`;
  check(colourFields.length > 0 && !wrongColourFields.length, 'colour fields are two control heights wide', colourDetail);

  // The file key is an engine pseudo-element; its computed box is readable in every engine.
  const fileKeys = await formsPage.$$eval('[data-vb-density] input[type="file"]', (fields) => fields.map((field) => {
    const key = getComputedStyle(field, '::file-selector-button');
    const line = key.lineHeight === 'normal' ? parseFloat(key.fontSize) * 1.2 : parseFloat(key.lineHeight);
    const inner = parseFloat(key.blockSize) - parseFloat(key.borderTopWidth) - parseFloat(key.borderBottomWidth);
    const density = field.closest('[data-vb-density]').getAttribute('data-vb-density');
    return { name: `${density} ${field.getAttribute('aria-label')}`, line, inner };
  }));
  const cutKeys = fileKeys.filter((key) => key.line > key.inner + 0.01);
  const fileDetail = cutKeys.length ? cutKeys.map((key) => `${key.name}: ${key.line}px line in ${key.inner}px`).join(', ') : `${fileKeys.length} keys`;
  check(fileKeys.length === 6 && cutKeys.length === 0, 'the file key label fits its key in every size and density', fileDetail);

  // List boxes: the checked row of a resting list (no hover, no focus; a focused list takes the
  // system highlight in every engine) is read on pixels near its end edge, away from the text.
  const selectedTint = await formsPage.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-selected)';
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour.match(/\d+/g).slice(0, 3).map(Number);
  });
  const listBoxes = formsPage.locator('[data-vb-extras] select[multiple]');
  const listRows = [];
  for (const [i, state] of ['enabled', 'disabled'].entries()) {
    const listBox = listBoxes.nth(i);
    await listBox.scrollIntoViewIfNeeded();
    const geometry = await listBox.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        w: box.width,
        h: box.height,
        top: parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
        end: parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight),
      };
    });
    const pixelAt = await readPixels(run.page, listBox);
    const pixel = await pixelAt((geometry.w - geometry.end - 4) / geometry.w, (geometry.top + 4) / geometry.h);
    listRows.push({ state, pixel, off: colourDistance(pixel, selectedTint) });
  }
  const listDetail = `${listRows.map((row) => `${row.state} ${row.pixel.join(',')}`).join('; ')} vs ${selectedTint.join(',')}`;
  check(listRows.every((row) => row.off < 8), 'selected options in a multi-select take the selected tint (enabled and disabled)', listDetail);

  // Engine keys (number spin buttons, the search clear key) show on hover or focus in some
  // engines and always in others: hovered and focused, the band before the end padding holds no
  // dark pixel. Escape is the remaining way to clear a search field.
  const engineKeys = [];
  for (const type of ['number', 'search']) {
    const field = formsPage.locator(`[data-vb-density="default"] [data-vb-size="md"] [aria-label="${type}"]`);
    await field.scrollIntoViewIfNeeded();
    await field.hover();
    await field.focus();
    const darkCount = await countDarkPixelsAtEnd(run.page, field);
    engineKeys.push(`${type} ${darkCount}`);
  }
  check(engineKeys.every((key) => key.endsWith(' 0')), 'number and search fields show no engine keys', `dark pixels in the end band: ${engineKeys.join(', ')}`);
  const searchField = formsPage.locator('[data-vb-density="default"] [data-vb-size="md"] [aria-label="search"]');
  await searchField.focus();
  await formsPage.keyboard.press('Escape');
  const leftOver = await searchField.inputValue();
  check(leftOver === '', 'Escape clears a search field', JSON.stringify(leftOver));

  // Date and time fields reached with Tab show the standard ring (walking the segments of the
  // fields before them).
  const unringed = [];
  for (const type of ['date', 'time', 'datetime-local', 'month', 'week']) {
    await formsPage.locator('[data-vb-density="default"] [data-vb-size="md"] [aria-label="number"]').focus();
    let ring = null;
    for (let i = 0; i < 24 && ring === null; i++) {
      await formsPage.keyboard.press(run.tabKey);
      ring = await formsPage.evaluate(([fieldType, dateFields]) => {
        const focused = document.activeElement;
        if (focused?.getAttribute('aria-label') !== fieldType) {
          return null;
        }
        const style = getComputedStyle(focused);
        const isFocused = focused.matches(':focus-visible') || (focused.matches(dateFields) && focused.matches(':focus'));
        return isFocused && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
      }, [type, SEGMENTED_DATE_FIELDS]);
    }
    if (!ring) {
      unringed.push(`${type}${ring === null ? ' (not reached)' : ''}`);
    }
  }
  check(unringed.length === 0, 'date and time fields show the focus ring when tabbed to', unringed.join(', ') || '5 types');

  // <select> ignores readonly, so it must not look locked; inputs keep the recessed mono look.
  const readonlyLooks = await formsPage.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-raised)';
    const raised = getComputedStyle(probe).color;
    probe.style.color = 'var(--cb-bg-recessed)';
    const recessed = getComputedStyle(probe).color;
    probe.remove();
    const lookOf = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return { bg: style.backgroundColor, mono: /mono/i.test(style.fontFamily.split(',')[0]) };
    };
    return { raised, recessed, select: lookOf('[aria-label="select readonly"]'), input: lookOf('[aria-label="input readonly"]') };
  });
  const selectLooksEditable = readonlyLooks.select.bg === readonlyLooks.raised && !readonlyLooks.select.mono;
  const inputLooksReadonly = readonlyLooks.input.bg === readonlyLooks.recessed && readonlyLooks.input.mono;
  check(selectLooksEditable && inputLooksReadonly, 'the readonly look stays off <select>, which ignores readonly', JSON.stringify({ select: readonlyLooks.select, input: readonlyLooks.input }));

  // aria-disabled keeps a field focusable with the disabled look; a disabled field mutes its addon.
  const locked = await formsPage.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const tokenColour = (token) => {
      probe.style.color = `var(--cb-${token})`;
      return getComputedStyle(probe).color;
    };
    const expected = { fill: tokenColour('bg-recessed'), ink: tokenColour('text-disabled') };
    probe.remove();
    const field = getComputedStyle(document.querySelector('[aria-label="input aria-disabled"]'));
    const addon = getComputedStyle(document.querySelector('[aria-label="group disabled"] + .cb-input-group__addon'));
    return { want: expected, field: { fill: field.backgroundColor, ink: field.color }, addon: addon.color };
  });
  const looksLocked = locked.field.fill === locked.want.fill && locked.field.ink === locked.want.ink && locked.addon === locked.want.ink;
  check(looksLocked, 'aria-disabled fields look disabled, and a disabled field mutes its addon', JSON.stringify(locked));

  // A <select> has no readonly, so aria-disabled leaves it editable: it must not look locked.
  const editable = await formsPage.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const tokenColour = (token) => {
      probe.style.color = `var(--cb-${token})`;
      return getComputedStyle(probe).color;
    };
    const expected = { fill: tokenColour('bg-raised'), ink: tokenColour('text-main'), muted: tokenColour('text-disabled') };
    probe.remove();
    const field = getComputedStyle(document.querySelector('[aria-label="select aria-disabled"]'));
    const addon = getComputedStyle(document.querySelector('[aria-label="select aria-disabled"] + .cb-input-group__addon'));
    return { want: expected, field: { fill: field.backgroundColor, ink: field.color, cursor: field.cursor }, addon: addon.color };
  });
  const looksEditable = editable.field.fill === editable.want.fill && editable.field.ink === editable.want.ink
    && editable.field.cursor !== 'not-allowed' && editable.addon !== editable.want.muted;
  check(looksEditable, 'an aria-disabled <select> keeps the editable look, as it stays editable', JSON.stringify(editable));

  // A group whose choices are invalid frames itself and its legend in crimson and shows its error.
  const groups = await formsPage.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-danger)';
    const danger = getComputedStyle(probe).color;
    probe.remove();
    const lookOf = (validity) => {
      const fieldset = document.querySelector(`[data-vb-group="${validity}"]`);
      return {
        frame: getComputedStyle(fieldset).borderTopColor,
        legend: getComputedStyle(fieldset.querySelector('legend')).color,
        error: getComputedStyle(fieldset.querySelector('.cb-field__error')).display,
      };
    };
    return { danger, invalid: lookOf('invalid'), valid: lookOf('valid') };
  });
  const invalidShows = groups.invalid.frame === groups.danger && groups.invalid.legend === groups.danger && groups.invalid.error !== 'none';
  const validQuiet = groups.valid.frame !== groups.danger && groups.valid.error === 'none';
  check(invalidShows && validQuiet, 'a fieldset with invalid choices shows the group error', JSON.stringify(groups));

  // A field the server is checking: the field shows progress, its addon the stepped spinner.
  const busy = await formsPage.evaluate(() => {
    const field = document.querySelector('[aria-label="input busy"]');
    const spinner = getComputedStyle(field.nextElementSibling, '::before');
    return {
      cursor: getComputedStyle(field).cursor,
      animation: spinner.animationName,
      ring: `${spinner.borderTopStyle} ${spinner.borderTopWidth}`,
      size: spinner.inlineSize,
    };
  });
  check(busy.cursor === 'progress' && busy.animation === 'cb-spin' && busy.ring === 'solid 2px', 'a busy field shows progress and its addon the spinner', JSON.stringify(busy));
  const fixture = formsPage.locator('[data-vb-forms]');
  await fixture.scrollIntoViewIfNeeded();
  await snap(fixture, 'forms-matrix.png');
  await formsPage.close();
}

// In-page: every rendered property list, with the problems found in its margins, frame, lines,
// layout and row heights.
function measurePropertyLists() {
  const probe = document.body.appendChild(document.createElement('i'));
  const tokenColour = (name) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const subtleLine = tokenColour('--cb-border-subtle');
  const mainLine = tokenColour('--cb-border-main');
  probe.remove();
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const lists = [...document.querySelectorAll('.cb-props')].filter((list) => list.getClientRects().length);

  return lists.map((list, i) => {
    const listStyle = getComputedStyle(list);
    const tokenPixels = (name) => parseFloat(listStyle.getPropertyValue(name)) * rootFontSize;
    const expectedRow = Math.round(tokenPixels('--cb-row-h'));
    const oneLineHeight = tokenPixels('--cb-control-h-sm') + 0.5;
    const wide = list.clientWidth >= 28 * rootFontSize;
    const problems = [];
    const isOneLine = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().height <= oneLineHeight;
    };
    const topLine = (element) => {
      const style = getComputedStyle(element);
      return style.borderTopWidth === '0px' ? '0px' : `${style.borderTopWidth} ${style.borderTopColor}`;
    };

    // Each term with its values.
    const groups = [];
    for (const child of list.querySelectorAll(':scope > :is(dt, dd), :scope > div > :is(dt, dd)')) {
      if (child.localName === 'dt') {
        groups.push({ dt: child, dds: [] });
      } else {
        groups.at(-1)?.dds.push(child);
      }
    }

    if (listStyle.margin !== '0px') {
      problems.push(`margin ${listStyle.margin}`);
    }
    const flush = list.parentElement.matches('.cb-panel__body--flush');
    const frame = `${listStyle.borderTopWidth} ${listStyle.borderTopColor}`;
    const expectedFrame = flush ? `0px ${listStyle.borderTopColor}` : `1px ${mainLine}`;
    if (frame !== expectedFrame) {
      problems.push(`frame ${frame}${flush ? ' (flush)' : ''}`);
    }

    groups.forEach(({ dt, dds }, groupIndex) => {
      const name = dt.textContent.trim();
      const keyBox = dt.getBoundingClientRect();
      const expectedTop = groupIndex ? `1px ${subtleLine}` : '0px';
      if (topLine(dt) !== expectedTop) {
        problems.push(`${name}: key line ${topLine(dt)}`);
      }
      dds.forEach((dd, valueIndex) => {
        const valueBox = dd.getBoundingClientRect();
        const valueStyle = getComputedStyle(dd);
        if (!valueStyle.fontVariantNumeric.includes('tabular-nums')) {
          problems.push(`${name}: figures ${valueStyle.fontVariantNumeric}`);
        }
        if (dd.scrollWidth > dd.clientWidth) {
          problems.push(`${name}: value overflows by ${dd.scrollWidth - dd.clientWidth}px`);
        }
        // Further values of one term sit under the first, with no line between them.
        if (valueIndex) {
          const firstBox = dds[0].getBoundingClientRect();
          const misplaced = Math.abs(valueBox.left - firstBox.left) > 0.5 || valueBox.top < firstBox.bottom - 0.5 || valueStyle.borderTopWidth !== '0px';
          if (misplaced) {
            problems.push(`${name}: extra value at ${Math.round(valueBox.left)},${Math.round(valueBox.top)}, line ${valueStyle.borderTopWidth}`);
          }
          return;
        }
        if (wide) {
          if (Math.abs(valueBox.left - keyBox.right) > 0.5 || Math.abs(valueBox.top - keyBox.top) > 0.5) {
            problems.push(`${name}: value at ${Math.round(valueBox.left)},${Math.round(valueBox.top)}, key ends ${Math.round(keyBox.right)},${Math.round(keyBox.top)}`);
          }
          if (topLine(dd) !== expectedTop) {
            problems.push(`${name}: value line ${topLine(dd)}`);
          }
          if (`${valueStyle.borderLeftWidth} ${valueStyle.borderLeftColor}` !== `1px ${subtleLine}`) {
            problems.push(`${name}: start line ${valueStyle.borderLeftWidth}`);
          }
          const rowHeight = Math.round(Math.max(keyBox.height, valueBox.height));
          if (isOneLine(dt) && isOneLine(dd) && rowHeight !== expectedRow) {
            problems.push(`${name}: row ${rowHeight}px, want ${expectedRow}`);
          }
        } else {
          if (Math.abs(valueBox.left - keyBox.left) > 0.5 || valueBox.top < keyBox.bottom - 0.5) {
            problems.push(`${name}: not stacked (value ${Math.round(valueBox.left)},${Math.round(valueBox.top)}, key ${Math.round(keyBox.left)},${Math.round(keyBox.bottom)})`);
          }
          if (valueStyle.borderTopWidth !== '0px' || valueStyle.borderLeftWidth !== '0px') {
            problems.push(`${name}: stacked value lines ${valueStyle.borderTopWidth} ${valueStyle.borderLeftWidth}`);
          }
        }
      });
    });
    return { index: i, wide, rows: groups.length, problems };
  });
}

// Screenshots of one section at 1360 and 360px, only when screenshots are saved.
async function captureSavedSectionShots(run, sectionId, filePrefix) {
  const { page, snap } = run;
  const section = page.locator(`#${sectionId}`);
  if (!run.saving || !await section.count()) {
    return;
  }
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `${filePrefix}-${width}.png`);
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// 26. Property lists, every rendered .cb-props on the page: no UA margins or indent, key and
//     value side by side (stacked below 28rem of the list's width), one-line rows of
//     --cb-row-h with or without a .cb-btn--sm, a line between rows but not above the first or
//     between the values of one term, a line before each value, tabular figures, values that
//     wrap inside their cell, and a frame unless a flush panel body frames the list. The first
//     list also follows data-cb-density.
async function checkPropertyLists(run) {
  if (!run.wants('props') || !await run.page.locator('.cb-props').count()) {
    return;
  }
  const { page, check } = run;
  // Earlier checks may have left the first list in an idle tab panel (as on the example screen).
  await exposeControl(page, '.cb-props');
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const lists = await page.evaluate(measurePropertyLists);
    check(lists.length > 0, `property lists are rendered at ${width}px`, `${lists.length} measured`);
    for (const list of lists) {
      const layout = list.wide ? 'key and value side by side' : 'key above value';
      const detail = list.problems.length ? list.problems.join('; ') : `${list.rows} rows`;
      check(!list.problems.length && list.rows > 0, `property list ${list.index + 1} at ${width}px: ${layout}, rows, lines and frame`, detail);
    }
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const rowHeights = await page.evaluate(() => {
    // The first list wide enough for key and value side by side (stacked rows have no fixed height).
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const list = [...document.querySelectorAll('.cb-props')].find((candidate) => candidate.getClientRects().length && candidate.clientWidth >= 28 * rootFontSize);
    const firstKey = list.querySelector(':scope > dt, :scope > div > dt');
    const heightByDensity = {};
    for (const density of ['compact', 'comfortable']) {
      list.setAttribute('data-cb-density', density);
      heightByDensity[density] = Math.round(firstKey.getBoundingClientRect().height);
    }
    list.removeAttribute('data-cb-density');
    return heightByDensity;
  });
  check(rowHeights.compact === 24 && rowHeights.comfortable === 32, 'property list rows follow data-cb-density (24px compact, 32px comfortable)', JSON.stringify(rowHeights));
  await captureSavedSectionShots(run, 'props', 'props');
}

// In-page: how each busy container paints: cursor, ink, hatch and its stripes, and the table
// head. The painting element is the first body cell for tables, the container itself otherwise.
function readBusyPaint(busySelector) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  const toRgb = (colour) => {
    canvasContext.clearRect(0, 0, 1, 1);
    canvasContext.fillStyle = '#000';
    canvasContext.fillStyle = colour;
    canvasContext.fillRect(0, 0, 1, 1);
    return [...canvasContext.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const containers = [...document.querySelectorAll(busySelector)].filter((container) => container.getClientRects().length);
  return containers.map((container) => {
    let body = null;
    if (container.matches('.cb-table')) {
      body = container.tBodies[0];
    } else if (container.matches('tbody')) {
      body = container;
    }
    const painter = body ? body.querySelector(':scope > tr > :is(th, td)') : container;
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-text-muted)';
    const mutedInk = getComputedStyle(probe).color;
    probe.remove();
    const painterStyle = getComputedStyle(painter);
    const inkStyle = getComputedStyle(body ?? container);
    const head = container.closest('.cb-table')?.querySelector('thead th');
    const stripeColours = painterStyle.backgroundImage.match(/(?:rgba?|color)\([^)]*\)/g) ?? [];
    return {
      name: `${container.localName}${container.className ? `.${container.className.split(' ')[0]}` : ''}`,
      cursor: inkStyle.cursor,
      ink: inkStyle.color,
      muted: mutedInk,
      image: painterStyle.backgroundImage,
      attach: painterStyle.backgroundAttachment,
      head: head ? getComputedStyle(head).backgroundImage : 'none',
      stripes: stripeColours.map(toRgb),
      inkRgb: toRgb(inkStyle.color),
    };
  });
}

// What is wrong with one busy container's paint (readBusyPaint), or an empty list.
function judgeBusyPaint(busy) {
  const problems = [];
  if (busy.cursor !== 'progress') {
    problems.push(`cursor ${busy.cursor}`);
  }
  if (busy.ink !== busy.muted) {
    problems.push(`ink ${busy.ink}`);
  }
  if (!busy.image.startsWith('repeating-linear-gradient') || busy.attach !== 'fixed') {
    problems.push(`paint ${busy.image.slice(0, 40)} ${busy.attach}`);
  }
  if (busy.head.includes('repeating')) {
    problems.push('head hatched');
  }
  const lowRatios = busy.stripes.map((stripe) => contrastRatio(busy.inkRgb, stripe)).filter((ratio) => ratio < 4.5);
  if (busy.stripes.length < 2 || lowRatios.length) {
    problems.push(`stripes ${busy.stripes.length}, low ${lowRatios.map((ratio) => ratio.toFixed(2))}`);
  }
  // Firefox draws a repeating gradient with a color() stop (any color-mix) almost flat.
  if (busy.image.includes('color(')) {
    problems.push('a stripe is a color() value');
  }
  return problems;
}

// 27. Busy containers (a table body or whole table, a panel body, a property list): a progress
//     cursor and muted ink, one still hatch fixed to the viewport on the container or its body
//     cells (never the head), with plain rgb stripes (Firefox draws color() stops in a repeating
//     gradient almost flat), muted ink >= 4.5 on every stripe, no hover paint on busy rows, and
//     nothing moves when aria-busy is set. A busy panel body hatches tables and lists inside it.
async function checkBusyContainers(run) {
  if (!run.wants('busy') || !await run.page.locator(BUSY).count()) {
    return;
  }
  const { page, check, snap } = run;
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.mouse.move(2, 2);
  const busyPaints = await page.evaluate(readBusyPaint, BUSY);
  for (const busy of busyPaints) {
    const problems = judgeBusyPaint(busy);
    check(!problems.length, `busy ${busy.name}: progress cursor, muted ink on a still hatch, head untouched`, problems.join('; ') || busy.image.slice(0, 60));
  }
  const patternCount = new Set(busyPaints.map((busy) => busy.image)).size;
  check(patternCount === 1, 'every busy container paints the same hatch', `${patternCount} patterns`);

  // Setting aria-busy moves nothing: every box inside each container stays where it was.
  const shifts = await page.evaluate((busySelector) => {
    const containers = [...document.querySelectorAll(busySelector)].filter((container) => container.getClientRects().length);
    return containers.map((container) => {
      const readBoxes = () => [container, ...container.querySelectorAll('*')].map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      });
      const busyBoxes = readBoxes();
      container.removeAttribute('aria-busy');
      const idleBoxes = readBoxes();
      container.setAttribute('aria-busy', 'true');
      let largestShift = 0;
      busyBoxes.forEach((box, i) => {
        box.forEach((value, coordinate) => {
          largestShift = Math.max(largestShift, Math.abs(value - idleBoxes[i][coordinate]));
        });
      });
      return largestShift;
    });
  }, BUSY);
  check(shifts.every((shift) => shift < 0.01), 'setting aria-busy on a container moves nothing inside it', `largest shift ${Math.max(...shifts).toFixed(3)}px`);

  // A busy row keeps its paint under the pointer.
  const busyRow = page.locator('.cb-table > tbody[aria-busy="true"] > tr, .cb-table[aria-busy="true"] > tbody > tr').first();
  if (await busyRow.count()) {
    const readPaint = () => busyRow.evaluate((row) => {
      const style = getComputedStyle(row.querySelector('td'));
      return `${style.backgroundImage} ${style.backgroundColor}`;
    });
    await busyRow.scrollIntoViewIfNeeded();
    const restingPaint = await readPaint();
    await busyRow.hover();
    const hoveredPaint = await readPaint();
    await page.mouse.move(2, 2);
    const detail = restingPaint === hoveredPaint ? '' : `${restingPaint.slice(0, 40)} -> ${hoveredPaint.slice(0, 40)}`;
    check(restingPaint === hoveredPaint, 'a busy table row keeps its hatch under the pointer', detail);
  }

  // Tables and property lists inside a busy panel body are hatched too.
  const nested = await page.evaluate(() => {
    const idlePanelBodyWith = (inner) => {
      const bodies = document.querySelectorAll(`.docs-demo .cb-panel__body:not([aria-busy]):has(${inner})`);
      return [...bodies].find((body) => body.getClientRects().length);
    };
    const paintByKind = {};
    const cases = [['props', '.cb-props', '.cb-props'], ['table', '.cb-table > tbody', '.cb-table > tbody > tr > td']];
    for (const [kind, inner, painter] of cases) {
      const body = idlePanelBodyWith(inner);
      if (!body) {
        continue;
      }
      body.setAttribute('aria-busy', 'true');
      const style = getComputedStyle(body.querySelector(painter));
      paintByKind[kind] = `${style.backgroundImage.slice(0, 25)} ${style.backgroundAttachment}`;
      body.removeAttribute('aria-busy');
    }
    return paintByKind;
  });
  const hatchesInside = Object.keys(nested).length === 2 && Object.values(nested).every((paint) => paint.startsWith('repeating-linear-gradient') && paint.endsWith('fixed'));
  check(hatchesInside, 'a busy panel body hatches the tables and property lists inside it', JSON.stringify(nested));

  if (run.saving) {
    const demos = page.locator(`.docs-demo:has(${BUSY})`);
    for (const width of [1360, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (let i = 0; i < await demos.count(); i++) {
        await demos.nth(i).scrollIntoViewIfNeeded();
        await snap(demos.nth(i), `busy-${i + 1}-${width}.png`);
      }
    }
    await page.setViewportSize(DESKTOP_VIEWPORT);
  }
}

// In-page: every rendered empty state with the problems found in its padding, ink, alignment,
// frame, children and title.
function measureEmptyStates() {
  const probe = document.body.appendChild(document.createElement('i'));
  const tokenColour = (name) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const mutedInk = tokenColour('--cb-text-muted');
  const mainInk = tokenColour('--cb-text-main');
  probe.remove();
  const empties = [...document.querySelectorAll('.cb-empty, .cb-table__empty')].filter((empty) => empty.getClientRects().length);
  return empties.map((empty) => {
    const style = getComputedStyle(empty);
    const problems = [];
    if (style.paddingTop !== '16px' || style.paddingBottom !== '16px') {
      problems.push(`padding ${style.paddingTop} ${style.paddingBottom}`);
    }
    if (style.color !== mutedInk) {
      problems.push(`ink ${style.color}`);
    }
    if (style.textAlign !== 'center') {
      problems.push(`align ${style.textAlign}`);
    }
    if (empty.matches('.cb-empty')) {
      if (style.borderTopWidth !== '0px' || style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none') {
        problems.push(`frame ${style.borderTopWidth} ${style.backgroundColor}`);
      }
      const box = empty.getBoundingClientRect();
      const contentWidth = empty.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const centre = box.left + parseFloat(style.paddingLeft) + contentWidth / 2;
      for (const child of empty.children) {
        const childBox = child.getBoundingClientRect();
        const childStyle = getComputedStyle(child);
        const offCentre = childBox.left + childBox.width / 2 - centre;
        if (Math.abs(offCentre) > 1) {
          problems.push(`${child.localName} off centre by ${offCentre.toFixed(1)}px`);
        }
        if (childStyle.margin !== '0px') {
          problems.push(`${child.localName} margin ${childStyle.margin}`);
        }
      }
      const title = empty.querySelector(':scope > .cb-empty__title');
      if (title && (getComputedStyle(title).color !== mainInk || getComputedStyle(title).fontWeight !== '600')) {
        problems.push(`title ${getComputedStyle(title).color} ${getComputedStyle(title).fontWeight}`);
      }
    }
    const where = empty.parentElement.matches('.cb-panel__body--flush') ? ' in a flush body' : '';
    return { name: `${empty.matches('.cb-empty') ? '.cb-empty' : '.cb-table__empty'}${where}`, problems };
  });
}

// 28. Empty states: .cb-empty and the table's empty row share one look (16px above and below,
//     muted, centred); a .cb-empty centres its children with no margins, has no frame or fill of
//     its own (its container frames it, a flush body too) and sets its title in main ink at 600.
async function checkEmptyStates(run) {
  if (!run.wants('empty') || !await run.page.locator('.cb-empty, .cb-table__empty').count()) {
    return;
  }
  await run.page.setViewportSize(DESKTOP_VIEWPORT);
  const empties = await run.page.evaluate(measureEmptyStates);
  empties.forEach((empty, i) => {
    run.check(!empty.problems.length, `empty state ${i + 1} (${empty.name}): padded, muted, centred`, empty.problems.join('; '));
  });
  await captureSavedSectionShots(run, 'empty', 'empty');
}

// In-page, on one toast stack: its placement, width, live region and pointer handling, and how
// each message is framed.
function measureToastStack(stack) {
  const stage = stack.closest('.docs-stage');
  const stageBox = stage.getBoundingClientRect();
  const stageStyle = getComputedStyle(stage);
  const stageInner = {
    right: stageBox.right - parseFloat(stageStyle.borderRightWidth),
    bottom: stageBox.bottom - parseFloat(stageStyle.borderBottomWidth),
    width: stage.clientWidth,
  };
  const stackBox = stack.getBoundingClientRect();
  const stackStyle = getComputedStyle(stack);
  const messages = [...stack.children];
  const problems = [];
  if (stackStyle.position !== 'fixed') {
    problems.push(`position ${stackStyle.position}`);
  }
  const rightGap = stageInner.right - stackBox.right;
  const bottomGap = stageInner.bottom - stackBox.bottom;
  if (Math.abs(rightGap - 12) > 0.5 || Math.abs(bottomGap - 12) > 0.5) {
    problems.push(`corner gap ${rightGap.toFixed(1)} / ${bottomGap.toFixed(1)}`);
  }
  const expectedWidth = Math.min(24 * 16, stageInner.width - 24);
  if (Math.abs(stackBox.width - expectedWidth) > 0.5) {
    problems.push(`width ${stackBox.width} (want ${expectedWidth})`);
  }
  if (stack.getAttribute('aria-live') !== 'polite' || stack.getAttribute('aria-atomic') === 'true' || stack.getAttribute('role') === 'status') {
    problems.push('live region is not polite and per message');
  }
  if (stackStyle.pointerEvents !== 'none') {
    problems.push(`stack pointer-events ${stackStyle.pointerEvents}`);
  }
  for (const message of messages) {
    const messageStyle = getComputedStyle(message);
    if (!message.matches('.cb-alert.cb-alert--sm') || messageStyle.pointerEvents !== 'auto') {
      problems.push(`message ${message.className} pointer-events ${messageStyle.pointerEvents}`);
    }
    if (!/0px 0px 0px 1px/.test(messageStyle.boxShadow)) {
      problems.push(`no float ring: ${messageStyle.boxShadow.slice(0, 50)}`);
    }
    const edgeColours = [messageStyle.borderTopColor, messageStyle.borderRightColor, messageStyle.borderBottomColor];
    const clearEdges = edgeColours.every((colour) => colour === 'rgba(0, 0, 0, 0)');
    if (!clearEdges || messageStyle.borderLeftWidth !== '4px') {
      problems.push(`edges ${messageStyle.borderTopColor} ${messageStyle.borderLeftWidth}`);
    }
  }
  if (messages.length > 1) {
    const firstBox = messages[0].getBoundingClientRect();
    const secondBox = messages[1].getBoundingClientRect();
    const hit = document.elementFromPoint(firstBox.left + firstBox.width / 2, (firstBox.bottom + secondBox.top) / 2);
    if (!hit || stack.contains(hit)) {
      problems.push(`the gap between messages catches the pointer (${hit?.className})`);
    }
  }
  return { problems, count: messages.length };
}

// 29. Toast stack, in a catalogue stage that stands in for the viewport (layout containment):
//     fixed 12px inside its bottom-end corner, 24rem or the stage less 24px wide, a polite live
//     region that is not atomic, clicks through the gaps between messages, and each message a
//     compact alert on the float shadow framed by its ring and the 4px tone edge.
async function checkToasts(run) {
  if (!run.wants('toasts') || !await run.page.locator('.docs-stage .cb-toasts').count()) {
    return;
  }
  const { page, check, snap } = run;
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const stack = page.locator('.docs-stage .cb-toasts').first();
    await stack.evaluate((element) => element.closest('.docs-stage').scrollIntoView({ block: 'center' }));
    const toasts = await stack.evaluate(measureToastStack);
    check(!toasts.problems.length && toasts.count > 0, `toast stack at ${width}px: fixed in the corner, polite, clicks pass between messages`, toasts.problems.join('; ') || `${toasts.count} messages`);
    // Laid out is not painted: the middle of the first message must show its tint, not the stage.
    const stage = page.locator('.docs-stage:has(.cb-toasts)').first();
    const messageCentre = await stage.evaluate((element) => {
      const stageBox = element.getBoundingClientRect();
      const messageBox = element.querySelector('.cb-toasts > *').getBoundingClientRect();
      return [(messageBox.left + messageBox.width / 2 - stageBox.left) / stageBox.width, (messageBox.top + messageBox.height / 2 - stageBox.top) / stageBox.height];
    });
    const pixelAt = await readPixels(page, stage);
    const messagePixel = await pixelAt(...messageCentre);
    const stagePixel = await pixelAt(0.05, 0.1);
    const painted = messagePixel.some((value, i) => Math.abs(value - stagePixel[i]) > 6);
    check(painted, `toast stack at ${width}px is painted, not only laid out`, `message ${messagePixel} vs stage ${stagePixel}`);
    await snap(page.locator('.docs-stage:has(.cb-toasts)').first(), `toasts-${width}.png`);
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// In-page, with the probe menu open without the script: where it sits and how it looks.
function measureNativeMenu() {
  const menu = document.getElementById('m-peer-1');
  const box = menu.getBoundingClientRect();
  const style = getComputedStyle(menu);
  const probe = document.body.appendChild(document.createElement('i'));
  const tokenColour = (name) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const tokens = {
    raised: tokenColour('--cb-bg-raised'),
    strong: tokenColour('--cb-border-strong'),
    danger: tokenColour('--cb-danger'),
    disabled: tokenColour('--cb-text-disabled'),
  };
  probe.remove();
  const items = [...menu.querySelectorAll('.cb-menu__item')];
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    open: menu.matches(':popover-open'),
    top: hit ? menu.contains(hit) : false,
    centre: [box.left + box.width / 2 - innerWidth / 2, box.top + box.height / 2 - innerHeight / 2],
    look: style.backgroundColor === tokens.raised && style.borderTopColor === tokens.strong && style.borderTopWidth === '1px' && /0px 0px 0px 1px/.test(style.boxShadow),
    heights: [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().height)))],
    full: items.every((item) => Math.abs(item.getBoundingClientRect().width - menu.clientWidth) < 1),
    danger: getComputedStyle(menu.querySelector('.cb-menu__item--danger')).color === tokens.danger,
    disabled: getComputedStyle(menu.querySelector('.cb-menu__item:disabled')).color === tokens.disabled,
  };
}

// In-page: a key and menu swapped in at the left edge are placed flush with the key's left edge.
async function probeSwappedInMenu() {
  const holder = document.createElement('div');
  holder.innerHTML = '<button class="cb-btn cb-btn--sm" type="button" popovertarget="m-vb" aria-haspopup="menu">Act</button>'
    + '<div class="cb-menu" id="m-vb" popover role="menu" aria-label="Probe" data-cb-menu><button class="cb-menu__item" type="button" role="menuitem">One</button></div>';
  document.body.prepend(holder);
  scrollTo(0, 0);
  // Let that scroll event pass.
  await new Promise((resolveFrame) => requestAnimationFrame(() => setTimeout(resolveFrame, 50)));
  const key = holder.querySelector('button');
  key.click();
  await new Promise((resolveTick) => setTimeout(resolveTick, 50));
  const menu = document.getElementById('m-vb');
  const placement = {
    open: menu.matches(':popover-open'),
    left: menu.getBoundingClientRect().left - key.getBoundingClientRect().left,
    focus: document.activeElement.textContent,
  };
  menu.hidePopover();
  holder.remove();
  return placement;
}

// 30. Menus. Without the script (native popover and CSS only): the key opens its menu in the
//     top layer, unclipped by the table wrapper and centred by the UA; a raised list on the
//     float shadow with 24px items, danger and disabled ink, and the focus ring inside the list.
async function checkMenus(run) {
  if (!run.wants('menu') || !await run.page.locator('.docs-demo [data-cb-menu]').count()) {
    return;
  }
  const { check, snap } = run;
  const noScriptContext = await run.browser.newContext({ ...run.contextOptions, javaScriptEnabled: false });
  const noScriptPage = await run.openPage({ browserContext: noScriptContext });
  for (const width of [1360, 360]) {
    await noScriptPage.setViewportSize({ width, height: 900 });
    await noScriptPage.locator(MENU_KEY).scrollIntoViewIfNeeded();
    await noScriptPage.click(MENU_KEY);
    const menu = await noScriptPage.evaluate(measureNativeMenu);
    const centred = menu.open && menu.top && Math.abs(menu.centre[0]) < 2 && Math.abs(menu.centre[1]) < 2;
    const looks = menu.look && menu.heights.length === 1 && menu.heights[0] === 24 && menu.full && menu.danger && menu.disabled;
    check(centred && looks, `menu without the script at ${width}px: opens centred over the page, raised list, 24px items, danger and disabled ink`, JSON.stringify(menu));
    if (width === 1360) {
      // From the key, Tab enters the open popover at its first item (Option+Tab in WebKit).
      await noScriptPage.locator(MENU_KEY).focus();
      await noScriptPage.keyboard.press(run.tabKey);
      const ring = await noScriptPage.evaluate(() => {
        const focused = document.activeElement;
        const style = getComputedStyle(focused);
        const kind = focused.matches('#m-peer-1 .cb-menu__item') ? 'item' : focused.tagName;
        return `${kind} ${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`;
      });
      check(ring === 'item solid 2px -3px', 'a menu item reached by Tab draws the focus ring inside the list', ring);
    }
    await snap(noScriptPage, `menu-nojs-${width}.png`);
    await noScriptPage.keyboard.press('Escape');
  }
  await noScriptContext.close();

  // With cubicle.js: placed at its key (below, or above near the viewport bottom; flush with the
  // key's right edge in the right half, its left edge otherwise), focus on the first item, arrow
  // keys that skip disabled items and wrap, Home / End, Escape and Tab back to the key's place,
  // aria-expanded on the key, and closing on an item click, an outside click and a scroll.
  const menuPage = await run.openPage({ viewport: DESKTOP_VIEWPORT });
  const key = menuPage.locator(MENU_KEY);
  const menu = menuPage.locator('#m-peer-1');
  const isOpen = () => menu.evaluate((element) => element.matches(':popover-open'));
  const readFocus = () => menuPage.evaluate(() => {
    const focused = document.activeElement;
    if (focused.closest('.cb-menu')) {
      return focused.textContent.trim();
    }
    return focused.getAttribute('popovertarget') ?? focused.tagName;
  });
  const readPlacement = () => menuPage.evaluate(() => {
    const keyBox = document.querySelector('.docs-demo [popovertarget="m-peer-1"]').getBoundingClientRect();
    const menuBox = document.getElementById('m-peer-1').getBoundingClientRect();
    return {
      below: menuBox.top - keyBox.bottom,
      above: keyBox.top - menuBox.bottom,
      right: menuBox.right - keyBox.right,
      inView: menuBox.top >= 0 && menuBox.bottom <= document.documentElement.clientHeight,
    };
  });
  const readExpanded = () => key.getAttribute('aria-expanded');
  // The key opens the menu natively; its toggle event (a task later) moves focus in.
  const waitForToggle = () => menuPage.waitForTimeout(50);
  // A wheel turn reaches the page as a scroll event some frames later, and the script closes the menu
  // on it. Waits for that; a menu that stays open is reported by the check below.
  const waitForMenuToClose = async () => {
    try {
      await menuPage.waitForFunction(() => !document.getElementById('m-peer-1').matches(':popover-open'), null, { timeout: SCROLL_WAIT_MS });
    } catch {
      // Still open: steps.scroll records it.
    }
  };
  const steps = {};

  await key.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await key.click();
  await waitForToggle();
  steps.click = { open: await isOpen(), place: await readPlacement(), focus: await readFocus(), expanded: await readExpanded() };
  // A scroll event that does not move the key (a wrapper scrolled into view just before the
  // click reports it a frame later) leaves the menu open.
  await key.evaluate((element) => element.closest('.cb-table-wrap').dispatchEvent(new Event('scroll')));
  await waitForToggle();
  steps.still = await isOpen();
  const walk = [];
  for (const walkKey of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'End', 'Home', 'ArrowUp']) {
    await menuPage.keyboard.press(walkKey);
    walk.push(await readFocus());
  }
  steps.walk = walk;
  await menuPage.keyboard.press('Escape');
  steps.escape = { open: await isOpen(), focus: await readFocus(), expanded: await readExpanded() };
  await menuPage.keyboard.press('ArrowUp');
  steps.up = { open: await isOpen(), focus: await readFocus() };
  await menuPage.keyboard.press('Escape');
  await menuPage.keyboard.press('ArrowDown');
  steps.down = await readFocus();
  await menuPage.keyboard.press(run.tabKey);
  steps.tab = { open: await isOpen(), focus: await readFocus() };
  await key.click();
  await waitForToggle();
  await menuPage.locator('#m-peer-1 .cb-menu__item').nth(1).click();
  steps.item = { open: await isOpen(), focus: await readFocus() };
  await key.click();
  await waitForToggle();
  await menuPage.mouse.click(5, 5);
  steps.outside = await isOpen();
  await key.click();
  await waitForToggle();
  await menuPage.mouse.wheel(0, 60);
  await waitForMenuToClose();
  steps.scroll = await isOpen();
  // Near the bottom of the viewport the menu opens upwards.
  await key.evaluate((element) => {
    const box = element.getBoundingClientRect();
    scrollBy(0, box.bottom - document.documentElement.clientHeight + 40);
  });
  await menuPage.waitForTimeout(100);
  await key.click();
  await waitForToggle();
  steps.flip = await readPlacement();
  await snap(menuPage, 'menu-up-1360.png');
  await menuPage.keyboard.press('Escape');
  steps.left = await menuPage.evaluate(probeSwappedInMenu);
  await menuPage.close();

  const opens = steps.click.open && steps.click.place.below >= 0 && steps.click.place.below <= 4 && Math.abs(steps.click.place.right) < 1 && steps.click.place.inView
    && steps.click.focus === 'Show details' && steps.click.expanded === 'true' && steps.still;
  const walks = steps.walk.join('|') === 'Rotate key|Download config|Copy public key|Revoke…|Show details|Revoke…|Show details|Revoke…';
  const escapes = !steps.escape.open && steps.escape.focus === 'm-peer-1' && steps.escape.expanded === 'false';
  const arrowsOpen = steps.up.open && steps.up.focus === 'Revoke…' && steps.down === 'Show details';
  const closes = !steps.tab.open && steps.tab.focus === 'm-peer-2'
    && !steps.item.open && steps.item.focus === 'm-peer-1' && !steps.outside && !steps.scroll;
  const flips = steps.flip.above >= 0 && steps.flip.above <= 4 && steps.flip.inView;
  const placesLeft = steps.left.open && Math.abs(steps.left.left) < 1 && steps.left.focus === 'One';
  check(opens && walks && escapes && arrowsOpen && closes && flips && placesLeft, 'menu with cubicle.js: placed at its key, keys, Escape, Tab, closes on item, outside click and scroll, flips up', JSON.stringify(steps));
}

// In-page: every demo log of the Logs section's kind (the right-to-left demo's log is check 34's),
// with the problems found in its type, well, columns, gutter, tones, edges, wrapping and scrolling.
function measureLogs() {
  const probe = document.body.appendChild(document.createElement('i'));
  const tokenColour = (name) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const tones = {
    recessed: tokenColour('--cb-bg-recessed'),
    main: tokenColour('--cb-text-main'),
    debug: tokenColour('--cb-text-muted'),
    info: tokenColour('--cb-info'),
    warn: tokenColour('--cb-warn'),
    error: tokenColour('--cb-danger'),
  };
  probe.style.fontFamily = 'var(--cb-font-mono)';
  const monoFamily = getComputedStyle(probe).fontFamily;
  probe.remove();
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);

  return [...document.querySelectorAll('.docs-demo .cb-log:not([dir="rtl"] *)')].map((log, i) => {
    const style = getComputedStyle(log);
    const problems = [];
    const isMonoType = style.fontFamily === monoFamily && style.fontSize === '12px' && style.fontVariantNumeric.includes('tabular-nums') && style.fontVariantLigatures === 'none';
    if (!isMonoType) {
      problems.push(`type ${style.fontSize} ${style.fontVariantNumeric} ${style.fontVariantLigatures}`);
    }
    if (style.backgroundColor !== tones.recessed || style.boxShadow === 'none') {
      problems.push(`well ${style.backgroundColor}`);
    }
    const lines = [...log.children];
    for (const part of ['.cb-log__time', '.cb-log__level', '.cb-log__msg']) {
      const starts = new Set(lines.map((line) => Math.round(line.querySelector(part).getBoundingClientRect().left)));
      if (starts.size !== 1) {
        problems.push(`${part} starts at ${[...starts]}`);
      }
    }
    const digitCount = String(log.start + lines.length - 1).length;
    const numberStyle = getComputedStyle(lines[0], '::before');
    const gutterWidth = parseFloat(numberStyle.width) - parseFloat(numberStyle.paddingLeft);
    // The width of one digit, measured in the log's own font.
    const digitProbe = document.createElement('span');
    digitProbe.textContent = '0'.repeat(10);
    log.querySelector('.cb-log__msg').append(digitProbe);
    const digitWidth = digitProbe.getBoundingClientRect().width / 10;
    digitProbe.remove();
    if (Math.abs(gutterWidth - digitCount * digitWidth) > 1) {
      problems.push(`gutter ${gutterWidth.toFixed(1)} for ${digitCount} digits of ${digitWidth.toFixed(1)}`);
    }
    for (const line of lines) {
      const level = line.dataset.cbLevel;
      const lineStyle = getComputedStyle(line);
      const wordColour = getComputedStyle(line.querySelector('.cb-log__level')).color;
      if (wordColour !== (tones[level] ?? tones.main)) {
        problems.push(`${level} word ${wordColour}`);
      }
      const expectedEdge = ['warn', 'error'].includes(level) ? `2px ${tones[level]}` : '2px rgba(0, 0, 0, 0)';
      if (`${lineStyle.borderLeftWidth} ${lineStyle.borderLeftColor}` !== expectedEdge) {
        problems.push(`${level} edge ${lineStyle.borderLeftWidth} ${lineStyle.borderLeftColor}`);
      }
    }
    const nowrap = log.matches('.cb-log--nowrap');
    const lineHeight = parseFloat(style.lineHeight);
    const hasTallMessage = lines.some((line) => line.querySelector('.cb-log__msg').getBoundingClientRect().height > lineHeight * 1.5);
    const scrollsSideways = log.scrollWidth > log.clientWidth;
    const wrapsWrongly = nowrap ? (hasTallMessage || !scrollsSideways) : (!hasTallMessage || scrollsSideways);
    if (wrapsWrongly) {
      problems.push(`${nowrap ? 'nowrap' : 'wrap'}: tall ${hasTallMessage}, sideways ${scrollsSideways}`);
    }
    if (!nowrap && (log.scrollHeight <= log.clientHeight || Math.round(log.getBoundingClientRect().height) > 20 * rootFontSize)) {
      problems.push(`scroll ${log.scrollHeight} in ${log.clientHeight}`);
    }
    return { index: i, problems };
  });
}

// 31. Logs: a recessed monospace well (12px, tabular, no ligatures) whose time, level and message
//     columns line up on every line (subgrid), a number gutter as wide as its longest number
//     (start), level words in their tones and a 2px tone edge on warn and error lines, the
//     :target line selected, wrapping (or one line per entry with --nowrap), scrolling past
//     20rem, and the focus ring drawn inside.
async function checkLogs(run) {
  if (!run.wants('log') || !await run.page.locator('.docs-demo .cb-log:not([dir="rtl"] *)').count()) {
    return;
  }
  const { page, check, snap } = run;
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const logs = await page.evaluate(measureLogs);
    for (const log of logs) {
      check(!log.problems.length, `log ${log.index + 1} at ${width}px: monospace well, aligned columns, gutter, tones, edges, wrapping, scroll`, log.problems.join('; '));
    }
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);

  // Generated numbers cannot be read from script: the gutters of the first two lines are
  // compared as pixels, and must differ (the counter counts lines, not a constant).
  const firstLog = page.locator('.docs-demo .cb-log').first();
  await firstLog.evaluate((log) => {
    log.scrollTop = 0;
    log.scrollIntoView({ block: 'center' });
  });
  const gutterShots = [];
  for (const lineIndex of [0, 1]) {
    const gutterBox = await firstLog.evaluate((log, index) => {
      const line = log.children[index];
      const lineBox = line.getBoundingClientRect();
      const numberWidth = parseFloat(getComputedStyle(line, '::before').width);
      return { x: lineBox.left, y: lineBox.top, width: numberWidth + 2, height: lineBox.height };
    }, lineIndex);
    gutterShots.push((await page.screenshot({ clip: gutterBox })).toString('base64'));
  }
  const guttersDiffer = gutterShots[0] !== gutterShots[1];
  check(guttersDiffer, 'log line numbers count up from start (the first two gutters differ)', guttersDiffer ? '' : 'identical gutters');

  // The linked line takes the selected tint; Tab gives the log an inner ring.
  const target = await page.evaluate(async () => {
    const link = document.querySelector('a[href="#L4803"]');
    link.click();
    await new Promise((resolveTick) => setTimeout(resolveTick, 50));
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-selected)';
    const selectedColour = getComputedStyle(probe).color;
    probe.remove();
    const result = {
      selected: getComputedStyle(document.getElementById('L4803')).backgroundColor === selectedColour,
      other: getComputedStyle(document.getElementById('L4804')).backgroundColor !== selectedColour,
    };
    history.replaceState(null, '', location.pathname);
    return result;
  });
  check(target.selected && target.other, 'a linked log line (:target) takes the selected tint', JSON.stringify(target));
  const keyboardPage = await run.openPage();
  await keyboardPage.locator('a[href="#L4803"]').focus();
  await keyboardPage.keyboard.press(run.tabKey);
  await keyboardPage.keyboard.press(run.shiftTabKey);
  await keyboardPage.keyboard.press(run.tabKey);
  const ring = await keyboardPage.evaluate(() => {
    const focused = document.activeElement;
    const style = getComputedStyle(focused);
    return `${focused.matches('.cb-log') ? 'log' : focused.tagName} ${style.outlineStyle} ${style.outlineOffset}`;
  });
  await keyboardPage.close();
  check(ring === 'log solid -3px', 'a log reached by Tab draws the focus ring inside', ring);

  const section = page.locator('#log');
  if (run.saving) {
    for (const width of [1360, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await section.scrollIntoViewIfNeeded();
      await snap(section, `log-${width}.png`);
    }
    await page.setViewportSize(DESKTOP_VIEWPORT);
  }
}

// 32. Master-detail: at 1360px the split's two children sit side by side, tops aligned, the
//     master about twice the detail; at 360px the detail goes under the master at full width.
async function checkSplit(run) {
  if (!run.wants('split') || !await run.page.locator('.docs-demo .cb-split').count()) {
    return;
  }
  const { page, check, snap } = run;
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const split = await page.$eval('.docs-demo .cb-split', (element) => {
      const [masterBox, detailBox] = [...element.children].map((child) => child.getBoundingClientRect());
      const width = element.clientWidth;
      return {
        side: Math.abs(masterBox.top - detailBox.top) < 0.5 && detailBox.left > masterBox.right,
        ratio: masterBox.width / detailBox.width,
        stacked: detailBox.top >= masterBox.bottom && Math.abs(masterBox.width - width) < 0.5 && Math.abs(detailBox.width - width) < 0.5,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    let laidOut = split.stacked;
    if (width === 1360) {
      laidOut = split.side && split.ratio > 1.8 && split.ratio < 2.2;
    }
    check(!split.overflow && laidOut, `master-detail at ${width}px: ${width === 1360 ? 'side by side, 2:1' : 'detail under the master'}`, JSON.stringify(split));
    await snap(page.locator('.docs-demo:has(> .cb-split)').first(), `split-${width}.png`);
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// In-page, in forced colours: the state and disabled selectors whose first demo element does
// not take Highlight / HighlightText or GrayText.
function findUnforcedStates([stateSelectors, disabledSelectors]) {
  const probe = document.body.appendChild(document.createElement('i'));
  const systemColour = (keyword) => {
    probe.style.color = keyword;
    return getComputedStyle(probe).color;
  };
  const system = { hl: systemColour('Highlight'), hlText: systemColour('HighlightText'), gray: systemColour('GrayText') };
  probe.remove();
  const firstDemoElement = (selector) => document.querySelector(`.docs-demo ${selector}`);
  const wrongStates = [];
  for (const selector of stateSelectors) {
    const element = firstDemoElement(selector);
    if (!element) {
      wrongStates.push(`${selector}: missing`);
      continue;
    }
    const style = getComputedStyle(element);
    if (!(style.backgroundColor === system.hl && style.color === system.hlText)) {
      wrongStates.push(`${selector}: ${style.backgroundColor} / ${style.color}`);
    }
  }
  const wrongDisabled = [];
  for (const selector of disabledSelectors) {
    const element = firstDemoElement(selector);
    if (!element) {
      wrongDisabled.push(`${selector}: missing`);
      continue;
    }
    const style = getComputedStyle(element);
    if (style.color !== system.gray) {
      wrongDisabled.push(`${selector}: ${style.color}`);
    }
  }
  return { states: wrongStates, disabled: wrongDisabled, t: system };
}

// In-page, in forced colours: marks, lamps, sort arrows, the spinner, the select arrow and log
// edges that would vanish.
function findVanishingMarks() {
  const probe = document.body.appendChild(document.createElement('i'));
  const systemColour = (keyword) => {
    probe.style.color = keyword;
    return getComputedStyle(probe).color;
  };
  const system = { text: systemColour('CanvasText'), canvas: systemColour('Canvas'), gray: systemColour('GrayText') };
  probe.remove();
  const demoStyle = (selector, pseudo) => {
    const element = document.querySelector(`.docs-demo ${selector}`);
    return element ? getComputedStyle(element, pseudo) : null;
  };
  const problems = [];
  const markSelectors = [
    '.cb-check[type="checkbox"]:checked:not(:disabled)',
    '.cb-check[type="radio"]:checked:not(:disabled)',
    '.cb-led--ok',
    '.cb-badge--ok:not([aria-busy="true"])',
    '[aria-sort="ascending"] > .cb-table__sort',
  ];
  for (const selector of markSelectors) {
    const markStyle = demoStyle(selector, selector.includes('cb-table__sort') ? '::after' : '::before');
    if (!markStyle) {
      problems.push(`${selector}: missing`);
      continue;
    }
    if (markStyle.backgroundColor !== system.text) {
      problems.push(`${selector}: ${markStyle.backgroundColor}`);
    }
  }
  const offLamp = demoStyle('.cb-led--off', '::before');
  if (offLamp && offLamp.backgroundColor === system.text) {
    problems.push('off lamp filled');
  }
  const spinner = demoStyle('.cb-btn[aria-busy="true"]', '::before');
  if (!spinner || spinner.borderTopColor !== system.text || spinner.borderBottomColor !== system.gray) {
    problems.push(`spinner ${spinner?.borderTopColor} / ${spinner?.borderBottomColor}`);
  }
  const select = demoStyle('select.cb-select:not([multiple]):not([size])');
  if (!select || select.appearance === 'none') {
    problems.push(`select appearance ${select?.appearance}`);
  }
  const logLines = [...document.querySelectorAll('.docs-demo .cb-log > li')];
  const infoLine = logLines.find((line) => line.dataset.cbLevel === 'info');
  const errorLine = logLines.find((line) => line.dataset.cbLevel === 'error');
  const infoEdge = getComputedStyle(infoLine).borderLeftColor;
  const errorEdge = getComputedStyle(errorLine).borderLeftColor;
  if (infoEdge !== system.canvas || errorEdge !== system.text) {
    problems.push(`log edges ${infoEdge} / ${errorEdge}`);
  }
  return problems;
}

// 33. Forced colours (a forcedColors: 'active' context; Chromium and Firefox force the palette,
//     WebKit only matches the media query, so there the rules are checked as written). State
//     that a fill or a shadow carries maps to Highlight / HighlightText, and unavailable controls
//     to GrayText; system colours are resolved through a probe in the same context.
async function checkForcedColours(run) {
  if (!run.wants('forced') || !await run.page.locator('.docs-demo').count()) {
    return;
  }
  const { check, snap } = run;
  const forcedContext = await run.browser.newContext({ ...run.contextOptions, forcedColors: 'active' });
  const forcedPage = await run.openPage({ browserContext: forcedContext });
  const unforced = await forcedPage.evaluate(findUnforcedStates, [FORCED_STATE_SELECTORS, FORCED_DISABLED_SELECTORS]);
  check(!unforced.states.length, 'forced colours: selected, pressed, current and checked states take Highlight', unforced.states.join('; ') || `${FORCED_STATE_SELECTORS.length} states`);
  check(!unforced.disabled.length, 'forced colours: unavailable controls take GrayText', unforced.disabled.join('; ') || `${FORCED_DISABLED_SELECTORS.length} kinds`);

  const option = await forcedPage.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'Highlight';
    const highlight = getComputedStyle(probe).color;
    probe.remove();
    const optionStyle = getComputedStyle(document.querySelector('.docs-demo .cb-select[multiple]:not(:disabled) option:checked'));
    return { ok: optionStyle.backgroundColor === highlight, bg: optionStyle.backgroundColor };
  });
  check(option.ok, 'forced colours: selected list-box options take Highlight', option.bg);

  const link = await forcedPage.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'HighlightText';
    const highlightText = getComputedStyle(probe).color;
    probe.remove();
    const anchor = document.querySelector('.docs-demo .cb-table tbody tr[aria-selected="true"] > :is(th, td) a');
    if (!anchor) {
      return { ok: false, color: 'missing' };
    }
    return { ok: getComputedStyle(anchor).color === highlightText, color: getComputedStyle(anchor).color };
  });
  check(link.ok, 'forced colours: a link in a selected row takes HighlightText', link.color);

  const innerBox = await forcedPage.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'CanvasText';
    const canvasText = getComputedStyle(probe).color;
    probe.remove();
    const box = document.querySelector('.docs-demo .cb-table tbody tr:has(> td > .cb-check:checked) .cb-check:checked');
    return { adjust: getComputedStyle(box).forcedColorAdjust, mark: getComputedStyle(box, '::before').backgroundColor === canvasText };
  });
  // WebKit has no forced-color-adjust (undefined), which is the same as auto there.
  check((innerBox.adjust ?? 'auto') === 'auto' && innerBox.mark, 'forced colours: a check box in a highlighted row is forced again, with its mark', JSON.stringify(innerBox));

  // Marks, lamps, arrows, the spinner, the select's arrow and log edges stay visible.
  const vanishing = await forcedPage.evaluate(findVanishingMarks);
  check(!vanishing.length, 'forced colours: marks, lamps, sort arrows, the spinner, the select arrow and log edges stay visible', vanishing.join('; '));

  // Meter fills are engine pseudo-elements: compare pixels of the filled and the empty part.
  const meter = forcedPage.locator('.docs-demo meter.cb-meter').first();
  await meter.scrollIntoViewIfNeeded();
  const meterPng = (await meter.screenshot()).toString('base64');
  const meterFraction = await meter.evaluate((element) => (element.value - element.min) / (element.max - element.min));
  const fill = await forcedPage.evaluate(async ([base64, fraction]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const canvasContext = canvas.getContext('2d');
    canvasContext.drawImage(image, 0, 0);
    const pixelAt = (fractionX) => [...canvasContext.getImageData(Math.floor(fractionX * image.width), Math.floor(image.height * 0.3), 1, 1).data].slice(0, 3);
    return { filled: pixelAt(0.03), empty: pixelAt(Math.min(0.97, fraction + 0.1)) };
  }, [meterPng, meterFraction]);
  const fillShows = fill.filled.some((value, i) => Math.abs(value - fill.empty[i]) > 40);
  check(fillShows, 'forced colours: a meter shows its fill against the empty track', JSON.stringify(fill));

  const sectionIds = run.saving ? FORCED_SHOT_SECTIONS : [];
  for (const sectionId of sectionIds) {
    const section = forcedPage.locator(`#${sectionId}`);
    await section.scrollIntoViewIfNeeded();
    await snap(section, `forced-${sectionId}.png`);
  }
  await forcedContext.close();
}

// A rough brightness of an [r, g, b] pixel (luma weights, 0-255), for telling dark from light.
function brightness([red, green, blue]) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

// Counts dark samples along the middle row of an element, between two fractions of its width.
async function countDarkSamples(page, locator, from, to) {
  const pixelAt = await readPixels(page, locator);
  let darkCount = 0;
  for (let step = 0; step <= 20; step++) {
    const pixel = await pixelAt(from + (to - from) * step / 20, 0.5);
    if (brightness(pixel) < 120) {
      darkCount++;
    }
  }
  return darkCount;
}

// In-page, for the log lines of a right-to-left subtree: whether time, level and message run
// from the right, whether each message (Latin text) ends with its last character on the right,
// and whether every line of the message meets the level column (aligned to the right).
function measureLogLineDirections(lines) {
  const characterBox = (textNode, offset) => {
    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);
    return range.getBoundingClientRect();
  };
  const directions = [];
  for (const line of lines) {
    const boxOf = (selector) => line.querySelector(selector).getBoundingClientRect();
    const time = boxOf('.cb-log__time');
    const level = boxOf('.cb-log__level');
    const messageBox = boxOf('.cb-log__msg');
    const messageText = line.querySelector('.cb-log__msg').firstChild;
    const firstCharacter = characterBox(messageText, 0);
    const lastCharacter = characterBox(messageText, messageText.length - 1);
    const wholeMessage = document.createRange();
    wholeMessage.selectNodeContents(messageText);
    // WebKit returns one box per word run, so the right end of each line is the furthest one.
    const lineEnds = new Map();
    for (const runBox of wholeMessage.getClientRects()) {
      const lineTop = Math.round(runBox.top);
      lineEnds.set(lineTop, Math.max(lineEnds.get(lineTop) ?? -Infinity, runBox.right));
    }
    directions.push({
      text: messageText.textContent,
      columnsFromRight: time.right > level.right && level.right > messageBox.right,
      endPunctuationLast: lastCharacter.left > firstCharacter.left,
      alignedRight: [...lineEnds.values()].every((lineEnd) => messageBox.right - lineEnd < 1),
    });
  }
  return directions;
}

// 34. Right to left. On the catalogue's dir="rtl" demo: the select chevron sits at the left end,
//     the current link's accent bar on its right edge, the vertical tab line on the list's left
//     edge, a closed disclosure chevron points left and an open one down, log columns run from
//     the right while a Latin message keeps its final punctuation at its end, and the meter's low
//     mark sits 70% from the right, where the fill starts. Then both pages with dir="rtl" on
//     <html> have no horizontal overflow at 360, 800 and 1360px.
async function checkRightToLeft(run) {
  if (!run.wants('rtl')) {
    return;
  }
  const { page, check, snap } = run;
  const demo = page.locator('.docs-demo > [dir="rtl"]');
  if (await demo.count()) {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await demo.scrollIntoViewIfNeeded();
    const chevron = { left: await countDarkSamples(page, page.locator('#rtl-role'), 0.01, 0.06) };
    const currentLink = page.locator('.docs-demo > [dir="rtl"] .cb-nav__link[aria-current="page"]');
    const linkPixelAt = await readPixels(page, currentLink);
    const bar = { right: brightness(await linkPixelAt(0.998, 0.5)), left: brightness(await linkPixelAt(0.002, 0.5)) };
    // The chevron turns over --cb-duration: read it once it has arrived, however late the frames run.
    const geometry = await page.evaluate(async (waitLimit) => {
      const rtlDemo = document.querySelector('.docs-demo > [dir="rtl"]');
      const readRotation = (summary) => getComputedStyle(summary, '::before').rotate;
      const waitForRotation = async (summary, expectedRotation) => {
        for (let waited = 0; waited < waitLimit && readRotation(summary) !== expectedRotation; waited += 20) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
      };
      const tabList = rtlDemo.querySelector('.cb-tabs--vertical > .cb-tabs__list');
      const summary = rtlDemo.querySelector('details > summary');
      const closedRotation = readRotation(summary);
      summary.parentElement.open = true;
      await waitForRotation(summary, '-45deg');
      const openRotation = readRotation(summary);
      summary.parentElement.open = false;
      await waitForRotation(summary, closedRotation);
      const tabStyle = getComputedStyle(tabList.querySelector('[aria-current="page"]'));
      return {
        line: getComputedStyle(tabList).backgroundPositionX,
        closed: closedRotation,
        open: openRotation,
        sheet: tabStyle.borderLeftColor === tabStyle.backgroundColor,
      };
    }, TRANSITION_WAIT_MS);
    // The low and high marks (main ink, darker than the ticks) in the ruler strip, as fractions
    // from the left: low 70% and high 90% from the right are 0.3 and 0.1.
    const meter = page.locator('#rtl-cpu');
    const meterPixelAt = await readPixels(page, meter);
    const meterHeight = await meter.evaluate((element) => element.getBoundingClientRect().height);
    const marks = [];
    for (let step = 3; step <= 197; step++) {
      const pixel = await meterPixelAt(step / 200, (meterHeight - 1) / meterHeight);
      const nearKnownMark = marks.some((mark) => Math.abs(mark - step / 200) < 0.02);
      if (brightness(pixel) < 60 && !nearKnownMark) {
        marks.push(step / 200);
      }
    }
    const hasRulerStrip = await meter.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom) > 0);
    const mirrored = chevron.left > 0 && bar.right < bar.left - 40 && /^0(%|px)$/.test(geometry.line) && geometry.closed === '45deg' && geometry.open === '-45deg' && geometry.sheet;
    const mirroredName = 'right to left: select chevron at the left, accent bar on the right, tab line on the left and the selected tab joined to its panel, chevrons turned';
    check(mirrored, mirroredName, JSON.stringify({ chevron, bar, geo: geometry }));
    const logLines = await page.$$eval('.docs-demo > [dir="rtl"] .cb-log > li', measureLogLineDirections);
    const logReadsRight = logLines.length > 0 && logLines.every((line) => line.columnsFromRight && line.endPunctuationLast && line.alignedRight);
    check(logReadsRight, 'right to left: log columns run from the right, and a Latin message keeps its final punctuation at its end, aligned to its level', JSON.stringify(logLines));
    if (hasRulerStrip) {
      const marksFromRight = marks.length === 2 && Math.abs(marks[0] - 0.1) < 0.03 && Math.abs(marks[1] - 0.3) < 0.03;
      check(marksFromRight, 'right to left: the meter marks count from the right, where the fill starts', `marks at ${marks.join(', ')}`);
    }
    const widths = run.saving ? [1360, 360] : [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await demo.scrollIntoViewIfNeeded();
      await snap(page.locator('.docs-demo:has(> [dir="rtl"])'), `rtl-${width}.png`);
    }
    await page.setViewportSize(DESKTOP_VIEWPORT);
  }

  const rtlPage = await run.openPage();
  await rtlPage.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });
  const overflows = [];
  for (const width of [360, 800, 1360]) {
    await rtlPage.setViewportSize({ width, height: 900 });
    const overflow = await rtlPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) {
      overflows.push(`${width}px: ${overflow}px`);
    }
  }
  await rtlPage.close();
  check(!overflows.length, 'right to left: the whole page has no horizontal overflow at 360, 800 and 1360px', overflows.join(', '));
}

// In-page: the structure the console recipes promise (bulk bar, permission matrix, health grid).
function readConsoleRecipes() {
  const bulkForm = document.getElementById('rb-form');
  const checkedPeers = bulkForm.querySelectorAll('input[name="peer"]:checked').length;
  const bulkStatus = bulkForm.querySelector('[role="status"]')?.textContent.trim() ?? '';
  const bulkKeys = [...bulkForm.querySelectorAll('button[name="action"]')].map((key) => `${key.value}:${key.textContent.trim()}`);

  const matrix = document.querySelector('#recipes-permissions ~ .docs-demo table');
  const columnNames = [...matrix.tHead.rows[0].cells].map((cell) => cell.textContent.trim());
  const misnamed = [];
  for (const row of matrix.tBodies[0].rows) {
    const rowHeader = row.cells[0].textContent.trim();
    const roleName = rowHeader.split(' ')[0];
    [...row.cells].slice(1).forEach((cell, i) => {
      const box = cell.querySelector('input[type="checkbox"]');
      const boxName = box?.getAttribute('aria-label') ?? '';
      const wantedName = `${roleName}: ${columnNames[i + 1]}`;
      const inheritedRow = /inherited/.test(rowHeader) && rowHeader.includes(columnNames[i + 1]);
      const tintsRow = getComputedStyle(cell).backgroundColor !== getComputedStyle(row.cells[0]).backgroundColor;
      if (!box || boxName !== wantedName || box.disabled !== inheritedRow || tintsRow) {
        misnamed.push(`${wantedName} (${boxName}, disabled ${box?.disabled}, tinted ${tintsRow})`);
      }
    });
  }

  const unlabelledHealth = [];
  const healthDemo = document.querySelector('#recipes-health ~ .docs-demo');
  for (const panel of healthDemo.querySelectorAll('.cb-panel')) {
    const lampWord = panel.querySelector('.cb-led')?.textContent.trim() ?? '';
    const unlabelledMeters = [...panel.querySelectorAll('meter')].filter((meter) => !meter.labels.length && !meter.getAttribute('aria-label'));
    if (!lampWord || unlabelledMeters.length) {
      unlabelledHealth.push(panel.querySelector('.cb-panel__title')?.textContent ?? 'panel');
    }
  }
  return { checkedPeers, bulkStatus, bulkKeys, misnamed, unlabelledHealth };
}

// Opens an account menu by its key, then closes it with Escape. Returns what was seen.
async function exerciseAccountMenu(page, menuSelector) {
  const keySelector = `[popovertarget="${menuSelector.slice(1)}"]`;
  await page.click(keySelector);
  const opened = await page.$eval(menuSelector, (menu) => menu.matches(':popover-open'));
  await page.keyboard.press('Escape');
  return page.$eval(menuSelector, (menu, key) => ({
    opened: true,
    closed: !menu.matches(':popover-open'),
    focusBack: document.activeElement === document.querySelector(key),
    items: [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim()),
  }), keySelector).then((state) => ({ ...state, opened }));
}

// 35b. Console recipes: the account menu opens from its key and Escape closes it with focus back
//      on the key (catalogue and example); the bulk bar's count matches the checked rows and every
//      action key names its action; every matrix box is named "Role: permission" and only inherited
//      grants are disabled; every health panel has an LED word and labelled meters; the session
//      warning opens as a modal with focus on "Stay signed in".
async function checkConsoleRecipes(run) {
  if (!run.wants('recipes')) {
    return;
  }
  const { page, check } = run;
  for (const menuSelector of ACCOUNT_MENUS) {
    if (!await page.locator(menuSelector).count()) {
      continue;
    }
    await exposeControl(page, `[popovertarget="${menuSelector.slice(1)}"]`);
    const menu = await exerciseAccountMenu(page, menuSelector);
    const signsOut = menu.items.at(-1) === 'Sign out';
    check(menu.opened && menu.closed && menu.focusBack && signsOut, `account menu ${menuSelector}: opens from its key, Escape closes it and returns focus; Sign out last`, JSON.stringify(menu));
  }
  if (!await page.locator('#recipes-bulk').count()) {
    return;
  }

  const recipes = await page.evaluate(readConsoleRecipes);
  const bulkOk = recipes.bulkStatus === `${recipes.checkedPeers} selected` && recipes.bulkKeys.length === 2 && recipes.bulkKeys.every((key) => /selected$/.test(key));
  check(bulkOk, 'recipe bulk bar: the status counts the checked rows; each key names its action', JSON.stringify({ status: recipes.bulkStatus, checked: recipes.checkedPeers, keys: recipes.bulkKeys }));
  check(!recipes.misnamed.length, 'recipe permission matrix: every box named "Role: permission", only inherited grants disabled, no row tinted as selected', recipes.misnamed.slice(0, 3).join(' | '));
  check(!recipes.unlabelledHealth.length, 'recipe health grid: every panel has an LED word and labelled meters', recipes.unlabelledHealth.join(', '));

  await page.click('[data-cb-modal="rt-dialog"]');
  const warning = await page.$eval('#rt-dialog', (dialog) => ({
    modal: dialog.matches(':modal'),
    focus: document.activeElement?.textContent.trim() ?? '',
  }));
  await page.keyboard.press('Escape');
  const closed = await page.$eval('#rt-dialog', (dialog) => !dialog.open);
  check(warning.modal && warning.focus === 'Stay signed in' && closed, 'recipe session timeout: opens as a modal with focus on "Stay signed in"; Escape closes it', JSON.stringify({ ...warning, closed }));
}

// 35. Recipes and their primitives. .cb-center puts its child in the middle of the frame on
//     both axes, at most 24rem wide (full width less 16px on each side when narrower).
async function checkCentre(run) {
  if (!run.wants('recipes') || !await run.page.locator('.docs-demo .cb-center').count()) {
    return;
  }
  const { page } = run;
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const centres = await page.$$eval('.docs-demo .cb-center', (elements) => elements.map((element) => {
      const frameBox = element.getBoundingClientRect();
      const childBox = element.firstElementChild.getBoundingClientRect();
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {
        dx: (childBox.left + childBox.width / 2) - (frameBox.left + frameBox.width / 2),
        dy: (childBox.top + childBox.height / 2) - (frameBox.top + frameBox.height / 2),
        w: childBox.width,
        want: Math.min(24 * rootFontSize, frameBox.width - 32),
        h: frameBox.height,
        frame: element.parentElement.clientHeight,
      };
    }));
    const offCentre = centres.filter((centre) => !(Math.abs(centre.dx) < 1 && Math.abs(centre.dy) < 1 && Math.abs(centre.w - centre.want) < 1 && Math.abs(centre.h - centre.frame) < 1));
    const wantWidth = Math.round(centres[0].want);
    run.check(!offCentre.length, `centre at ${width}px: the child sits in the middle, ${wantWidth}px wide (${centres.length} demos)`, JSON.stringify(offCentre[0] ?? centres[0]));
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// The recipes themselves: the filter bar wraps inside its panel at 360px, the code field asks
// for digits and one-time codes, the current wizard step is bold, the colour readout follows
// its field, and the masked secret shows nothing until its details open.
async function checkRecipes(run) {
  if (!run.wants('recipes') || !await run.page.locator('#recipes').count()) {
    return;
  }
  const { page, check, snap } = run;
  await page.setViewportSize({ width: 360, height: 900 });
  const filterBar = await page.$eval(RECIPE_FILTER_FORM, (form) => {
    const panelBox = form.closest('.cb-panel').getBoundingClientRect();
    const childBoxes = [...form.children].map((child) => child.getBoundingClientRect());
    return {
      rows: new Set(childBoxes.map((box) => Math.round(box.top))).size,
      inside: childBoxes.every((box) => box.left >= panelBox.left && box.right <= panelBox.right + 0.5),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  check(filterBar.rows > 1 && filterBar.inside && !filterBar.overflow, 'recipe filter bar: wraps inside its panel at 360px', JSON.stringify(filterBar));
  await page.setViewportSize(DESKTOP_VIEWPORT);

  // Enter in a field presses the form's first submit key: it must filter, not drop a filter.
  await page.evaluate((formSelector) => {
    const form = document.querySelector(formSelector);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const submitter = event.submitter;
      form.dataset.submitter = submitter ? `${submitter.textContent.trim()} ${submitter.name}=${submitter.value}` : 'none';
    }, { once: true });
  }, RECIPE_FILTER_FORM);
  await page.focus(`${RECIPE_FILTER_FORM} input[type="search"]`);
  await page.keyboard.press('Enter');
  const submitter = await page.$eval(RECIPE_FILTER_FORM, (form) => {
    const description = form.dataset.submitter ?? 'no submit';
    delete form.dataset.submitter;
    return description;
  });
  check(!/drop=/.test(submitter) && submitter !== 'no submit', 'recipe filter bar: Enter in the search field filters, without dropping a filter', submitter);

  const recipes = await page.evaluate(async () => {
    const codeField = document.getElementById('rs-code');
    const currentStep = document.querySelector('#recipes-steps ~ .docs-demo [aria-current="step"]');
    const colourField = document.getElementById('rc-colour');
    const colourOutput = document.querySelector('output[for="rc-colour"]');
    colourField.value = '#991b1b';
    colourField.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    const readout = colourOutput.value;
    colourField.value = '#1e4b85';
    colourField.dispatchEvent(new Event('input', { bubbles: true }));
    // Earlier checks may have opened it (exposeControl() for the copy key): start closed.
    const well = document.getElementById('rm-key');
    const details = well.closest('details');
    details.open = false;
    // A closed details hides its content with content-visibility, which keeps boxes: ask for visibility.
    const hiddenWhenClosed = !well.checkVisibility();
    details.open = true;
    const shownWhenOpen = well.checkVisibility();
    details.open = false;
    return {
      code: `${codeField.inputMode} ${codeField.getAttribute('autocomplete')} ${codeField.pattern}`,
      step: getComputedStyle(currentStep).fontWeight,
      read: readout,
      closed: hiddenWhenClosed,
      opened: shownWhenOpen,
    };
  });
  const recipesOk = recipes.code === 'numeric one-time-code [0-9]{6}' && recipes.step === '600' && recipes.read === '#991b1b' && recipes.closed && recipes.opened;
  check(recipesOk, 'recipes: one-time code field, current step, colour readout, masked secret', JSON.stringify(recipes));

  const recipeIds = run.saving ? RECIPE_SHOT_SECTIONS : [];
  for (const recipeId of recipeIds) {
    for (const width of [1360, 360]) {
      await page.setViewportSize({ width, height: 900 });
      const recipeDemo = page.locator(`#${recipeId} ~ .docs-demo`).first();
      await recipeDemo.scrollIntoViewIfNeeded();
      await snap(recipeDemo, `${recipeId}-${width}.png`);
    }
  }
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// 36. Print (print media emulated on a fresh page). The application frame unrolls into one
//     column without the sidebar, main stops scrolling, and script-only actions, the Menu key,
//     chip remove keys and toasts are hidden; scroll wrappers and logs print in full and a
//     --nowrap log wraps.
async function checkPrint(run) {
  if (!run.wants('print')) {
    return;
  }
  const printPage = await run.openPage();
  await printPage.emulateMedia({ media: 'print' });
  const printed = await printPage.evaluate((hiddenInPrint) => {
    const result = {};
    const styleOf = (selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element) : null;
    };
    if (document.querySelector('body > .cb-app')) {
      result.frame = {
        main: styleOf('.cb-app__main').overflowY,
        side: styleOf('.cb-app__side').display,
        height: styleOf('body > .cb-app').blockSize,
        min: styleOf('body > .cb-app').minBlockSize,
      };
    }
    const stillShown = [...document.querySelectorAll(hiddenInPrint)].filter((element) => getComputedStyle(element).display !== 'none');
    result.shown = stillShown.slice(0, 3).map((element) => element.outerHTML.slice(0, 60));
    const wrapper = styleOf('.cb-table-wrap--scroll');
    if (wrapper) {
      result.wrap = `${wrapper.maxBlockSize} ${wrapper.overflowY}`;
    }
    const log = styleOf('.cb-log:not(.cb-log--nowrap)');
    if (log) {
      result.log = `${log.maxBlockSize} ${log.overflowY}`;
    }
    const nowrapMessage = styleOf('.cb-log--nowrap .cb-log__msg');
    if (nowrapMessage) {
      result.nowrap = nowrapMessage.whiteSpace;
    }
    return result;
  }, HIDDEN_IN_PRINT);
  const problems = [];
  if (printed.frame && (printed.frame.main !== 'visible' || printed.frame.side !== 'none' || printed.frame.min !== '0px')) {
    problems.push(`frame ${JSON.stringify(printed.frame)}`);
  }
  if (printed.shown.length) {
    problems.push(`still shown: ${printed.shown.join(' | ')}`);
  }
  if (printed.wrap && printed.wrap !== 'none visible') {
    problems.push(`table wrapper ${printed.wrap}`);
  }
  if (printed.log && printed.log !== 'none visible') {
    problems.push(`log ${printed.log}`);
  }
  if (printed.nowrap && printed.nowrap !== 'pre-wrap') {
    problems.push(`nowrap log ${printed.nowrap}`);
  }
  run.check(!problems.length, 'print: the frame unrolls without the sidebar, actions are hidden, wrappers and logs print in full', problems.join('; ') || JSON.stringify(printed));
  if (run.saving && run.engine === 'chromium' && printed.frame) {
    await printPage.pdf({ path: resolve(run.shotsDirectory, 'print-example.pdf'), printBackground: false });
  }
  await printPage.close();
}

// In-page, at one density: targets that fail WCAG 2.5.8 (none counted at compact density), and
// for each row of `rows` the cell the catalogue's target-size table should show.
// Self-contained: Playwright sends it to the page as source.
function measureTargets([density, rows]) {
  if (density === 'default') {
    document.documentElement.removeAttribute('data-cb-density');
  } else {
    document.documentElement.dataset.cbDensity = density;
  }
  const TARGETS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="tab"], [role="menuitem"], [role="treeitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const isLinkInText = (element) => element.localName === 'a'
    && [...element.parentElement.childNodes].some((node) => node !== element && node.nodeType === 3 && node.textContent.trim());
  const isShown = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };
  const targets = [];
  for (const element of document.querySelectorAll(TARGETS)) {
    if (element.closest('.docs-nav, pre, [inert], [hidden], [data-cb-density="compact"]:not(html)') || isLinkInText(element) || !isShown(element)) {
      continue;
    }
    // A control in its label is targeted through the label.
    const label = element.matches('input') ? element.closest('label') : null;
    const host = label ?? element;
    const box = host.getBoundingClientRect();
    targets.push({ element, host, box, isSmall: box.width < 23.5 || box.height < 23.5, centre: [box.left + box.width / 2, box.top + box.height / 2] });
  }
  const distanceToBox = ([pointX, pointY], box) => Math.hypot(Math.max(box.left - pointX, 0, pointX - box.right), Math.max(box.top - pointY, 0, pointY - box.bottom));
  const clashes = (target, other) => {
    if (other === target || other.box === target.box || other.element.contains(target.element) || target.element.contains(other.element)) {
      return false;
    }
    if (other.isSmall) {
      return Math.hypot(other.centre[0] - target.centre[0], other.centre[1] - target.centre[1]) < 24;
    }
    return distanceToBox(target.centre, other.box) < 12;
  };
  const failing = targets.filter((target) => target.isSmall && targets.some((other) => clashes(target, other)));

  const cells = rows.map(({ sel }) => {
    const elements = [...document.querySelectorAll(sel)].filter((element) => !element.closest('[data-cb-density]:not(html)') && isShown(element));
    if (!elements.length) {
      return 'no target';
    }
    const [firstBox, secondBox] = elements.map((element) => element.getBoundingClientRect());
    const isSmall = firstBox.width < 23.5 || firstBox.height < 23.5;
    let gap = Infinity;
    if (secondBox) {
      const dx = secondBox.left + secondBox.width / 2 - firstBox.left - firstBox.width / 2;
      const dy = secondBox.top + secondBox.height / 2 - firstBox.top - firstBox.height / 2;
      gap = Math.round(Math.hypot(dx, dy));
    }
    const fails = failing.some((target) => elements.includes(target.host) || elements.includes(target.element));
    let spacing = '';
    if (isSmall) {
      spacing = gap < 32 ? `, ${gap}px apart` : ', spaced';
    }
    return `${Math.round(firstBox.height)}px${spacing}${fails ? ' · fails' : ''}`;
  });

  const failures = density === 'compact' ? [] : failing.map((target) => {
    const sectionId = target.element.parentElement.closest('[id]')?.id;
    const label = (target.element.textContent || target.element.getAttribute('aria-label') || '').trim().slice(0, 20);
    return `#${sectionId} ${target.element.localName}.${[...target.element.classList].join('.')} ${Math.round(target.box.width)}x${Math.round(target.box.height)} "${label}"`;
  });
  return { cells, fails: failures };
}

// 36b. Target size (WCAG 2.5.8) at default and comfortable density, on a fresh page with every
//     <details> open and every tab panel shown: a target is at least 24x24 CSS px, or a 24px
//     circle on its centre meets no other target or another small target's circle. A control in
//     its label is targeted through the label; links in running text are exempt. Compact density
//     trades this for density on purpose, so compact subtrees are left out. The catalogue's
//     target-size table is measured at all three densities: per row the height of the first
//     target, the distance to the next one when it is small, and whether any of them fails.
async function checkTargetSize(run) {
  if (!run.wants('targets')) {
    return;
  }
  const { check } = run;
  const targetPage = await run.openPage();
  await targetPage.evaluate(() => {
    for (const details of document.querySelectorAll('details:not([open])')) {
      details.open = true;
    }
    for (const panel of document.querySelectorAll('[role="tabpanel"][hidden]')) {
      panel.removeAttribute('hidden');
    }
  });
  for (const density of ['default', 'comfortable']) {
    const { fails } = await targetPage.evaluate(measureTargets, [density, []]);
    check(!fails.length, `targets are 24px or spaced apart at ${density} density (WCAG 2.5.8)`, fails.join('; '));
  }
  if (await targetPage.locator('#accessibility').count()) {
    const tableRows = await targetPage.$$eval('#a11y-targets-table tbody tr', (rows) => rows.map((row) => [...row.children].map((cell) => cell.textContent.trim())));
    const liveCells = {};
    for (const density of ['compact', 'default', 'comfortable']) {
      const measured = await targetPage.evaluate(measureTargets, [density, TARGET_ROWS]);
      liveCells[density] = measured.cells;
    }
    const stale = [];
    if (!tableRows.length) {
      stale.push('table missing');
    } else {
      TARGET_ROWS.forEach(({ name }, i) => {
        const liveRow = [name, liveCells.compact[i], liveCells.default[i], liveCells.comfortable[i]];
        const tableRow = tableRows[i]?.join(' | ');
        if (tableRow !== liveRow.join(' | ')) {
          stale.push(`${tableRow ?? 'missing row'} vs live ${liveRow.join(' | ')}`);
        }
      });
    }
    if (tableRows.length && tableRows.length !== TARGET_ROWS.length) {
      stale.push(`${tableRows.length} rows for ${TARGET_ROWS.length} patterns`);
    }
    check(!stale.length, 'the catalogue target-size table matches the measured sizes', stale.slice(0, 3).join(' || ') || `${tableRows.length} rows`);
  }
  await targetPage.close();
}

// In-page: the token field around `entrySelector`: entry value, focus, chips, the last chip's
// box and key, what the form sends, the live region and the change events counted so far.
function readTokenField(entrySelector) {
  const entry = document.querySelector(entrySelector);
  const well = entry.closest('.cb-tokens');
  const chips = [...well.querySelectorAll('.cb-chip')];
  // A chip's value is its text without the key's cross.
  const chipText = (chip) => [...chip.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim();
  const focusedChip = document.activeElement.closest('.cb-chip');
  let focus = document.activeElement.localName;
  if (document.activeElement === entry) {
    focus = 'entry';
  } else if (focusedChip) {
    focus = chipText(focusedChip);
  }
  let lastChip = '';
  const last = chips.at(-1);
  if (last) {
    const box = last.querySelector('.cb-check');
    const key = last.querySelector('.cb-chip__remove');
    lastChip = `${box?.value}|${box?.checked}|${box?.name}|${key?.getAttribute('aria-label')}`;
  }
  return {
    entry: entry.value,
    focus,
    chips: chips.map(chipText),
    last: lastChip,
    sent: new FormData(entry.form).getAll(entry.name).filter(Boolean),
    live: document.querySelector('[role="status"][data-cb-sr]')?.textContent ?? '',
    changes: Number(entry.dataset.vbChanges ?? 0),
  };
}

// In-page, at one density: the token well's height against one --cb-row-h-sm row plus padding,
// and whether its chips sit in the middle. Returns '' when right.
function measureTokenWell(density) {
  if (density === 'default') {
    document.documentElement.removeAttribute('data-cb-density');
  } else {
    document.documentElement.dataset.cbDensity = density;
  }
  const well = document.querySelector('#tk-scopes').closest('.cb-tokens');
  const style = getComputedStyle(well);
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const expectedHeight = parseFloat(style.getPropertyValue('--cb-row-h-sm')) * rootFontSize + 2 * parseFloat(style.paddingTop) + 2;
  const wellBox = well.getBoundingClientRect();
  const chipBox = well.querySelector('.cb-chip').getBoundingClientRect();
  const above = chipBox.top - wellBox.top;
  const below = wellBox.bottom - chipBox.bottom;
  const ok = Math.abs(wellBox.height - expectedHeight) <= 0.5 && Math.abs(above - below) <= 0.5 && parseFloat(style.paddingTop) > 0;
  if (ok) {
    return '';
  }
  return `${density}: well ${wellBox.height.toFixed(1)} for ${expectedHeight.toFixed(1)}, chip off ${above.toFixed(1)}/${below.toFixed(1)}`;
}

// The behaviour of the catalogue's token fields with the script (#tk-ips, #tk-scopes).
async function checkTokenFieldBehaviour(run, tokenPage) {
  const { check } = run;
  const entry = TOKEN_ENTRY;
  const readState = () => tokenPage.evaluate(readTokenField, entry);
  const waitForFrames = () => tokenPage.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await tokenPage.evaluate((entrySelector) => {
    const entryField = document.querySelector(entrySelector);
    entryField.addEventListener('change', () => {
      entryField.dataset.vbChanges = Number(entryField.dataset.vbChanges ?? 0) + 1;
    });
  }, entry);

  const before = await readState();
  await tokenPage.focus(entry);
  await tokenPage.keyboard.type('10.9.0.0/24');
  await tokenPage.keyboard.press('Enter');
  await waitForFrames();
  const added = await readState();
  const addsChip = added.chips.length === before.chips.length + 1 && added.last === '10.9.0.0/24|true|allowed_ips|Remove 10.9.0.0/24' && added.entry === '' && added.focus === 'entry';
  const tellsOthers = added.sent.includes('10.9.0.0/24') && /Added 10\.9\.0\.0\/24/.test(added.live) && added.changes === 1;
  check(addsChip && tellsOthers, 'token field: Enter adds the value as a chip with its box, its named key and an announcement', JSON.stringify({ before: before.chips.length, ...added }));

  // A real paste through the system clipboard: Firefox empties the data of a synthetic one.
  const pasteInto = async (entrySelector, text) => {
    await tokenPage.evaluate((clipboardText) => {
      const clipboardSource = document.body.appendChild(document.createElement('textarea'));
      clipboardSource.id = 'vb-clip';
      clipboardSource.value = clipboardText;
    }, text);
    await tokenPage.focus('#vb-clip');
    await tokenPage.keyboard.press('ControlOrMeta+A');
    await tokenPage.keyboard.press('ControlOrMeta+C');
    await tokenPage.evaluate(() => document.getElementById('vb-clip').remove());
    await tokenPage.focus(entrySelector);
    await tokenPage.keyboard.press('ControlOrMeta+V');
    await waitForFrames();
  };

  await tokenPage.keyboard.type('10.10.0.0/16, 10.11.0.0/16 ');
  await waitForFrames();
  await pasteInto(entry, '172.16.0.0/12\n192.168.0.0/16\nnot-a-block');
  const many = await readState();
  const expectedValues = ['10.10.0.0/16', '10.11.0.0/16', '172.16.0.0/12', '192.168.0.0/16'];
  const addsEach = expectedValues.every((value) => many.chips.includes(value)) && many.chips.length === added.chips.length + 4 && many.entry === 'not-a-block';
  check(addsEach, 'token field: separators and a pasted list add each value; one that breaks the pattern stays in the entry', JSON.stringify(many));

  // Several values not added: a field with separators keeps them joined by its first separator,
  // so the next add splits them again; a field without keeps the first and names the rest.
  await tokenPage.fill(entry, '');
  await pasteInto(entry, 'bad-one\nbad-two\n10.13.0.0/16');
  const keptJoined = await readState();
  await pasteInto('#tk-scopes', 'peers:read\naudit:read\nbilling:read');
  const keptFirst = await tokenPage.$eval('#tk-scopes', (field) => ({
    entry: field.value,
    added: [...field.closest('.cb-tokens').querySelectorAll('.cb-chip > .cb-check')].some((box) => box.value === 'billing:read'),
    live: document.querySelector('[role="status"][data-cb-sr]')?.textContent ?? '',
  }));
  const joinsWithSeparator = keptJoined.entry === 'bad-one,bad-two' && keptJoined.chips.includes('10.13.0.0/16');
  const namesTheRest = keptFirst.entry === 'peers:read' && keptFirst.added && /Not added: "audit:read"/.test(keptFirst.live);
  check(joinsWithSeparator && namesTheRest, 'token field: values not added return joined by the first separator, or the first alone with the rest announced', JSON.stringify({ joined: keptJoined.entry, ...keptFirst }));
  const settled = await readState();

  await tokenPage.fill(entry, '10.8.0.0/24');
  await tokenPage.focus(entry);
  await tokenPage.keyboard.press('Enter');
  await waitForFrames();
  const twice = await readState();
  await tokenPage.fill(entry, '999.1/x');
  await tokenPage.keyboard.press('Enter');
  await waitForFrames();
  const bad = await readState();
  const invalid = await tokenPage.$eval(entry, (field) => !field.checkValidity());
  const refusesRepeat = twice.chips.length === settled.chips.length && twice.entry === '10.8.0.0/24' && /already in the list/.test(twice.live);
  const refusesInvalid = bad.chips.length === settled.chips.length && bad.entry === '999.1/x' && invalid;
  check(refusesRepeat && refusesInvalid, 'token field: a repeated value or one that breaks the pattern is not added and stays in the entry', JSON.stringify({ twice: twice.live, bad: bad.entry, invalid }));

  await tokenPage.fill(entry, '');
  await tokenPage.keyboard.press('Backspace');
  await waitForFrames();
  const onKey = await readState();
  await tokenPage.keyboard.press('Delete');
  await waitForFrames();
  const gone = await readState();
  await tokenPage.evaluate((entrySelector) => {
    document.querySelector(entrySelector).closest('.cb-tokens').querySelector('.cb-chip__remove').focus();
  }, entry);
  const firstChip = (await readState()).chips[0];
  await tokenPage.keyboard.press('Backspace');
  await waitForFrames();
  const next = await readState();
  const reachesKey = onKey.focus === onKey.chips.at(-1);
  const deleteRemoves = gone.chips.length === onKey.chips.length - 1 && gone.focus === 'entry' && /Removed/.test(gone.live);
  const backspaceRemoves = next.chips[0] !== firstChip && next.focus === next.chips[0];
  const keysDetail = JSON.stringify({ onKey: onKey.focus, gone: gone.focus, next: next.focus, first: firstChip });
  check(reachesKey && deleteRemoves && backspaceRemoves, 'token field: Backspace on an empty entry reaches the last key; Delete or Backspace on a key removes its chip, focus moves on', keysDetail);

  const clickedValue = (await readState()).chips[0];
  await tokenPage.locator(`${entry}`).locator('xpath=..').locator('.cb-chip__remove').first().click();
  await waitForFrames();
  const clicked = await readState();
  const clickRemoves = !clicked.chips.includes(clickedValue) && !clicked.sent.includes(clickedValue) && clicked.changes >= 4;
  check(clickRemoves, 'token field: a click on a key removes its chip, and the form no longer sends the value', JSON.stringify({ value: clickedValue, sent: clicked.sent, changes: clicked.changes }));

  await tokenPage.evaluate((entrySelector) => {
    const form = document.querySelector(entrySelector).form;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      form.dataset.vbSubmitter = event.submitter?.textContent.trim() ?? 'none';
    }, { once: true });
  }, entry);
  await tokenPage.fill(entry, '');
  await tokenPage.focus(entry);
  await tokenPage.keyboard.press('Enter');
  const submitter = await tokenPage.$eval(entry, (field) => field.form.dataset.vbSubmitter ?? 'no submit');
  check(submitter === 'Save', 'token field: Enter on an empty entry submits the host form with its own key', submitter);

  // Layout: one row high at each density, chips in the middle, the ring on the well.
  const wellProblems = [];
  for (const density of ['compact', 'default', 'comfortable']) {
    wellProblems.push(await tokenPage.evaluate(measureTokenWell, density));
  }
  await tokenPage.evaluate(() => document.documentElement.removeAttribute('data-cb-density'));
  await tokenPage.focus('#tk-scopes');
  await tokenPage.keyboard.press(run.shiftTabKey);
  await tokenPage.keyboard.press(run.tabKey);
  const ring = await tokenPage.$eval('#tk-scopes', (field) => {
    const wellStyle = getComputedStyle(field.closest('.cb-tokens'));
    return `${field.matches(':focus-visible')} well ${wellStyle.outlineStyle} ${wellStyle.outlineWidth}, entry ${getComputedStyle(field).outlineStyle}`;
  });
  const layoutDetail = `${wellProblems.filter(Boolean).join(' | ')} ${ring}`;
  check(!wellProblems.join('') && ring === 'true well solid 2px, entry none', 'token field: one row high at every density, chips centred, ring on the well', layoutDetail);

  // A form reset puts back the chips the page was served with: an added one goes, a removed one
  // returns, the entry empties, and the field keeps working afterwards.
  await tokenPage.reload();
  const readList = () => tokenPage.$eval(entry, (field) => ({
    chips: [...field.closest('.cb-tokens').querySelectorAll('.cb-chip > .cb-check')].map((box) => box.value).join(', '),
    sent: new FormData(field.form).getAll(field.name).filter(Boolean).join(', '),
    entry: field.value,
  }));
  const served = await readList();
  await tokenPage.focus(entry);
  await tokenPage.keyboard.type('10.9.0.0/24');
  await tokenPage.keyboard.press('Enter');
  await tokenPage.$eval(entry, (field) => field.closest('.cb-tokens').querySelector('.cb-chip__remove').click());
  await tokenPage.focus(entry);
  await tokenPage.keyboard.type('10.7');
  await waitForFrames();
  const edited = await readList();
  await tokenPage.$eval(entry, (field) => field.form.reset());
  await waitForFrames();
  const reset = await readList();
  await tokenPage.focus(entry);
  await tokenPage.keyboard.type('10.6.0.0/24');
  await tokenPage.keyboard.press('Enter');
  await waitForFrames();
  const after = await readList();
  const wasEdited = edited.sent !== served.sent && edited.entry === '10.7';
  const restores = reset.chips === served.chips && reset.sent === served.sent && reset.entry === '';
  const stillAdds = after.chips === `${served.chips}, 10.6.0.0/24`;
  check(wasEdited && restores && stillAdds, 'token field: a form reset restores the served chips and values, and the field still adds afterwards', JSON.stringify({ served, edited, reset, after }));
}

// Without JavaScript: the keys are hidden, the boxes carry the values and unticking one drops it,
// and the field holds no submit button.
async function checkTokenFieldWithoutScript(run) {
  const noScriptContext = await run.browser.newContext({ ...run.contextOptions, javaScriptEnabled: false });
  const noScriptPage = await run.openPage({ browserContext: noScriptContext });
  const plain = await noScriptPage.evaluate(() => {
    const wells = [...document.querySelectorAll('[data-cb-tokens]')];
    const allIn = (selector) => wells.flatMap((well) => [...well.querySelectorAll(selector)]);
    // The first field with a value that can be dropped: an enabled, checked box in a form.
    const box = allIn('.cb-chip > .cb-check:checked:enabled').find((candidate) => candidate.form);
    const readSent = () => (box ? new FormData(box.form).getAll(box.name) : []);
    const sentBefore = readSent();
    if (box) {
      box.checked = false;
    }
    const sentAfter = readSent();
    return {
      wells: wells.length,
      keys: allIn('.cb-chip__remove').filter((key) => getComputedStyle(key).display !== 'none').length,
      boxes: allIn('.cb-chip > .cb-check').filter((chipBox) => getComputedStyle(chipBox).display === 'none').length,
      submits: allIn('button:not([type="button"]), input[type="submit"]').length,
      dropped: box ? sentBefore.includes(box.value) && !sentAfter.includes(box.value) : false,
      struck: box ? getComputedStyle(box.closest('.cb-chip')).textDecorationLine : '',
    };
  });
  const ok = plain.wells > 0 && plain.keys === 0 && plain.boxes === 0 && plain.submits === 0 && plain.dropped && plain.struck === 'line-through';
  run.check(ok, 'token field without JavaScript: keys hidden, boxes carry the values, unticking drops one, no submit keys', JSON.stringify(plain));
  await noScriptContext.close();
}

// 36c. Token field (data-cb-tokens), on fresh pages. With the script: Enter adds a value as a chip
//     (box value, key name, announcement, change event, focus kept, entry cleared); separators from
//     the attribute and a pasted list (through the system clipboard) add several; a value that
//     breaks the pattern or repeats one stays in the entry; Backspace on an empty entry reaches the
//     last key, Delete or Backspace on a key removes its chip and focus moves on; a click on a key
//     removes its chip and the form no longer sends the value; Enter on an empty entry submits the
//     host form. Without it: the keys are hidden, the boxes carry the values and unticking one
//     drops it, and the field holds no submit button. The well is one --cb-row-h-sm row plus its
//     padding at every density, its chips sit in the middle, and the ring is on the well while the
//     entry has focus. The behaviour checks drive the catalogue's fields (#tk-ips, #tk-scopes);
//     any other page with a token field (the example) gets the check without the script.
async function checkTokenFields(run) {
  if (!run.wants('tokens')) {
    return;
  }
  const isCatalogue = await run.page.locator('#accessibility').count();
  if (!isCatalogue && !await run.page.locator('.cb-tokens').count()) {
    return;
  }
  const tokenPage = await run.openPage();
  if (isCatalogue) {
    run.check(await tokenPage.locator(TOKEN_ENTRY).count() > 0, 'token field: the catalogue shows one', 'missing #tk-ips');
  }
  if (await tokenPage.locator(TOKEN_ENTRY).count()) {
    await checkTokenFieldBehaviour(run, tokenPage);
  }
  await tokenPage.close();

  await checkTokenFieldWithoutScript(run);
}

// 37. The example console's refresh (host code standing in for the server): Enter on Refresh
//     makes the key and the peer table's body busy (the key stays focusable but inert), then
//     clears both, keeps focus on the key, and drops a confirmation into the toast stack, whose
//     close key hides it.
async function checkExampleRefresh(run) {
  if (!run.wants('example') || !await run.page.locator('body > .cb-app [data-cb-tabs]').count()) {
    return;
  }
  const examplePage = await run.openPage();
  const hasRefresh = await examplePage.locator('#x-refresh').count();
  if (!hasRefresh) {
    run.check(false, 'example: the Peers tab has a Refresh key', 'missing #x-refresh');
  } else {
    await examplePage.click('#x-tab-peers');
    await examplePage.focus('#x-refresh');
    await examplePage.keyboard.press('Enter');
    const readState = () => examplePage.evaluate(() => {
      const key = document.getElementById('x-refresh');
      const body = document.querySelector('#x-peer-table > tbody');
      return {
        key: key.getAttribute('aria-busy'),
        inert: key.getAttribute('aria-disabled'),
        rows: body.getAttribute('aria-busy'),
        hatch: getComputedStyle(body.querySelector('td')).backgroundImage.startsWith('repeating'),
        focus: document.activeElement === key,
        toasts: document.querySelectorAll('#x-toasts > .cb-alert').length,
      };
    });
    const busy = await readState();
    await examplePage.waitForFunction(() => !document.getElementById('x-refresh').hasAttribute('aria-busy'), null, { timeout: 5000 });
    const done = await readState();
    const toast = await examplePage.evaluate(() => {
      const lastToast = document.querySelector('#x-toasts > .cb-alert:last-child');
      if (!lastToast) {
        return null;
      }
      return { ok: lastToast.matches('.cb-alert--sm.cb-alert--ok'), text: lastToast.textContent, close: !!lastToast.querySelector('[data-cb-dismiss]') };
    });
    await examplePage.click('#x-toasts > .cb-alert:last-child [data-cb-dismiss]');
    const hidden = await examplePage.evaluate(() => document.querySelector('#x-toasts > .cb-alert:last-child').hidden);
    const wasBusy = busy.key === 'true' && busy.inert === 'true' && busy.rows === 'true' && busy.hatch && busy.focus;
    const isDone = done.key === null && done.inert === null && done.rows === null && done.focus && done.toasts === busy.toasts + 1;
    const toastCloses = toast?.ok && /refreshed/.test(toast.text) && toast.close && hidden;
    run.check(wasBusy && isDone && toastCloses, 'example: Refresh shows a busy table, then a confirmation toast that closes', JSON.stringify({ busy, done, toast, hidden }));
  }
  await examplePage.close();
}

// 38. The example's directory filter (host code): typing keeps the matching tree items and their
//     ancestors, opened, and hides the rest, with the tree's one Tab stop on a shown item; a
//     query that matches nothing gives way to an empty state (role="status") that names it, and
//     its Clear filter key restores every item and its open state and returns focus to the field.
async function checkExampleTreeFilter(run) {
  if (!run.wants('example') || !await run.page.locator('body > .cb-app [data-cb-tree]').count()) {
    return;
  }
  const treePage = await run.openPage({ viewport: DESKTOP_VIEWPORT });
  if (!await treePage.locator('#x-tree-filter').count()) {
    run.check(false, 'example: the directory tree has a filter', 'missing #x-tree-filter');
  } else {
    const readState = () => treePage.evaluate(() => {
      const tree = document.querySelector('#x-side [role="tree"]');
      const empty = document.getElementById('x-tree-empty');
      const items = [...tree.querySelectorAll('[role="treeitem"]')];
      const nameOf = (item) => item.querySelector(':scope > .cb-nav__link').lastChild.textContent.trim();
      const tabStops = items.filter((item) => item.tabIndex === 0);
      return {
        shown: items.filter((item) => item.getClientRects().length).map(nameOf),
        open: items.filter((item) => item.getAttribute('aria-expanded') === 'true').map(nameOf),
        stop: tabStops.length === 1 && tabStops[0].getClientRects().length > 0,
        tree: tree.getClientRects().length > 0,
        empty: empty.getClientRects().length > 0 ? empty.textContent.replace(/\s+/g, ' ').trim() : '',
        role: empty.getAttribute('role'),
        field: document.getElementById('x-tree-filter').value,
        focus: document.activeElement.id,
      };
    });
    const start = await readState();
    await treePage.focus('#x-tree-filter');
    await treePage.keyboard.type('alice');
    const match = await readState();
    await treePage.fill('#x-tree-filter', '');
    await treePage.keyboard.type('contr');
    const none = await readState();
    await treePage.click('#x-tree-empty button');
    const cleared = await readState();
    const keepsMatches = match.shown.join() === 'corp.example.net,Staff,Alice Ng' && match.open.includes('Staff') && match.stop;
    const showsEmpty = !none.tree && /No objects match “contr”/.test(none.empty) && none.role === 'status';
    const restores = cleared.tree && !cleared.empty && cleared.shown.join() === start.shown.join() && cleared.open.join() === start.open.join()
      && cleared.field === '' && cleared.focus === 'x-tree-filter' && cleared.stop;
    const name = 'example: the directory filter keeps matches and their ancestors, shows an empty state when nothing matches, and Clear filter restores the tree';
    run.check(keepsMatches && showsEmpty && restores, name, JSON.stringify({ start: start.shown, match, none, cleared }));
  }
  await treePage.close();
}

// The tokens built from palette tokens, and the property that shows each on a probe.
const DERIVED_TOKEN_PROBES = [
  ['--cb-focus-ring', 'outline'],
  ['--cb-shadow-outset', 'boxShadow'],
  ['--cb-shadow-outset-dark', 'boxShadow'],
  ['--cb-shadow-inset', 'boxShadow'],
  ['--cb-shadow-pressed', 'boxShadow'],
  ['--cb-shadow-float', 'boxShadow'],
  ['--cb-grad-surface', 'backgroundImage'],
  ['--cb-grad-btn', 'backgroundImage'],
  ['--cb-bg-backdrop', 'backgroundColor'],
];

// In-page: each derived token as the page resolves it and as a [data-cb-theme] subtree with its own
// test palette resolves it, plus the subtree's focus ring colour.
function measureThemedSubtree(tokenProbes) {
  const subtree = document.body.appendChild(document.createElement('div'));
  subtree.dataset.cbTheme = 'vb-probe';
  subtree.style.setProperty('--cb-accent', 'rgb(255, 0, 0)');
  subtree.style.setProperty('--cb-text-main', 'rgb(0, 128, 0)');
  subtree.style.setProperty('--cb-border-strong', 'rgb(0, 0, 255)');
  const resolveIn = (container, token, property) => {
    const probe = container.appendChild(document.createElement('i'));
    probe.style[property] = `var(${token})`;
    const value = getComputedStyle(probe)[property === 'outline' ? 'outlineColor' : property];
    probe.remove();
    return value;
  };
  const tokens = tokenProbes.map(([token, property]) => ({
    token,
    page: resolveIn(document.body, token, property),
    themed: resolveIn(subtree, token, property),
  }));
  const ring = resolveIn(subtree, '--cb-focus-ring', 'outline');
  subtree.remove();
  return { tokens, ring };
}

// In-page: the palette of the page and of a subtree for each named theme, as [r, g, b] per token.
function measureThemePalettes([themeNames, paletteTokens]) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  const paletteIn = (container) => {
    const probe = container.appendChild(document.createElement('i'));
    const palette = {};
    for (const token of paletteTokens) {
      probe.style.color = `var(${token})`;
      canvasContext.clearRect(0, 0, 1, 1);
      canvasContext.fillStyle = getComputedStyle(probe).color;
      canvasContext.fillRect(0, 0, 1, 1);
      const pixel = canvasContext.getImageData(0, 0, 1, 1).data;
      palette[token] = [pixel[0], pixel[1], pixel[2]];
    }
    probe.remove();
    return palette;
  };
  const themes = {};
  for (const themeName of themeNames) {
    const subtree = document.body.appendChild(document.createElement('div'));
    subtree.dataset.cbTheme = themeName;
    themes[themeName] = paletteIn(subtree);
    subtree.remove();
  }
  return { page: paletteIn(document.body), themes };
}

// The layer pairs and status-tone pairs of one palette that are closer than their minimum.
function findCloseColours(palette) {
  const close = [];
  for (const [first, second] of LAYER_PAIRS) {
    const distance = colourDistance(palette[first], palette[second]);
    if (distance < LAYER_MIN_DISTANCE) {
      close.push(`${first}/${second} ${distance.toFixed(1)}`);
    }
  }
  STATUS_TONES_FOR_LAMPS.forEach((first, i) => {
    for (const second of STATUS_TONES_FOR_LAMPS.slice(i + 1)) {
      const distance = colourDistance(palette[first], palette[second]);
      if (distance < LAMP_MIN_DISTANCE) {
        close.push(`${first}/${second} ${distance.toFixed(1)}`);
      }
    }
  });
  return close;
}

// 0. The command line took effect: the --css and --js files were served in place of the shipped
//    ones, and under --theme the page carries the theme on <html>. Without this a run could pass
//    on the wrong files (Firefox never routed file:// requests, so --css once tested nothing).
async function checkOverridesServed(run, options) {
  const wanted = [];
  if (options.cssOverride) {
    wanted.push(['css', relative(REPOSITORY_ROOT, options.cssOverride)]);
  }
  if (options.jsOverride) {
    wanted.push(['js', relative(REPOSITORY_ROOT, options.jsOverride)]);
  }
  if (options.theme) {
    wanted.push(['theme', `data-cb-theme="${options.theme}"`]);
  }
  if (!wanted.length) {
    return;
  }
  const pageTheme = await run.page.evaluate(() => document.documentElement.dataset.cbTheme ?? '');
  const missed = wanted.filter(([kind]) => !run.served[kind] || (kind === 'theme' && pageTheme !== options.theme));
  const detail = wanted.map(([kind, what]) => `${what} ${run.served[kind]}x`).join(', ');
  run.check(!missed.length, 'command-line overrides were served (--css, --js, --theme)', detail);
}

// In-page: the catalogue's theme tiles: whether they show, their tops (rows), the theme each
// window paints (its canvas against a probe of each theme), the checked tile, the page theme and
// the top-bar name, and the focus ring of the focused radio.
function readThemeTiles() {
  const group = document.querySelector('.docs-themes');
  const tiles = group ? [...group.querySelectorAll('.docs-theme')] : [];
  const canvasOf = (themeName) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.dataset.cbTheme = themeName;
    probe.style.backgroundColor = 'var(--cb-bg-canvas)';
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  };
  const windows = tiles.map((tile) => {
    const radio = tile.querySelector('input[type="radio"]');
    const windowElement = tile.querySelector('.docs-theme__window');
    return {
      value: radio?.value ?? '',
      paintsOwnTheme: Boolean(windowElement) && getComputedStyle(windowElement).backgroundColor === canvasOf(radio?.value ?? ''),
    };
  });
  const focusedRadio = document.activeElement?.closest('.docs-theme') ? document.activeElement : null;
  return {
    shown: Boolean(group) && !group.hidden && group.getClientRects().length > 0,
    tops: tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)),
    windows,
    checked: group?.querySelector('input:checked')?.value ?? '',
    pageTheme: document.documentElement.dataset.cbTheme ?? '',
    topBarName: document.querySelector('.docs-topbar__theme')?.textContent.trim() ?? '',
    topBarTarget: document.querySelector('.docs-topbar__theme')?.getAttribute('href') ?? '',
    ring: focusedRadio ? getComputedStyle(focusedRadio).outlineStyle : 'no focused tile',
  };
}

// Part of 39b: arrow keys on the tiles, a reload, and back to the default.
async function checkThemeTilePicking(run, tilesPage) {
  // Reach the group by keyboard (Tab out, Shift+Tab back to the checked radio): WebKit shows
  // :focus-visible only for keyboard focus, and drops it again once an arrow key picks a radio
  // (any radio group, an engine behaviour), so the ring is read before the arrow.
  await tilesPage.focus('.docs-themes input:checked');
  await tilesPage.keyboard.press(run.tabKey);
  await tilesPage.keyboard.press(run.shiftTabKey);
  const { ring } = await tilesPage.evaluate(readThemeTiles);
  await tilesPage.keyboard.press('ArrowRight');
  const picked = await tilesPage.evaluate(readThemeTiles);
  await tilesPage.reload();
  const reloaded = await tilesPage.evaluate(readThemeTiles);
  await tilesPage.focus('.docs-themes input:checked');
  await tilesPage.keyboard.press('ArrowLeft');
  const back = await tilesPage.evaluate(readThemeTiles);
  await tilesPage.close();
  const picksSteel = ring === 'solid' && picked.checked === 'steel' && picked.pageTheme === 'steel' && picked.topBarName === 'Theme: Steel';
  const keeps = reloaded.checked === 'steel' && reloaded.pageTheme === 'steel' && reloaded.topBarName === 'Theme: Steel';
  const backToDefault = back.checked === 'glacier' && back.pageTheme === '' && back.topBarName === 'Theme: Glacier';
  const pickDetail = JSON.stringify({ ring, picked, reloaded: [reloaded.checked, reloaded.pageTheme], back: [back.checked, back.pageTheme, back.topBarName] });
  run.check(picksSteel && keeps && backToDefault, 'theme tiles: arrow keys pick the page theme and the top-bar name, ring on the radio; a reload keeps it; glacier removes the attribute', pickDetail);
}

// 39b. The catalogue's theme tiles (docs only): four tiles in one row at 1360px and two rows at
//      360px, each window painted by its own theme; arrow keys pick a theme for the whole page
//      and the top bar, with the ring on the focused radio; a reload keeps the choice; glacier
//      removes the attribute; without script the tiles stay hidden.
async function checkThemeTiles(run) {
  if (!run.wants('themes') || !await run.page.locator('#tokens-themes').count() || run.theme) {
    return;
  }
  const tilesPage = await run.openPage({ viewport: DESKTOP_VIEWPORT });
  const wide = await tilesPage.evaluate(readThemeTiles);
  await tilesPage.setViewportSize({ width: 360, height: 900 });
  const narrow = await tilesPage.evaluate(readThemeTiles);
  await tilesPage.setViewportSize(DESKTOP_VIEWPORT);
  const oneRow = wide.tops.length === THEME_NAMES.length && new Set(wide.tops).size === 1;
  const twoRows = new Set(narrow.tops).size === 2;
  const ownThemes = wide.windows.length === THEME_NAMES.length && wide.windows.every((tile) => tile.paintsOwnTheme);
  const layoutDetail = JSON.stringify({ shown: wide.shown, wide: wide.tops, narrow: narrow.tops, windows: wide.windows });
  run.check(wide.shown && oneRow && twoRows && ownThemes, 'theme tiles: four in a row at 1360px, two rows at 360px, each window in its own theme', layoutDetail);

  if (!wide.shown) {
    await tilesPage.close();
    run.check(false, 'theme tiles: arrow keys pick the page theme and the top-bar name, ring on the radio; a reload keeps it; glacier removes the attribute', 'no tiles shown');
  } else {
    await checkThemeTilePicking(run, tilesPage);
  }

  const noScriptContext = await run.browser.newContext({ ...run.contextOptions, javaScriptEnabled: false });
  const noScriptPage = await run.openPage({ browserContext: noScriptContext });
  const withoutScript = await noScriptPage.evaluate(readThemeTiles);
  await noScriptContext.close();
  const hiddenWithoutScript = !withoutScript.shown && withoutScript.topBarTarget === '#tokens-themes';
  run.check(hiddenWithoutScript, 'theme tiles: hidden without script; the top-bar link still leads to the themes', JSON.stringify({ shown: withoutScript.shown, target: withoutScript.topBarTarget }));
}

// In-page: the theme on <html> and whether the page canvas paints that theme's canvas.
function readPageTheme() {
  const theme = document.documentElement.dataset.cbTheme ?? '';
  const probe = document.body.appendChild(document.createElement('i'));
  probe.dataset.cbTheme = theme || 'glacier';
  probe.style.backgroundColor = 'var(--cb-bg-canvas)';
  const expected = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return { theme, paints: getComputedStyle(document.body).backgroundColor === expected };
}

// 39c. The example console (a page whose body holds a .cb-app) follows the theme picked in the
//      catalogue: a stored theme is on <html> after a reload, and the stored default leaves none.
async function checkExampleFollowsTheme(run) {
  const isExample = await run.page.locator('body > .cb-app').count() && !await run.page.locator('#tokens-themes').count();
  if (!run.wants('themes') || !isExample || run.theme) {
    return;
  }
  const examplePage = await run.openPage();
  const storeAndReload = async (theme) => {
    await examplePage.evaluate((name) => localStorage.setItem('cubicle-docs-theme', name), theme);
    await examplePage.reload();
    return examplePage.evaluate(readPageTheme);
  };
  const industrial = await storeAndReload('industrial');
  const glacier = await storeAndReload('glacier');
  await examplePage.evaluate(() => localStorage.removeItem('cubicle-docs-theme'));
  await examplePage.close();
  const follows = industrial.theme === 'industrial' && industrial.paints && glacier.theme === '' && glacier.paints;
  run.check(follows, 'example: follows the theme stored by the catalogue (industrial applied, glacier as served)', JSON.stringify({ industrial, glacier }));
}

// 39. Themes. Inside a [data-cb-theme] subtree, every token built from the palette (focus ring,
//     shadows, gradients, backdrop) follows the subtree's palette instead of the page's: the ring
//     takes the subtree accent and each shade differs from the page's. Each named theme exists:
//     steel paints as the default page, the other three differ from it and from each other; and
//     in every theme the surface layers and the status tones stay apart.
async function checkThemes(run) {
  if (!run.wants('themes')) {
    return;
  }
  const palettes = await run.page.evaluate(measureThemePalettes, [THEME_NAMES, PALETTE_TOKENS]);
  const signatureOf = (palette) => JSON.stringify(PALETTE_TOKENS.map((token) => palette[token]));
  // Under --theme the page must paint as that theme; otherwise as the default one.
  const expectedTheme = run.theme ?? DEFAULT_THEME;
  const expectedPalette = palettes.themes[expectedTheme];
  const pageMatches = Boolean(expectedPalette) && signatureOf(expectedPalette) === signatureOf(palettes.page);
  const signatures = THEME_NAMES.map((themeName) => signatureOf(palettes.themes[themeName]));
  const allDistinct = new Set(signatures).size === THEME_NAMES.length;
  const namedDetail = `page as ${expectedTheme}: ${pageMatches}, ${new Set(signatures).size} distinct palettes of ${THEME_NAMES.length}`;
  run.check(pageMatches && allDistinct, `themes: the page paints as ${expectedTheme}, and the ${THEME_NAMES.length} named themes are distinct palettes`, namedDetail);

  const closeColours = [];
  for (const themeName of THEME_NAMES) {
    for (const problem of findCloseColours(palettes.themes[themeName])) {
      closeColours.push(`${themeName}: ${problem}`);
    }
  }
  run.check(!closeColours.length, 'themes: in every theme the surface layers and the status lamps stay apart', closeColours.slice(0, 4).join(' | '));

  const subtree = await run.page.evaluate(measureThemedSubtree, DERIVED_TOKEN_PROBES);
  const unchanged = subtree.tokens.filter((entry) => entry.themed === entry.page).map((entry) => entry.token);
  const ringFollows = subtree.ring === 'rgb(255, 0, 0)';
  const detail = `ring ${subtree.ring}${unchanged.length ? `; as on the page: ${unchanged.join(', ')}` : ''}`;
  run.check(ringFollows && !unchanged.length, 'themes: tokens derived from the palette follow a [data-cb-theme] subtree', detail);
}

// =====================================================================================
// Main
// =====================================================================================

async function runChecks() {
  const options = parseArguments(process.argv);
  if (!ENGINES[options.engine]) {
    console.error(`unknown --browser ${options.engine}; use chromium, firefox or webkit`);
    process.exit(2);
  }
  if (options.shotsArgument !== 'none') {
    mkdirSync(resolve(REPOSITORY_ROOT, options.shotsArgument), { recursive: true });
  }
  if (options.theme !== null && !THEME_NAME_PATTERN.test(options.theme)) {
    console.error(`--theme takes a theme name such as ${THEME_NAMES.join(', ')}`);
    process.exit(2);
  }
  const onlyIsInvalid = options.only && (!options.only.length || options.only.some((group) => !GROUPS.includes(group)));
  if (onlyIsInvalid) {
    console.error(`unknown --only group in "${options.only.join(',')}"; use ${GROUPS.join(', ')}`);
    process.exit(2);
  }

  const run = await createRun(options);
  const consoleProblems = [];
  run.page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleProblems.push(message.text());
    }
  });
  run.page.on('pageerror', (error) => consoleProblems.push(error.message));
  await run.page.goto(run.pageUrl);

  // The groups run in this order on one page; later checks start from the state earlier ones
  // leave (scroll position, viewport width, opened panels).
  checkConsole(run, consoleProblems);
  await checkOverridesServed(run, options);
  await checkLayout(run);
  await checkHiddenTextInScrollers(run);
  await checkControls(run);
  const measuredPairs = await checkContrastPairs(run);
  await checkControlStates(run);
  await checkAccessibleNames(run);
  await checkScriptBehaviour(run);
  await checkBadges(run);
  await checkTables(run);
  await checkTableNames(run);
  await checkAlerts(run);
  await checkTabs(run);
  await checkDisabledTab(run);
  await checkNavigation(run);
  await checkDisabledNavLink(run);
  await checkMeters(run);
  await checkSegmented(run);
  await checkDetails(run);
  await checkDialogs(run);
  await checkPagination(run);
  await checkUtilities(run);
  await checkApplicationFrame(run);
  await checkDensity(run);
  await checkKeyboardAudit(run);
  await checkContrastTable(run, measuredPairs);
  await checkSnippets(run);
  await checkNativeForms(run);
  await checkPropertyLists(run);
  await checkBusyContainers(run);
  await checkEmptyStates(run);
  await checkToasts(run);
  await checkMenus(run);
  await checkLogs(run);
  await checkSplit(run);
  await checkForcedColours(run);
  await checkRightToLeft(run);
  await checkCentre(run);
  await checkRecipes(run);
  await checkConsoleRecipes(run);
  await checkPrint(run);
  await checkTargetSize(run);
  await checkTokenFields(run);
  await checkThemes(run);
  await checkThemeTiles(run);
  await checkExampleFollowsTheme(run);
  await checkExampleRefresh(run);
  await checkExampleTreeFilter(run);

  await run.browser.close();
  run.server.close();

  const { results, engine } = run;
  const failedCount = results.filter((result) => !result.ok).length;
  const skippedCount = results.filter((result) => result.skip).length;
  const skippedNote = skippedCount ? ` (${skippedCount} skipped as engine limits)` : '';
  const onlyNote = run.only ? ` (only ${run.only.join(', ')})` : '';
  const themeNote = run.theme ? ` (theme ${run.theme})` : '';
  const shotsNote = run.saving ? `${relative(REPOSITORY_ROOT, run.shotsDirectory)}/` : 'none';
  const passedCount = results.length - failedCount;
  let report = '';
  for (const result of results) {
    report += `${formatResult(result, engine)}\n`;
  }
  report += `\n${engine} ${run.engineVersion}: ${passedCount}/${results.length} checks passed${skippedNote}${onlyNote}${themeNote}. Screenshots: ${shotsNote}\n`;
  // The whole report is written here, in one burst. process.exit() would drop what a pipe (the
  // matrix reads this through one) has not taken yet, so wait until the write has completed.
  await new Promise((resolveWrite) => process.stdout.write(report, resolveWrite));
  process.exit(failedCount > 0 ? 1 : 0);
}

await runChecks();
