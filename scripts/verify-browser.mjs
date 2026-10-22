// Cubicle browser verification. Development tool only; not part of the shipped kit.
//
// Setup (once):   cd scripts && npm install && npx playwright install chromium firefox webkit
// Run:            node scripts/verify-browser.mjs [docs/index.html] [--browser chromium|firefox|webkit]
//                                                 [--css dist/cubicle.min.css] [--js dist/cubicle.min.js]
//                                                 [--only forms,keyboard] [--shots tmp/shots/x]
//                 --browser picks the engine (chromium by default).
//                 --only runs the named groups of checks (GROUPS below) plus the console check,
//                 for quick runs while working on one part; the full run is the verdict.
//                 --shots writes the screenshots to another directory (tmp/shots by default),
//                 so runs can go side by side (scripts/verify-matrix.mjs does that); --shots none
//                 saves none, for quick runs.
//                 --css / --js serve the given file in place of dist/cubicle.css / dist/cubicle.js
//                 (to check the minified build).
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
//                 The targets group measures WCAG 2.5.8 target size at default and comfortable density
//                 and checks the catalogue's target-size table at all three densities.
//                 Contrast pairs live in scripts/contrast-pairs.mjs, shared with the catalogue table.
// Exit code:      0 when every check passes, 1 otherwise.

import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { measurePairs, ratio, label } from './contrast-pairs.mjs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cssFlag = args.indexOf('--css');
const css_override = cssFlag >= 0 ? resolve(root, args.splice(cssFlag, 2)[1] ?? '') : null;
const jsFlag = args.indexOf('--js');
const js_override = jsFlag >= 0 ? resolve(root, args.splice(jsFlag, 2)[1] ?? '') : null;
const engineFlag = args.indexOf('--browser');
const engine = engineFlag >= 0 ? args.splice(engineFlag, 2)[1] : 'chromium';
const engines = { chromium, firefox, webkit };
if (!engines[engine]) { console.error(`unknown --browser ${engine}; use chromium, firefox or webkit`); process.exit(2); }
const shotsFlag = args.indexOf('--shots');
const shotsArg = shotsFlag >= 0 ? args.splice(shotsFlag, 2)[1] ?? '' : 'tmp/shots';
// --shots none saves no screenshot (pixel checks still take theirs in memory) and skips the
// width changes made only for them, keeping the last width, which later checks start from.
const saving = shotsArg !== 'none';
const shots = saving ? resolve(root, shotsArg) : null;
if (saving) mkdirSync(shots, { recursive: true });
// caret: 'initial' skips the caret-hiding style Playwright injects, a full restyle of the page per shot.
const snap = (target, name, options = {}) => (saving ? target.screenshot({ caret: 'initial', ...options, path: resolve(shots, name) }) : Promise.resolve());
const GROUPS = ['layout', 'controls', 'contrast', 'states', 'script', 'badges', 'tables', 'alerts', 'tabs', 'nav', 'meters',
  'segmented', 'details', 'dialogs', 'pagination', 'utilities', 'frame', 'density', 'keyboard', 'snippets', 'forms', 'props', 'busy', 'empty', 'toasts', 'menu', 'log', 'split', 'forced', 'rtl', 'recipes', 'print', 'targets', 'example'];
const onlyFlag = args.indexOf('--only');
const only = onlyFlag >= 0 ? (args.splice(onlyFlag, 2)[1] ?? '').split(',').filter(Boolean) : null;
if (only && (!only.length || only.some((g) => !GROUPS.includes(g)))) {
  console.error(`unknown --only group in "${only.join(',')}"; use ${GROUPS.join(', ')}`); process.exit(2);
}
const want = (group) => !only || only.includes(group);
const page_path = resolve(root, args[0] ?? 'docs/index.html');

// Differences that come from an engine or from automation, not from the stylesheet. A failing
// check whose name matches one of these, in that engine, is reported as "skip" with the reason.
// WebKit, like Safari, moves Tab between form controls only; Option+Tab reaches every control.
const TAB = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
const SHIFT_TAB = engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab';
// Reading the clipboard from automation is refused in WebKit; null means "could not read".
const readClipboard = (pg) => pg.evaluate(() => navigator.clipboard.readText()).catch(() => null);
// A control inside an idle ARIA tab panel, a closed <details> or a closed popover menu (as on the
// example screen) is shown first: its tab is clicked, its details and its menu opened.
const expose = (pg, selector) => pg.evaluate((sel) => {
  const el = document.querySelector(sel);
  for (let n = el; n; n = n.parentElement) {
    if (n.matches('[role="tabpanel"][hidden]')) document.querySelector(`[role="tab"][aria-controls="${n.id}"]`)?.click();
    if (n.matches('details:not([open])')) n.open = true;
  }
  // A popover (a row's action menu) opens once its tab panel shows.
  el.closest('[popover]:not(:popover-open)')?.showPopover();
}, selector);

// Date and time fields: Tab walks their segments, and WebKit never matches :focus-visible on them
// (the stylesheet draws the same ring on :focus there), so focus checks accept :focus.
const SEGMENTED = 'input:is([type="date"], [type="time"], [type="datetime-local"], [type="month"], [type="week"])';

const ENGINE_LIMITS = [
  { engine: 'firefox', check: /^meter ruler:/, reason: 'Firefox paints the meter track on the element itself, so there is no ruler strip for ticks and marks' },
  { engine: 'webkit', check: /reaches the clipboard|falls back when the async clipboard/, reason: 'WebKit refuses clipboard reads from automation, so the copied text cannot be compared' },
  { engine: 'webkit', check: /^selected options in a multi-select/, reason: 'WebKit paints list-box selection natively and ignores option backgrounds' },
  { engine: 'webkit', check: /^Escape clears a search field/, reason: 'WebKit does not clear a search field on Escape' },
  { engine: 'webkit', check: /^states of input\.cb-input\[type=color\]/, reason: 'WebKit leaves colour fields out of the Tab order, even with Option+Tab' },
  { engine: 'firefox', check: /^states of input\.cb-input\[type=(date|time|datetime-local)\]\[readonly\]/, reason: 'Firefox does not let a readonly date or time field take focus' },
  { engine: 'firefox', check: /^forced colours: selected list-box options/, reason: 'Firefox paints list-box selection itself in forced colours (a light grey), not option backgrounds' },
  { engine: 'webkit', check: /^forced colours: selected list-box options/, reason: 'WebKit paints list-box selection natively and ignores option backgrounds' },
];

const results = [];
const check = (ok, name, detail = '') => {
  const limit = !ok && ENGINE_LIMITS.find((l) => l.engine === engine && l.check.test(name));
  results.push(limit ? { ok: true, skip: limit.reason, name, detail } : { ok, name, detail });
};

// Firefox on macOS skips links on Tab unless "full keyboard access" is on; keyboard users turn it
// on, and the audit must walk the same path, so the preference is set here.
const browser = await engines[engine].launch(engine === 'firefox' ? { firefoxUserPrefs: { 'accessibility.tabfocus': 7 } } : {});
const engineVersion = browser.version();
const contextOptions = { colorScheme: 'light', viewport: { width: 1360, height: 900 } };
// Playwright grants clipboard permissions in Chromium only.
const context = await browser.newContext({ ...contextOptions, acceptDownloads: true,
  ...(engine === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
const page = await context.newPage();

const applyOverrides = async (p) => {
  if (css_override) await p.route(/\/dist\/cubicle\.css$/, (route) => route.fulfill({ path: css_override, contentType: 'text/css' }));
  if (js_override) await p.route(/\/dist\/cubicle\.js$/, (route) => route.fulfill({ path: js_override, contentType: 'text/javascript' }));
};

const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));
await applyOverrides(page);
await page.goto(pathToFileURL(page_path).href);

// Screenshots of one catalogue section, found by its id (a :has() lookup takes the first section
// whose demos contain a class, which later demos in other sections can steal).
const sectionShots = async (id) => {
  const section = page.locator(`#${id}`);
  if (!await section.count()) { check(false, `section #${id} exists for its screenshots`); return; }
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `${id}-${width}.png`);
  }
};

// 1. No console errors
check(problems.length === 0, 'no console errors or warnings', problems.join(' | '));

// 2. No horizontal overflow at three widths
if (want('layout')) {
  const unreachable = new Set();
  for (const width of [360, 800, 1360]) {
    await page.setViewportSize({ width, height: 900 });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(sw <= 0, `no horizontal overflow at ${width}px`, sw > 0 ? `${sw}px too wide` : '');
    // A catalogue demo scrolls sideways when its content is too wide, which hides the fault from
    // the page check above: a demo must wrap (.cb-break) or scroll in its own wrapper (.cb-table-wrap).
    if (width === 360 && await page.locator('.docs-demo').count()) {
      const wide = await page.$$eval('.docs-demo', (demos) => demos.flatMap((d) => {
        const edge = d.getBoundingClientRect().right + 1;
        const own = (el) => { for (let n = el.parentElement; n !== d; n = n.parentElement) if (/auto|scroll|hidden|clip/.test(getComputedStyle(n).overflowX)) return false; return true; };
        return [...d.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > edge && el.parentElement.getBoundingClientRect().right <= edge && own(el))
          .map((el) => `#${d.closest('[id]')?.id} ${el.localName}.${[...el.classList].join('.')} +${Math.round(el.getBoundingClientRect().right - edge)}px`);
      }));
      check(!wide.length, 'at 360px no demo content runs past its frame outside a scroll wrapper', wide.join('; '));
    }
    // A box that scrolls must be reachable from the keyboard, or WebKit (Safari, which never focuses
    // a scroll box itself) cannot scroll it: a native field, a box that holds a control, or a box
    // with tabindex plus a role and a name (catalogue, Accessibility > Focus).
    const boxes = await page.evaluate(() => [...document.querySelectorAll(document.querySelector('.docs-demo') ? '.docs-demo *' : 'body *')].filter((el) => {
      const o = getComputedStyle(el);
      if (!el.getClientRects().length || !(/auto|scroll/.test(o.overflowX) && el.scrollWidth > el.clientWidth + 1 || /auto|scroll/.test(o.overflowY) && el.scrollHeight > el.clientHeight + 1)) return false;
      if (el.matches('textarea, select') || el.querySelector('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')) return false;
      // A name on a generic box (div, pre, span) needs a role to count; a list or a table has one.
      const role = el.getAttribute('role') || !el.matches('div, pre, span');
      return !(el.getAttribute('tabindex') === '0' && role && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')));
    }).map((el) => `#${el.parentElement.closest('[id]')?.id} ${el.localName}.${[...el.classList].join('.')}`));
    boxes.forEach((b) => unreachable.add(`${b} (${width}px)`));
    // Firefox refuses screenshots taller than 32767px; the catalogue is longer, so it gets the viewport.
    await snap(page, `page-${width}.png`, { fullPage: true }).catch(() => snap(page, `page-${width}.png`));
  }
  check(!unreachable.size, 'every scroll box can be reached with the keyboard (a control inside, or tabindex, role and name)', [...unreachable].join('; '));
  await page.setViewportSize({ width: 1360, height: 900 });
  // Ids are unique: a duplicate sends labels, dismiss keys and getElementById to the wrong element.
  const dupes = await page.evaluate(() => { const n = {}; for (const e of document.querySelectorAll('[id]')) n[e.id] = (n[e.id] ?? 0) + 1; return Object.keys(n).filter((k) => n[k] > 1); });
  check(!dupes.length, 'every id on the page is unique', dupes.join(', '));
  // A flush panel body frames its children: each one loses margin, border and radius, whatever
  // component it is (tables, wrappers, lists and wells come later in the stylesheet).
  const framed = await page.$$eval('.cb-panel__body--flush > *', (els) => els.filter((e) => e.getClientRects().length).map((e) => {
    const s = getComputedStyle(e);
    return { el: `${e.localName}.${[...e.classList].join('.')}`, edge: [s.margin, s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth, s.borderTopLeftRadius] };
  }).filter((c) => c.edge.some((v) => v !== '0px')));
  check(!framed.length, 'children of a flush panel body have no margin, border or radius', framed.map((c) => `${c.el} ${c.edge.join(' ')}`).join('; '));
}

// 3. Visible focus ring on the first instance of each control type
if (want('controls')) {
  const controls = ['a[href]', 'button:not([disabled])', 'input:not([type=hidden])', 'select', 'textarea', 'summary'];
  for (const sel of controls) {
    const el = page.locator(`${sel}:visible`).first();
    if (await el.count() === 0) continue;
    // Tab away and back with Shift+Tab: keyboard focus, and it stays inside the page even for
    // the first control (Shift+Tab from it would leave for the browser UI).
    await el.focus();
    await page.keyboard.press(TAB);
    await page.keyboard.press(SHIFT_TAB);
    const r = await el.evaluate((n) => { const cs = getComputedStyle(n); return { fv: n.matches(':focus-visible'), w: parseFloat(cs.outlineWidth), s: cs.outlineStyle }; });
    check(r.fv && r.w >= 2 && r.s !== 'none', `focus ring visible on ${sel}`, `${r.w}px ${r.s}`);
  }

  // 4. Key travel on press (first plain button key: a link key would navigate, a modal opener open)
  const btn = page.locator('button.cb-btn[type="button"]:not([disabled], [aria-disabled], [data-cb-modal], [data-cb-dismiss], [popovertarget]):visible').first();
  if (await btn.count()) {
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    const getPressState = () => btn.evaluate((n) => {
      const cs = getComputedStyle(n);
      return `${cs.translate}|${cs.boxShadow}`;
    });
    const before = await getPressState();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(150);
    const during = await getPressState();
    await page.mouse.up(); await page.mouse.move(2, 2); await page.waitForTimeout(150);
    const after = await getPressState();
    check(during !== before && after === before, 'button travels down and inverts bevel on press, returns on release', `${before.split('|')[0]} -> ${during.split('|')[0]}`);
  }

  // 5. Popover dialogs open and close with Escape (menus are check 30)
  for (const id of await page.$$eval('[popovertarget]:not([popovertargetaction])', (n) => [...new Set(n.map((x) => x.getAttribute('popovertarget')))]
    .filter((i) => document.getElementById(i)?.matches('.cb-dialog')))) {
    await page.click(`[popovertarget="${id}"]:not([popovertargetaction])`);
    await page.waitForTimeout(250);
    const opened = await page.evaluate((i) => document.getElementById(i).matches(':popover-open'), id);
    await snap(page, `dialog-${id}.png`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    const closed = await page.evaluate((i) => !document.getElementById(i).matches(':popover-open'), id);
    check(opened && closed, `dialog #${id} opens and closes with Escape`);
  }
}

// 6. Contrast of the palette pairs (scripts/contrast-pairs.mjs): text >= 4.5, non-text >= 3.
const measured = want('contrast') ? await measurePairs(page) : [];
for (const m of measured) {
  if (m.ratio === null) { check(false, `contrast ${label(m.fg)} on ${label(m.bg)}`, 'colour missing'); continue; }
  check(m.ratio >= m.need, `contrast ${label(m.fg)} on ${label(m.bg)} >= ${m.need}`, m.ratio.toFixed(2));
}

// 7. Live states of every distinct interactive control in the catalogue demos:
//    rest, hover, keyboard focus and active are captured and the focus ring is checked.
//    Contrast is measured in each pointer state: text controls need text >= 4.5 against
//    their bottom background colour (or nearest painted ancestor; gradient overlays such
//    as --cb-grad-btn are ignored). Checkboxes and radios have no text, so their boundary
//    (top border vs. surrounding surface) and, when on, their mark vs. fill need >= 3
//    (WCAG 1.4.11). Range thumbs are engine pseudo-elements and are judged from the shots.
//    Disabled and busy controls are skipped.
const readContrast = (el) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data]; };
  const rgb = (c) => rgba(c).slice(0, 3);
  const painted = (start) => {
    for (let n = start; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) return c.slice(0, 3); }
    return [255, 255, 255];
  };
  const cs = getComputedStyle(el);
  if (el.matches('input[type=range]')) return { need: 0, pairs: [] };
  // A segmented-control input is a transparent cover over its key: judge the key's text.
  if (el.closest('.cb-segmented')) {
    const key = el.parentElement;
    return { need: 4.5, pairs: [['text', rgb(getComputedStyle(key).color), painted(key)]] };
  }
  if (el.matches('input[type=checkbox], input[type=radio]')) {
    const on = el.checked || el.indeterminate;
    return { need: 3, pairs: [
      ['boundary', rgb(cs.borderTopColor), painted(el.parentElement)],
      ...(on ? [['mark', rgb(getComputedStyle(el, '::before').backgroundColor), rgb(cs.backgroundColor)]] : []),
    ] };
  }
  return { need: 4.5, pairs: [['text', rgb(cs.color), painted(el)]] };
};

if (want('states')) {
  const controls7 = await page.$$('.docs-demo :is(button, a[href], input, select, textarea, summary):not([disabled], [aria-disabled="true"], [aria-busy="true"])');
  const seenKeys = new Set();
  for (const el of controls7) {
    // A control in a closed <details> or a hidden panel cannot be judged; a shown one of its look is.
    if (!(await el.evaluate((n) => n.getClientRects().length > 0))) continue;
    // One capture per distinct look: tag, classes, input type and state attributes.
    const key = await el.evaluate((n) => n.tagName.toLowerCase()
      + [...n.classList].map((c) => `.${c}`).join('')
      + ['type', 'aria-pressed', 'aria-invalid', 'readonly']
        .filter((a) => n.hasAttribute(a) && !(a === 'type' && n.tagName !== 'INPUT'))
        .map((a) => `[${a}${n.getAttribute(a) ? `=${n.getAttribute(a)}` : ''}]`).join('')
      + (n.closest('.cb-segmented') ? ' in .cb-segmented' : ''));
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const slug = key.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');

    await el.scrollIntoViewIfNeeded();
    const shot = async (state) => {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      const b = await el.boundingBox();
      if (!b || b.y + b.height < 0 || b.x + b.width < 0) return; // e.g. a skip link at rest is off screen
      await snap(page, `state-${slug}-${state}.png`, { clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 } });
    };
    const contrast = async () => {
      const { need, pairs } = await el.evaluate(readContrast);
      return pairs.map(([name, fg, bg]) => ({ name, need, r: ratio(fg, bg) }));
    };
    const box = await el.boundingBox();
    const centre = [box.x + box.width / 2, box.y + box.height / 2];
    const ratios = {};
    // A state is read once its transitions (--cb-duration) have run: a frame for the style to
    // change, the running transitions' end, then a frame for the paint.
    const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => Promise.all(document.getAnimations()
      .filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {}))).then(() => requestAnimationFrame(done)))));

    await page.mouse.move(2, 2); await settle();
    ratios.rest = await contrast(); await shot('rest');

    await page.mouse.move(...centre); await settle();
    ratios.hover = await contrast(); await shot('hover');

    await page.mouse.down(); await settle();
    ratios.active = await contrast(); await shot('active');
    await el.evaluate((n) => n.addEventListener('click', (e) => e.preventDefault(), { once: true }));
    await page.mouse.up(); await page.mouse.move(2, 2);

    await el.focus(); await page.keyboard.press(SHIFT_TAB); await page.keyboard.press(TAB);
    // Tab returns to the checked radio of a group, so judge whichever radio of the group took focus.
    const ring = await el.evaluate((n, segmented) => {
      const f = n.type === 'radio' && document.activeElement?.name === n.name ? document.activeElement : n;
      const cs = getComputedStyle(f); return (f.matches(':focus-visible') || (f.matches(segmented) && f.matches(':focus'))) && parseFloat(cs.outlineWidth) >= 2 && cs.outlineStyle !== 'none';
    }, SEGMENTED);
    await shot('focus');
    await el.evaluate((n) => n.blur());

    const all = Object.entries(ratios).flatMap(([state, list]) => list.map((m) => ({ state, ...m })));
    const low = all.filter((m) => m.r < m.need);
    check(!low.length && ring, `states of ${key}: contrast at rest/hover/active, focus ring visible`,
      `${all.length ? all.map((m) => `${m.state} ${m.name} ${m.r.toFixed(2)}`).join(', ') : 'contrast n/a'}${ring ? '' : ', NO FOCUS RING'}`);
  }
}

// 8. Every button and button-styled link has an accessible name (text or aria-label).
if (want('controls')) {
  const unnamed = await page.$$eval('button, a.cb-btn', (els) => els
    .filter((e) => !(e.getAttribute('aria-label') ?? '').trim() && !e.textContent.trim())
    .map((e) => e.outerHTML.slice(0, 80)));
  check(unnamed.length === 0, 'every button has an accessible name', unnamed.join(' | '));
}

// 9. Behaviour of dist/cubicle.js on the catalogue: copy, reveal, auto re-mask, download,
//    table select-all, alert dismiss, ARIA tabs and trees, meter marks, the plain-HTTP copy fallback, and hiding of script-only controls
//    without JavaScript.
//    Every part starts from a fresh page so earlier clicks do not leak state.
const ACTIONS = '[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-select-all], [data-cb-dismiss], [data-cb-modal], [data-cb-toggle]';
if (want('script') && await page.locator(ACTIONS).count()) {
  const fresh = async (ctx = context, before) => {
    const p = await ctx.newPage();
    if (before) await before(p);
    await applyOverrides(p);
    await p.goto(pathToFileURL(page_path).href);
    return p;
  };
  const valueOf = (p, id) => p.evaluate((i) => {
    const e = document.getElementById(i);
    return e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? e.value : e.textContent;
  }, id);
  const ids = (p, attr) => p.$$eval(`[${attr}]`, (bs, a) => bs.map((b) => b.getAttribute(a)), attr);

  // A broken or missing script must show up as failed checks, not as a crash.
  const attempt = async (name, fn) => {
    try { await fn(); } catch (e) { check(false, name, String(e.message).split('\n')[0]); }
  };

  const p = await fresh();
  const marked = await p.evaluate(() => document.documentElement.hasAttribute('data-cb-js'));
  check(marked, 'cubicle.js marks the root with data-cb-js');

  if (marked) await attempt('script behaviours run without errors', async () => {
    for (const id of await ids(p, 'data-cb-copy')) {
      await expose(p, `[data-cb-copy="${id}"]`);
      const btn = p.locator(`[data-cb-copy="${id}"]`);
      await btn.scrollIntoViewIfNeeded(); await btn.click(); await p.waitForTimeout(100);
      const got = await readClipboard(p);
      const flagged = await btn.evaluate((b) => b.hasAttribute('data-cb-copied'));
      const live = await p.evaluate(() => document.querySelector('[role="status"][data-cb-sr]')?.textContent ?? '');
      check(flagged && /copied/i.test(live), `copy #${id}: button and live region confirm`, `data-cb-copied ${flagged}, live "${live}"`);
      check(got === await valueOf(p, id), `copy #${id} reaches the clipboard`, got === null ? 'clipboard unreadable' : got === await valueOf(p, id) ? '' : 'MISMATCH');
    }

    for (const id of await ids(p, 'data-cb-reveal')) {
      await expose(p, `[data-cb-reveal="${id}"]`);
      const btn = p.locator(`[data-cb-reveal="${id}"]`);
      const state = async () => `${await p.$eval(`#${id}`, (e) => e.type)}/${await btn.getAttribute('aria-pressed')}`;
      const before = await state(); await btn.click(); const shown = await state(); await btn.click(); const after = await state();
      check(before === 'password/false' && shown === 'text/true' && after === 'password/false', `reveal #${id} toggles type and aria-pressed`, `${before} -> ${shown} -> ${after}`);
    }

    const timed = await p.$$eval('[data-cb-reveal][data-cb-reveal-timeout]', (bs) => bs.map((b) => [b.getAttribute('data-cb-reveal'), Number(b.getAttribute('data-cb-reveal-timeout'))]));
    for (const [id, seconds] of timed) {
      const pc = await fresh(context, (q) => q.clock.install());
      await pc.locator(`[data-cb-reveal="${id}"]`).click();
      const shown = await pc.$eval(`#${id}`, (e) => e.type);
      await pc.clock.fastForward(seconds * 1000 + 100);
      const later = await pc.$eval(`#${id}`, (e) => e.type);
      check(shown === 'text' && later === 'password', `reveal #${id} masks again after ${seconds}s`, `${shown} -> ${later}`);
      await pc.close();
    }

    for (const id of await ids(p, 'data-cb-download')) {
      await expose(p, `[data-cb-download="${id}"]`);
      const btn = p.locator(`[data-cb-download="${id}"]`);
      await btn.scrollIntoViewIfNeeded();
      const [download] = await Promise.all([p.waitForEvent('download'), btn.click()]);
      const content = readFileSync(await download.path(), 'utf8');
      const name = await btn.getAttribute('data-cb-filename');
      check(download.suggestedFilename() === name && content === await valueOf(p, id), `download #${id} saves ${name} with the value`,
        `${download.suggestedFilename()}, ${content.length} chars`);
    }

    // Select-all: checks every row, follows the rows (indeterminate when mixed), highlights the
    // checked rows and fires a bubbling change event for each box it changes.
    for (const id of await ids(p, 'data-cb-select-all')) {
      await expose(p, `[data-cb-select-all="${id}"]`);
      const master = p.locator(`[data-cb-select-all="${id}"]`);
      await master.scrollIntoViewIfNeeded(); await p.mouse.move(2, 2);
      const state = () => p.evaluate((i) => {
        const m = document.querySelector(`[data-cb-select-all="${i}"]`);
        const boxes = [...document.getElementById(i).querySelectorAll('tbody input[type="checkbox"]:not(:disabled)')];
        const probe = document.body.appendChild(document.createElement('i'));
        probe.style.color = 'var(--cb-bg-selected)'; const sel = getComputedStyle(probe).color; probe.remove();
        const lit = boxes.filter((b) => getComputedStyle(b.closest('td')).backgroundColor === sel).length;
        return { master: m.checked ? 'on' : m.indeterminate ? 'mixed' : 'off', on: boxes.filter((b) => b.checked).length, lit, n: boxes.length };
      }, id);
      await p.evaluate(() => { window.__changes = 0; document.addEventListener('change', (e) => { if (!e.target.matches('[data-cb-select-all]')) window.__changes++; }); });
      const start = await state();
      await master.click(); const all = await state(); const changes = await p.evaluate(() => window.__changes);
      await p.locator(`#${id} tbody input[type="checkbox"]`).first().click(); await p.mouse.move(2, 2); const mixed = await state();
      await master.click(); await master.click(); const none = await state();
      check(all.master === 'on' && all.on === all.n && all.lit === all.n && changes === all.n - start.on
        && mixed.master === 'mixed' && none.master === 'off' && none.on === 0 && none.lit === 0,
        `select-all #${id} checks rows, follows them and highlights them`,
        `start ${start.master} ${start.on}/${start.n}; all ${all.on}/${all.n} lit ${all.lit}, ${changes} change events; one off -> ${mixed.master}; cleared -> ${none.master} ${none.on}`);
    }

    // Select-all after server swaps, with no click: new rows, a row box turned disabled and a
    // whole table inserted with its master inside resync the master. On a fresh page, because
    // the table is replaced.
    const [swapId] = await ids(p, 'data-cb-select-all');
    if (swapId) {
      const ps = await fresh();
      const swaps = await ps.evaluate(async (i) => {
        const tick = () => new Promise((r) => setTimeout(r, 0));
        const look = () => { const m = document.querySelector(`[data-cb-select-all="${i}"]`); return m.checked ? 'on' : m.indeterminate ? 'mixed' : 'off'; };
        const row = (on) => `<tr><td><input class="cb-check" type="checkbox"${on ? ' checked' : ''} aria-label="row"></td></tr>`;
        const table = () => document.getElementById(i);
        document.querySelector(`[data-cb-select-all="${i}"]`).click(); await tick(); const all = look();
        table().tBodies[0].outerHTML = `<tbody>${row(false)}${row(false)}</tbody>`; await tick(); const swapped = look();
        table().tBodies[0].innerHTML = row(true) + row(false); await tick(); const mixed = look();
        table().tBodies[0].rows[1].querySelector('input').disabled = true; await tick(); const disabled = look();
        const fresh = document.createElement('table'); fresh.id = i;
        fresh.innerHTML = `<thead><tr><th><input type="checkbox" data-cb-select-all="${i}" aria-label="all"></th></tr></thead><tbody>${row(true)}${row(true)}</tbody>`;
        table().replaceWith(fresh); await tick(); const inserted = look();
        return { all, swapped, mixed, disabled, inserted };
      }, swapId);
      await ps.close();
      check(swaps.all === 'on' && swaps.swapped === 'off' && swaps.mixed === 'mixed' && swaps.disabled === 'on' && swaps.inserted === 'on',
        `select-all #${swapId} follows rows swapped in or disabled and a table inserted with its master`, JSON.stringify(swaps));
    }

    // Toggle: a click flips aria-expanded; collapsing with focus inside the target returns focus
    // to the key (the catalogue's shell demo, whose sidebar folds below 50rem).
    for (const id of await ids(p, 'data-cb-toggle')) {
      const pt = await fresh(); await pt.setViewportSize({ width: 360, height: 900 });
      const flip = await pt.evaluate(async (i) => {
        const key = document.querySelector(`[data-cb-toggle="${i}"]`); const tick = () => new Promise((r) => setTimeout(r, 0));
        const before = key.getAttribute('aria-expanded'); key.click(); await tick(); const opened = key.getAttribute('aria-expanded');
        const link = document.getElementById(i).querySelector('a[href]'); link.focus(); const inside = document.activeElement === link;
        key.click(); await tick();
        return { before, opened, after: key.getAttribute('aria-expanded'), inside, focus: document.activeElement === key, hidden: link.getClientRects().length === 0 };
      }, id);
      await pt.close();
      check(flip.before === 'false' && flip.opened === 'true' && flip.after === 'false' && flip.inside && flip.focus,
        `toggle #${id} flips aria-expanded and gives focus back to the key when it closes`, JSON.stringify(flip));
    }

    // Dismiss from the keyboard: the target is hidden and focus moves to a rendered control
    // outside it, never to <body>.
    for (const id of await ids(p, 'data-cb-dismiss')) {
      await expose(p, `[data-cb-dismiss="${id}"]`);
      const btn = p.locator(`[data-cb-dismiss="${id}"]`);
      await btn.scrollIntoViewIfNeeded(); await btn.focus(); await p.keyboard.press('Enter');
      const r = await p.evaluate((i) => {
        const t = document.getElementById(i); const f = document.activeElement;
        return { hidden: t.hidden && getComputedStyle(t).display === 'none', focus: f === document.body ? 'body' : f.outerHTML.slice(0, 60),
          ok: f !== document.body && !t.contains(f) && f.getClientRects().length > 0 };
      }, id);
      check(r.hidden && r.ok, `dismiss #${id} hides the alert and moves focus on`, `hidden ${r.hidden}, focus ${r.focus}`);
    }

    // ARIA tabs: a click selects, arrows (by orientation), Home and End move focus and
    // selection, wrap and skip disabled tabs; exactly one tab and one panel are live.
    const lists = await p.$$eval('[data-cb-tabs] [role="tablist"]', (ls) => ls.map((l, i) => { l.dataset.vbList = i; return { i, vertical: l.getAttribute('aria-orientation') === 'vertical' }; }));
    for (const { i, vertical } of lists) {
      const state = () => p.$eval(`[data-vb-list="${i}"]`, (l) => {
        const tabs = [...l.querySelectorAll('[role="tab"]')];
        const on = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
        const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
        return { on: on.map((t) => t.id).join(), roving: tabs.filter((t) => t.tabIndex === 0).map((t) => t.id).join(),
          shown: panels.filter((x) => x && !x.hidden && getComputedStyle(x).display !== 'none').map((x) => x.id).join(),
          focus: document.activeElement?.id ?? '', enabled: tabs.filter((t) => !t.matches(':disabled, [aria-disabled="true"]')).map((t) => t.id),
          panelOf: Object.fromEntries(tabs.map((t) => [t.id, t.getAttribute('aria-controls')])) };
      });
      const first = await state();
      const consistent = (st, id) => st.on === id && st.roving === id && st.shown === st.panelOf[id];
      const second = first.enabled[1];
      await p.locator(`#${second}`).scrollIntoViewIfNeeded(); await p.locator(`#${second}`).click();
      const clicked = await state();
      const [next, prev] = vertical ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft'];
      const trail = [];
      for (const key of ['End', next, 'Home', prev]) {
        await p.keyboard.press(key); const st = await state();
        trail.push(`${key}:${st.focus === st.on && consistent(st, st.on) ? st.on : 'BROKEN ' + JSON.stringify(st)}`);
      }
      const e = first.enabled;
      const want = [e.at(-1), e[0], e[0], e.at(-1)];
      const ok = consistent(clicked, second) && trail.every((t, k) => t.endsWith(`:${want[k]}`));
      check(ok, `tabs ${i + 1}${vertical ? ' (vertical)' : ''}: click, ${next}/${prev}, Home and End select one tab and its panel`,
        `click ${clicked.on}; ${trail.join(', ')}`);
    }

    // ARIA trees: arrows walk visible rows with a roving tabindex, → opens a closed branch
    // (firing cb-toggle) then enters it, ← goes to the parent and closes an open branch,
    // Enter selects, a click selects and toggles, and the focus ring is on the row label.
    const trees = await p.$$eval('[data-cb-tree] [role="tree"]', (ts) => ts.map((t, i) => { t.dataset.vbTree = i; return i; }));
    for (const i of trees) {
      const tree = `[data-vb-tree="${i}"]`;
      await p.evaluate(() => { window.__toggles = []; document.addEventListener('cb-toggle', (e) => window.__toggles.push(e.detail.expanded)); });
      const at = () => p.evaluate((sel) => {
        const f = document.activeElement; const label = f.querySelector(':scope > .cb-nav__link');
        return { name: label?.textContent.trim() ?? '', expanded: f.getAttribute('aria-expanded'), roving: document.querySelectorAll(`${sel} [role="treeitem"][tabindex="0"]`).length,
          ring: getComputedStyle(f).outlineStyle === 'none' && getComputedStyle(label).outlineStyle !== 'none',
          selected: [...document.querySelectorAll(`${sel} [aria-selected="true"]`)].map((x) => x.querySelector(':scope > .cb-nav__link').textContent.trim()) };
      }, tree);
      const closed = p.locator(`${tree} [role="treeitem"][aria-expanded="false"]:not([aria-busy="true"])`).first();
      await closed.scrollIntoViewIfNeeded(); await closed.focus();
      const start = await at();
      await p.keyboard.press('ArrowRight'); const opened = await at();
      await p.keyboard.press('ArrowRight'); const child = await at();
      await p.keyboard.press('ArrowLeft'); const back = await at();
      await p.keyboard.press('ArrowLeft'); const shut = await at();
      await p.keyboard.press('Home'); const home = await at();
      await p.keyboard.press('End'); const end = await at();
      await p.keyboard.press('ArrowUp'); const up = await at();
      await p.keyboard.press('Enter'); const chosen = await at();
      const toggles = await p.evaluate(() => window.__toggles.join());
      const ok = opened.expanded === 'true' && child.name !== start.name && back.name === start.name && shut.expanded === 'false'
        && home.name !== end.name && up.name !== end.name && chosen.selected.length === 1 && chosen.selected[0] === up.name
        && [start, opened, child, back, shut, home, end, up].every((x) => x.roving === 1 && x.ring) && toggles.startsWith('true,false');
      check(ok, `tree ${i + 1}: arrows, Home, End and Enter walk, open, close and select; ring on the row`,
        `${start.name}: → open, → ${child.name}, ← ${back.name}, ← closed; Home ${home.name}, End ${end.name}, ↑ ${up.name}, Enter selects ${chosen.selected}; cb-toggle ${toggles}`);
      const row = p.locator(`${tree} [role="treeitem"][aria-expanded] > .cb-nav__link`).first();
      const before = await row.evaluate((r) => r.parentElement.getAttribute('aria-expanded'));
      await row.click();
      const after = await row.evaluate((r) => [r.parentElement.getAttribute('aria-expanded'), r.parentElement.getAttribute('aria-selected')]);
      check(after[0] !== before && after[1] === 'true', `tree ${i + 1}: a click selects the row and toggles its branch`, `${before} -> ${after[0]}, selected ${after[1]}`);
    }

    // Meter marks follow attribute changes and meters swapped in later, with no call.
    if (await p.locator('meter[data-cb-marks]').count()) {
      const marks = await p.evaluate(async () => {
        const m = document.querySelector('meter[data-cb-marks]');
        const frac = (meter, v) => String((v - meter.min) / (meter.max - meter.min));
        const before = m.style.getPropertyValue('--_high');
        m.setAttribute('high', String(m.min + (m.max - m.min) / 2));
        await new Promise((r) => setTimeout(r, 0));
        const changed = m.style.getPropertyValue('--_high') === frac(m, m.high);
        const clone = m.cloneNode(true); clone.removeAttribute('style'); clone.removeAttribute('id');
        m.parentElement.append(clone);
        await new Promise((r) => setTimeout(r, 0));
        const inserted = clone.style.getPropertyValue('--_low') === frac(clone, clone.low);
        clone.remove();
        return { before, changed, inserted };
      });
      check(marks.changed && marks.inserted, 'meter marks follow a changed high and a meter inserted later', JSON.stringify(marks));
    }

    // Readouts: an <output data-cb-output for> follows its control, also when both arrive later.
    if (await p.locator('output[data-cb-output]').count()) {
      const id = await p.locator('output[data-cb-output]').first().evaluate((o) => o.htmlFor[0]);
      const read = (cid) => p.evaluate((i) => ({ control: document.getElementById(i).value,
        output: document.querySelector(`output[data-cb-output][for~="${i}"]`).value }), cid);
      const start = await read(id);
      await expose(p, `#${id}`); await p.locator(`#${id}`).focus();
      await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
      const moved = await read(id);
      check(moved.control !== start.control && moved.output === moved.control, 'an output readout follows its control', `${JSON.stringify(start)} -> ${JSON.stringify(moved)}`);
      const later = await p.evaluate(async (i) => {
        const field = document.getElementById(i).closest('.cb-field').cloneNode(true);
        const control = field.querySelector(`#${i}`); const out = field.querySelector('output[data-cb-output]');
        control.id = `${i}-later`; out.id = `${out.id}-later`; out.htmlFor.value = control.id;
        document.getElementById(i).closest('.cb-field').after(field);
        control.value = control.max; control.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
        const got = { control: control.value, output: out.value }; field.remove(); return got;
      }, id);
      check(later.output === later.control, 'an output readout swapped in later follows its control', JSON.stringify(later));
    }

    // Plain-HTTP pages have no navigator.clipboard: the hidden-buffer fallback must still copy.
    const copyId = (await ids(p, 'data-cb-copy'))[0];
    if (copyId) {
      await p.evaluate(() => navigator.clipboard.writeText('sentinel')).catch(() => {});
      const ph = await fresh(context, (q) => q.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })));
      await expose(ph, `[data-cb-copy="${copyId}"]`);
      await ph.locator(`[data-cb-copy="${copyId}"]`).click(); await ph.waitForTimeout(100);
      const got = await readClipboard(p);
      check(got === await valueOf(ph, copyId), `copy #${copyId} falls back when the async clipboard is missing`, got === 'sentinel' ? 'clipboard unchanged' : '');
      await ph.close();
    }
  });
  await p.close();

  // Without JavaScript the actions are hidden and the values stay visible.
  const noJs = await browser.newContext({ ...contextOptions, javaScriptEnabled: false });
  const pn = await fresh(noJs);
  const r = await pn.evaluate((sel) => {
    const buttons = [...document.querySelectorAll(sel)];
    // A dialog target is closed (display: none) by design; every other target must show.
    const targets = buttons.filter((b) => !b.hasAttribute('data-cb-modal')).map((b) => document.getElementById(b.getAttribute('data-cb-copy') ?? b.getAttribute('data-cb-reveal') ?? b.getAttribute('data-cb-download') ?? b.getAttribute('data-cb-select-all') ?? b.getAttribute('data-cb-dismiss') ?? b.getAttribute('data-cb-modal') ?? b.getAttribute('data-cb-toggle')));
    return { hidden: buttons.every((b) => getComputedStyle(b).display === 'none'), visible: targets.every((t) => t && getComputedStyle(t).display !== 'none') };
  }, ACTIONS);
  check(r.hidden && r.visible, 'without JavaScript, script-only actions are hidden and values stay visible', JSON.stringify(r));
  const t = await pn.evaluate(() => {
    const sets = [...document.querySelectorAll('[data-cb-tabs]')];
    return { sets: sets.length, listsHidden: sets.every((s) => [...s.querySelectorAll('[role="tablist"]')].every((l) => getComputedStyle(l).display === 'none')),
      panelsShown: sets.every((s) => [...s.querySelectorAll('[role="tabpanel"]')].every((x) => getComputedStyle(x).display !== 'none')),
      headings: sets.every((s) => [...s.querySelectorAll('.cb-tabs__heading')].every((h) => getComputedStyle(h).display !== 'none')) };
  });
  if (t.sets) check(t.listsHidden && t.panelsShown && t.headings, 'without JavaScript, ARIA tab sets show every panel under its heading', JSON.stringify(t));
  const g = await pn.$$eval('[data-cb-tree] [role="group"]', (gs) => ({ groups: gs.length, shown: gs.filter((x) => getComputedStyle(x).display !== 'none').length }));
  if (g.groups) check(g.shown === g.groups, 'without JavaScript, ARIA trees show every branch', JSON.stringify(g));
  const unmarked = await pn.$$eval('meter[data-cb-marks]', (ms) => ms.filter((m) => m.style.getPropertyValue('--_low') || m.style.getPropertyValue('--_high')).length);
  check(unmarked === 0, 'without JavaScript, meters carry no marks', `${unmarked} marked`);
  const outs = await pn.$$eval('output[data-cb-output]', (os) => os.map((o) => ({ out: o.textContent, control: document.getElementById(o.htmlFor[0])?.value, shown: getComputedStyle(o).display !== 'none' })));
  if (outs.length) check(outs.every((o) => o.shown && o.out === o.control), 'without JavaScript, output readouts show the value they were served with', JSON.stringify(outs));
  await noJs.close();
}

// 10. Badges and LEDs, once per distinct look: text >= 4.5 against the painted background,
//     the LED lamp rim >= 3 against it (WCAG 1.4.11), at most 20px high so badges fit
//     .cb-btn--sm table rows, and busy badges spin except under reduced motion. Then chips.
const INDICATORS = '.docs-demo :is(.cb-badge, .cb-led)';
if (want('badges') && await page.locator(INDICATORS).count()) {
  const measured = await page.$$eval(INDICATORS, (els) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const rgba = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data]; };
    const painted = (start) => {
      for (let n = start; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) return c.slice(0, 3); }
      return [255, 255, 255];
    };
    const seen = new Set();
    return els.flatMap((el) => {
      const busy = el.getAttribute('aria-busy') === 'true';
      const key = `${el.className}${busy ? '[aria-busy]' : ''}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const cs = getComputedStyle(el); const lamp = getComputedStyle(el, '::before');
      const lit = !busy && lamp.display !== 'none' && lamp.content !== 'none';
      return [{ key, busy, height: el.getBoundingClientRect().height, text: [rgba(cs.color).slice(0, 3), painted(el)],
        rim: lit ? [rgba(lamp.borderTopColor).slice(0, 3), painted(el)] : null, spin: lamp.animationName }];
    });
  });
  for (const m of measured) {
    const text = ratio(...m.text); const rim = m.rim && ratio(...m.rim);
    const ok = text >= 4.5 && (!m.rim || rim >= 3) && m.height <= 20 && (!m.busy || m.spin === 'cb-spin');
    check(ok, `indicator .${m.key.replace(/ /g, '.')}: text, lamp and height`,
      `text ${text.toFixed(2)}${m.rim ? `, lamp ${rim.toFixed(2)}` : ''}, ${m.height}px${m.busy ? `, ${m.spin}` : ''}`);
  }

  const calm = await browser.newContext({ ...contextOptions, reducedMotion: 'reduce' });
  const pr = await calm.newPage(); await applyOverrides(pr); await pr.goto(pathToFileURL(page_path).href);
  const still = await pr.$$eval('.docs-demo .cb-badge[aria-busy="true"]', (els) => els.map((e) => getComputedStyle(e, '::before').animationName));
  check(still.length > 0 && still.every((a) => a === 'none'), 'busy badges stop spinning under reduced motion', still.join(', '));
  await calm.close();

  // Chips: the chip and its square remove key are --cb-row-h-sm tall at every density and share
  // one frame (the key meets the chip's top, bottom and end edges); at 360px a long value wraps
  // and keeps the key square at the top. Every key is a <button> named "Remove ..." with its chip's value,
  // and every list has a name. The catalogue must show chips.
  const catalogue = await page.locator('#accessibility').count();
  if (catalogue || await page.locator('.cb-chip').count()) {
    const frames = [];
    for (const [density, width] of [['compact', 1360], ['default', 1360], ['comfortable', 1360], ['default', 360]]) {
      await page.setViewportSize({ width, height: 900 });
      const r = await page.evaluate((d) => {
        if (d === 'default') document.documentElement.removeAttribute('data-cb-density'); else document.documentElement.dataset.cbDensity = d;
        const chips = [...document.querySelectorAll('.cb-chip')].filter((c) => c.getClientRects().length);
        const bad = chips.flatMap((c) => {
          const h = parseFloat(getComputedStyle(c).getPropertyValue('--cb-row-h-sm')) * parseFloat(getComputedStyle(document.documentElement).fontSize);
          const r = c.getBoundingClientRect(); const k = c.querySelector(':scope > .cb-chip__remove');
          const label = `"${c.textContent.trim().slice(0, 24)}"`;
          if (!k) return Math.abs(r.height - h) <= 0.5 ? [] : [`${label} ${r.height.toFixed(1)}px for ${h}`];
          const q = k.getBoundingClientRect();
          const end = getComputedStyle(c).direction === 'rtl' ? q.left - r.left : r.right - q.right;
          const wrapped = r.height > h + 0.5;
          const ok = Math.abs(q.height - h) <= 0.5 && Math.abs(q.width - h) <= 0.5 && Math.abs(q.top - r.top) <= 0.5
            && Math.abs(end) <= 0.5 && (wrapped || Math.abs(r.bottom - q.bottom) <= 0.5);
          return ok ? [] : [`${label} chip ${r.width.toFixed(1)}x${r.height.toFixed(1)}, key ${q.width.toFixed(1)}x${q.height.toFixed(1)} off top/bottom/end ${(q.top - r.top).toFixed(1)}/${(r.bottom - q.bottom).toFixed(1)}/${end.toFixed(1)} for ${h}`];
        });
        return { n: chips.length, wrapped: chips.some((c) => c.querySelector(':scope > .cb-chip__remove') && c.getBoundingClientRect().height > c.querySelector(':scope > .cb-chip__remove').getBoundingClientRect().height + 0.5), bad };
      }, density);
      frames.push(...r.bad.map((b) => `${density} ${width}px: ${b}`));
      if (!r.n) frames.push(`${density} ${width}px: no chips`);
      if (width === 360 && catalogue && !r.wrapped) frames.push('360px: no chip with a wrapped value');
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-cb-density'));
    await page.setViewportSize({ width: 1360, height: 900 });
    check(!frames.length, 'chips: chip and square remove key are --cb-row-h-sm tall in one frame at every density', frames.slice(0, 4).join(' | '));

    const names = await page.$$eval('.cb-chips, .cb-chip__remove', (els) => els.flatMap((e) => {
      if (e.matches('.cb-chips')) return e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') ? [] : [`unnamed list "${e.textContent.trim().slice(0, 24)}"`];
      const value = [...e.closest('.cb-chip').childNodes].filter((n) => n !== e).map((n) => n.textContent).join('').trim();
      const name = e.getAttribute('aria-label') ?? '';
      return e.localName === 'button' && name.startsWith('Remove') && name.includes(value) ? [] : [`${e.localName} "${name}" for "${value}"`];
    }));
    check(!names.length, 'chips: every list is named and every remove key is a button named "Remove ..." with its value', names.slice(0, 3).join(' | '));
  }

  await sectionShots('badges');
}

// 11. Data tables: one row height (28px, compact 24px) with or without .cb-btn--sm,
//     sticky first column(s) and header that stay put while their wrapper scrolls,
//     text contrast in every row paint (zebra, hover, selected, totals), and a visible
//     sort arrow for each aria-sort value.
if (want('tables') && await page.locator('.docs-demo .cb-table').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  // Tables inside closed dialogs are not rendered; they are measured by check 18 instead.
  const heights = await page.$$eval('.docs-demo .cb-table', (tables) => tables.filter((t) => t.getClientRects().length).map((t, i) => {
    const rows = [...t.querySelectorAll('tbody tr, thead tr, tfoot tr')].filter((r) => !r.querySelector('.cb-table__empty'));
    // The row height comes from the density tokens in force on this table (rem -> px).
    const token = getComputedStyle(t).getPropertyValue(t.classList.contains('cb-table--compact') ? '--cb-row-h-sm' : '--cb-row-h').trim();
    const want = Math.round(parseFloat(token) * parseFloat(getComputedStyle(document.documentElement).fontSize));
    const wraps = t.classList.contains('cb-table--wrap');
    return { i, want, wraps, got: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))] };
  }));
  for (const h of heights) {
    const ok = h.wraps ? h.got.every((x) => x >= h.want) : h.got.length === 1 && h.got[0] === h.want;
    check(ok, `table ${h.i + 1}: rows are ${h.want}px${h.wraps ? ' or taller (wrapping)' : ''}`, `${h.got.join(', ')}px`);
  }

  // Sticky checks run at 360px, where the wide grid scrolls inside its wrapper.
  await page.setViewportSize({ width: 360, height: 900 });
  const sticky = await page.$$eval('.docs-demo .cb-table--sticky', (tables) => tables.map((t, i) => {
    const wrap = t.closest('.cb-table-wrap');
    if (!wrap) return { i, skip: true };
    const box = () => wrap.getBoundingClientRect();
    const row = t.querySelector('tbody tr');
    const pinned = t.querySelector('.cb-table__select:first-child') ? 2 : 1;
    const before = [...row.children].slice(0, pinned).map((c) => c.getBoundingClientRect().left - box().left);
    wrap.scrollLeft = wrap.scrollWidth;
    const after = [...row.children].slice(0, pinned).map((c) => c.getBoundingClientRect().left - box().left);
    const scrolledX = wrap.scrollLeft;
    wrap.scrollTop = wrap.scrollHeight;
    const headTop = t.querySelector('thead th').getBoundingClientRect().top - box().top - wrap.clientTop; // from the inner edge
    const scrolledY = wrap.scrollTop;
    wrap.scrollLeft = 0; wrap.scrollTop = 0;
    return { i, pinned, before, after, scrolledX, headTop, scrolledY };
  }));
  for (const s of sticky.filter((x) => !x.skip)) {
    const columnsHold = !s.scrolledX || s.after.every((x, k) => Math.abs(x - s.before[k]) < 1);
    const headHolds = !s.scrolledY || Math.abs(s.headTop) < 1;
    check(columnsHold && headHolds && (s.scrolledX || s.scrolledY), `sticky table ${s.i + 1}: pinned columns and header stay in place while scrolled`,
      `scrolled x ${s.scrolledX} y ${s.scrolledY}; first ${s.pinned} column(s) ${s.before.map(Math.round)} -> ${s.after.map(Math.round)}; header top ${Math.round(s.headTop)}`);
  }
  const wide = page.locator('.docs-demo .cb-table--sticky').first();
  await wide.scrollIntoViewIfNeeded();
  await wide.evaluate((t) => { t.closest('.cb-table-wrap').scrollLeft = 300; });
  await snap(wide.locator('xpath=..'), `tables-sticky-360.png`);
  await wide.evaluate((t) => { t.closest('.cb-table-wrap').scrollLeft = 0; });
  await page.setViewportSize({ width: 1360, height: 900 });

  // Contrast of every row paint, live: hover is forced by moving the pointer onto a row.
  // Disabled rows are exempt (WCAG 1.4.3) and checked on their own below; busy rows paint a
  // hatch, not a colour, and are measured by check 27.
  const paints = async () => page.$$eval('.docs-demo .cb-table :is(tbody, tfoot) tr:not([aria-disabled="true"], [aria-busy="true"] tr)', (rows) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const rgb = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    return rows.flatMap((r) => [...r.children].filter((c) => !c.querySelector('a, .cb-badge, .cb-btn, .cb-check') && c.textContent.trim())
      .map((c) => ({ key: getComputedStyle(c).backgroundColor, fg: rgb(getComputedStyle(c).color), bg: rgb(getComputedStyle(c).backgroundColor) })));
  });
  const row = page.locator('.docs-demo .cb-table tbody tr:not(:has(:checked))').first();
  await row.scrollIntoViewIfNeeded(); await row.hover();
  const cells = [...await paints(), ...(await (async () => { await page.mouse.move(2, 2); return paints(); })())];
  const byPaint = new Map();
  for (const c of cells) { const r = ratio(c.fg, c.bg); if (!byPaint.has(c.key) || r < byPaint.get(c.key)) byPaint.set(c.key, r); }
  for (const [paint, r] of byPaint) check(r >= 4.5, `table cell text on ${paint} >= 4.5`, r.toFixed(2));

  // A disabled row takes the disabled ink and keeps its fill under the pointer.
  const off = page.locator('.docs-demo .cb-table tbody tr[aria-disabled="true"]').first();
  if (await off.count()) {
    await off.scrollIntoViewIfNeeded(); await page.mouse.move(2, 2);
    const look = () => off.evaluate((r) => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = 'var(--cb-text-disabled)'; const want = getComputedStyle(probe).color; probe.remove();
      const cell = r.querySelector('td'); return { want, ink: getComputedStyle(cell).color, fill: getComputedStyle(cell).backgroundColor };
    });
    const rest = await look(); await off.hover(); const hovered = await look(); await page.mouse.move(2, 2);
    check(rest.ink === rest.want && hovered.fill === rest.fill, 'a disabled table row takes the disabled ink and no hover fill',
      `ink ${rest.ink} (want ${rest.want}), fill ${rest.fill} -> ${hovered.fill}`);
  }

  const arrows = await page.$$eval('.docs-demo th[aria-sort] > .cb-table__sort', (bs) => bs.map((b) => {
    const a = getComputedStyle(b, '::after');
    return { sort: b.parentElement.getAttribute('aria-sort'), w: parseFloat(a.width), h: parseFloat(a.height), clip: a.clipPath !== 'none' };
  }));
  for (const sort of new Set(arrows.map((a) => a.sort))) {
    const a = arrows.find((x) => x.sort === sort);
    check(a.w > 0 && a.h > 0 && a.clip, `sort arrow visible for aria-sort="${sort}"`, `${a.w}x${a.h}px`);
  }

  await sectionShots('tables');
}

// 11b. Names in data tables, on the catalogue's demos or on any other page: every table has a name
//     (a caption, aria-label, or aria-labelledby pointing at text), and the keys in a table body
//     name their row, so no two share a name ("Disconnect alice.ng", not six "Disconnect").
if (want('tables') && await page.locator('.cb-table').count()) {
  const names = await page.evaluate(() => {
    const tables = [...document.querySelectorAll(document.querySelector('.docs-demo') ? '.docs-demo table.cb-table' : 'table.cb-table')];
    const where = (t) => `#${t.parentElement.closest('[id]')?.id}`;
    const text = (ids) => ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent.trim() ?? '').join(' ').trim();
    const name = (el) => el.getAttribute('aria-label')?.trim() || (el.getAttribute('aria-labelledby') ? text(el.getAttribute('aria-labelledby')) : '') || el.textContent.trim();
    const unnamed = tables.filter((t) => !t.caption?.textContent.trim() && !t.getAttribute('aria-label')?.trim() && !(t.getAttribute('aria-labelledby') && text(t.getAttribute('aria-labelledby'))))
      .map((t) => `${where(t)} [${[...t.querySelectorAll('thead th')].map((th) => th.textContent.trim()).filter(Boolean).slice(0, 2).join(', ')}]`);
    const repeated = tables.flatMap((t) => {
      const seen = {};
      // Items of a row's menu are named within the menu, which its key names.
      for (const k of t.querySelectorAll('tbody :is(button, a[href]):not([role="menu"] *)')) { const n = name(k); seen[n] = (seen[n] ?? 0) + 1; }
      return Object.entries(seen).filter(([, n]) => n > 1).map(([k, n]) => `${where(t)} "${k}" x${n}`);
    });
    return { unnamed, repeated };
  });
  check(!names.unnamed.length, 'every data table has a name (caption, aria-label or aria-labelledby)', names.unnamed.join('; '));
  check(!names.repeated.length, 'row keys name their row: no two keys in one table share a name', names.repeated.join('; '));
}

// 12. Alerts: a 4px edge in the tone, a rendered glyph tile with readable inverse ink,
//     readable title and body text, one-line compact alerts 28px high (27px as a banner,
//     which has no top border), and square banners.
if (want('alerts') && await page.locator('.docs-demo .cb-alert').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const alerts = await page.$$eval('.docs-demo .cb-alert', (els) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const rgb = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    return els.map((a) => {
      const cs = getComputedStyle(a); const glyph = getComputedStyle(a, '::before');
      const title = a.querySelector('.cb-alert__title');
      const lines = Math.round((a.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)) / parseFloat(cs.lineHeight));
      return {
        key: a.className + (a.id ? `#${a.id}` : ''), banner: a.classList.contains('cb-alert--banner'), sm: a.classList.contains('cb-alert--sm'),
        edge: cs.borderInlineStartWidth, edgeColour: rgb(cs.borderLeftColor), tone: rgb(glyph.backgroundColor),
        glyph: glyph.content, glyphInk: rgb(glyph.color), bg: rgb(cs.backgroundColor), ink: rgb(cs.color),
        titleInk: title ? rgb(getComputedStyle(title).color) : null, height: a.getBoundingClientRect().height, lines, radius: cs.borderTopLeftRadius,
      };
    });
  });
  for (const a of alerts) {
    const glyphR = ratio(a.glyphInk, a.tone); const textR = ratio(a.ink, a.bg); const titleR = a.titleInk ? ratio(a.titleInk, a.bg) : null;
    const want = a.banner ? 27 : 28;
    const ok = a.edge === '4px' && a.edgeColour.join() === a.tone.join() && /"\S+"/.test(a.glyph) && glyphR >= 4.5 && textR >= 4.5
      && (titleR === null || titleR >= 4.5) && (!a.sm || a.lines > 1 || Math.round(a.height) === want) && (!a.banner || a.radius === '0px');
    check(ok, `alert .${a.key.replace(/ /g, '.')}: edge, glyph, contrast${a.sm ? ', height' : ''}${a.banner ? ', square' : ''}`,
      `edge ${a.edge}, glyph ${a.glyph.split(' /')[0]} ${glyphR.toFixed(2)}, text ${textR.toFixed(2)}${titleR ? `, title ${titleR.toFixed(2)}` : ''}${a.sm ? `, ${Math.round(a.height)}px` : ''}`);
  }
  await sectionShots('alerts');
}

// 13. Tabs: the selected tab takes its panel's colour and hides the line under it (one
//     sheet), long link lists scroll inside themselves at 360px, the tab chosen with End
//     stays in view, and vertical lists turn horizontal below 30rem.
if (want('tabs') && await page.locator('.docs-demo .cb-tabs').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  // Right-to-left demos are measured by check 34; the physical edges here assume left to right.
  const merged = await page.$$eval('.docs-demo .cb-tabs:not([dir="rtl"] *)', (sets) => sets.map((set, i) => {
    const tab = set.querySelector('.cb-tabs__tab:is([aria-selected="true"], [aria-current="page"])');
    const panel = set.querySelector('.cb-tabs__panel:not([hidden])');
    const surface = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') return c; } return ''; };
    const vertical = getComputedStyle(tab.parentElement).flexDirection === 'column';
    const edge = getComputedStyle(tab)[vertical ? 'borderRightColor' : 'borderBottomColor'];
    return { i, bg: getComputedStyle(tab).backgroundColor, panel: surface(panel), edge, vertical };
  }));
  for (const m of merged) {
    check(m.bg === m.panel && m.edge === m.bg, `tab set ${m.i + 1}: selected tab and panel form one sheet${m.vertical ? ' (vertical)' : ''}`,
      `tab ${m.bg}, panel ${m.panel}, ${m.vertical ? 'end' : 'bottom'} edge ${m.edge}`);
  }

  await page.setViewportSize({ width: 360, height: 900 });
  const narrow = await page.evaluate(() => {
    const lists = [...document.querySelectorAll('.docs-demo .cb-tabs__list')];
    const long = lists.find((l) => l.scrollWidth > l.clientWidth);
    const vertical = document.querySelector('.docs-demo .cb-tabs--vertical > .cb-tabs__list');
    return { scrolls: Boolean(long), overflow: document.documentElement.scrollWidth > innerWidth,
      verticalRow: vertical ? getComputedStyle(vertical).flexDirection : 'none' };
  });
  check(narrow.scrolls && !narrow.overflow, 'tab lists scroll inside themselves at 360px, page does not', JSON.stringify(narrow));
  const scrolled = page.locator('.docs-demo [data-cb-tabs] [role="tablist"]').first();
  await scrolled.locator('[aria-selected="true"]').focus(); await page.keyboard.press('End');
  const inView = await scrolled.evaluate((l) => { const t = l.querySelector('[aria-selected="true"]').getBoundingClientRect(); const b = l.getBoundingClientRect(); return t.left >= b.left - 1 && t.right <= b.right + 1; });
  await page.keyboard.press('Home');
  check(inView, 'the tab selected with End is scrolled into view');
  await page.setViewportSize({ width: 1360, height: 900 });
  const wide = await page.$eval('.docs-demo .cb-tabs--vertical > .cb-tabs__list', (l) => getComputedStyle(l).flexDirection).catch(() => 'none');
  check(wide === 'column' && narrow.verticalRow === 'row', 'vertical tabs stand at 1360px and lie flat at 360px', `${wide} / ${narrow.verticalRow}`);

  await sectionShots('tabs');
}

// 13b. A native disabled tab (a <button role="tab" disabled>) looks like an aria-disabled one.
if (want('tabs') && await page.locator('.docs-demo .cb-tabs__tab:disabled').count()) {
  const look = await page.locator('.docs-demo .cb-tabs__tab:disabled').first().evaluate((t) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-text-disabled)'; const want = getComputedStyle(probe).color; probe.remove();
    const cs = getComputedStyle(t); return { want, ink: cs.color, cursor: cs.cursor };
  });
  check(look.ink === look.want && look.cursor === 'not-allowed', 'a native disabled tab takes the disabled ink', JSON.stringify(look));
}

// 14. Navigation and trees: 24px rows, the current or selected row paints the selected
//     tint with a 2px accent bar, leaf and branch labels line up, --lines draws a 1px
//     vertical per nested item (stopping at the row centre on the last one), a loading
//     branch spins (and stops under reduced motion), and breadcrumb separators are silent.
if (want('nav') && await page.locator('.docs-demo .cb-nav').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const nav = await page.evaluate(() => {
    // Left-to-right rows only: right-to-left offsets mirror (check 34).
    const rows = [...document.querySelectorAll('.docs-demo .cb-nav__link:not([dir="rtl"] *)')].filter((r) => r.getClientRects().length);
    const heights = [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))];
    const current = document.querySelector('.docs-demo .cb-nav__link[aria-current="page"], .docs-demo [aria-selected="true"] > .cb-nav__link');
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-selected)'; const selected = getComputedStyle(probe).color; probe.remove();
    const cs = getComputedStyle(current);
    // Text start of each visible row, relative to its list item, grouped by nesting depth.
    const starts = rows.map((r) => {
      const text = [...r.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()) ?? r.querySelector('.cb-nav__kind');
      const range = document.createRange(); range.selectNodeContents(text);
      let depth = 0; for (let n = r.parentElement; n && !n.classList.contains('cb-nav'); n = n.parentElement) if (n.classList.contains('cb-nav__list')) depth++;
      return `${r.closest('.cb-nav').dataset.vbNav ??= Math.random()}|${depth}|${Math.round(range.getBoundingClientRect().left)}`;
    });
    const byGroup = {}; for (const s of starts) { const [nav, depth, x] = s.split('|'); (byGroup[nav + depth] ??= new Set()).add(x); }
    const ragged = Object.values(byGroup).filter((set) => set.size > 1).length;
    const lines = [...document.querySelectorAll('.docs-demo .cb-nav--lines .cb-nav__list .cb-nav__list > li')].filter((li) => li.getClientRects().length);
    const badLines = lines.filter((li) => {
      const v = getComputedStyle(li, '::before'); const h = parseFloat(v.height);
      return v.borderLeftWidth !== '1px' || (li.matches(':last-child') ? Math.abs(h - 12) > 0.5 : h < 23);
    }).length;
    const busy = document.querySelector('.docs-demo [aria-busy="true"] > .cb-nav__link');
    const seps = [...document.querySelectorAll('.docs-demo .cb-breadcrumb > li + li')].map((li) => getComputedStyle(li, '::before').content);
    return { heights, bg: cs.backgroundColor, selected, bar: cs.backgroundImage.startsWith('linear-gradient') && cs.backgroundSize.startsWith('2px'),
      ragged, lines: lines.length, badLines, spin: busy ? getComputedStyle(busy, '::before').animationName : 'none', seps };
  });
  check(nav.heights.length === 1 && nav.heights[0] === 24, 'navigation rows are 24px', `${nav.heights.join(', ')}px`);
  check(nav.bg === nav.selected && nav.bar, 'current and selected rows paint the selected tint and a 2px accent bar', `${nav.bg}, bar ${nav.bar}`);
  check(nav.ragged === 0, 'leaf and branch labels start at the same offset per level', `${nav.ragged} ragged levels`);
  check(nav.lines > 0 && nav.badLines === 0, 'tree lines: a 1px vertical per nested item, the last one stops at the row centre', `${nav.lines} items, ${nav.badLines} wrong`);
  check(nav.spin === 'cb-spin', 'a loading branch shows the spinner in place of the chevron', nav.spin);
  check(nav.seps.length > 0 && nav.seps.every((x) => /\/ ""$/.test(x)), 'breadcrumb separators have empty alt text', nav.seps[0] ?? 'none');
  const calm = await browser.newContext({ ...contextOptions, reducedMotion: 'reduce' });
  const pr = await calm.newPage(); await applyOverrides(pr); await pr.goto(pathToFileURL(page_path).href);
  const still = await pr.$eval('.docs-demo [aria-busy="true"] > .cb-nav__link', (r) => getComputedStyle(r, '::before').animationName).catch(() => 'missing');
  check(still === 'none', 'loading branches stop spinning under reduced motion', still);
  await calm.close();

  await sectionShots('nav');
}

// 14b. A disabled navigation link (aria-disabled, no href) takes the disabled ink and no hover fill.
if (want('nav') && await page.locator('.docs-demo .cb-nav__link[aria-disabled="true"]').count()) {
  const link = page.locator('.docs-demo .cb-nav__link[aria-disabled="true"]').first();
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  const look = await link.evaluate((l) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-text-disabled)'; const want = getComputedStyle(probe).color; probe.remove();
    const cs = getComputedStyle(l); return { want, ink: cs.color, hoverFill: cs.backgroundColor, cursor: cs.cursor };
  });
  await page.mouse.move(2, 2);
  check(look.ink === look.want && look.hoverFill === 'rgba(0, 0, 0, 0)' && look.cursor === 'not-allowed',
    'a disabled navigation link is muted, refuses the pointer and takes no hover fill', JSON.stringify(look));
}

// 15. Meters and progress. Engine pseudo-elements cannot be read through getComputedStyle,
//     so the fill and the ruler are checked on pixels: the element is screenshotted and the
//     PNG decoded in the page. The fill at 5% must be nearest to the tone the browser's own
//     reading implies (low / high / optimum; neutral meters and progress use the accent) and
//     stand >= 3:1 against the empty track; tracks are 12px (6px compact); indeterminate
//     progress stands still; --ticks and data-cb-marks draw into the strip under the track.
const pixelsOf = async (locator) => {
  const png = (await locator.screenshot({ animations: 'disabled' })).toString('base64');
  return (fx, fy) => page.evaluate(async ([b64, x, y]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    return [...g.getImageData(Math.min(img.width - 1, Math.floor(x * img.width)), Math.min(img.height - 1, Math.floor(y * img.height)), 1, 1).data].slice(0, 3);
  }, [png, fx, fy]);
};
if (want('meters') && await page.locator('.docs-demo .cb-meter').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const tones = await page.evaluate(() => {
    const out = {}; const probe = document.body.appendChild(document.createElement('i'));
    for (const t of ['ok', 'warn', 'danger', 'accent', 'border-main', 'text-main', 'bg-surface']) { probe.style.color = `var(--cb-${t})`; out[t] = getComputedStyle(probe).color.match(/\d+/g).slice(0, 3).map(Number); }
    probe.remove(); return out;
  });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const nearest = (px, names) => names.reduce((best, n) => (dist(px, tones[n]) < dist(px, tones[best]) ? n : best));
  const meters = page.locator('.docs-demo .cb-meter');
  const seen = new Set();
  for (let i = 0; i < await meters.count(); i++) {
    const m = meters.nth(i);
    const info = await m.evaluate((el) => {
      const meter = el.tagName === 'METER';
      const has = (a) => el.hasAttribute(a);
      let tone = 'accent';
      if (meter && (has('low') || has('high'))) {
        const { min, max, low, high, value } = el; const optimum = has('optimum') ? el.optimum : (min + max) / 2;
        if (optimum < low) tone = value < low ? 'ok' : value <= high ? 'warn' : 'danger';
        else if (optimum > high) tone = value > high ? 'ok' : value >= low ? 'warn' : 'danger';
        else tone = value >= low && value <= high ? 'ok' : 'warn';
      }
      const cs = getComputedStyle(el);
      const strip = parseFloat(cs.paddingBottom);
      return { key: `${el.tagName.toLowerCase()} ${el.className} ${tone}${el.matches(':indeterminate') ? ' indeterminate' : ''}`, tone, indeterminate: el.matches(':indeterminate'),
        h: el.getBoundingClientRect().height, track: el.getBoundingClientRect().height - strip, strip, sm: el.classList.contains('cb-meter--sm'),
        fraction: meter || !el.matches(':indeterminate') ? (el.value - (el.min ?? 0)) / ((el.max ?? 1) - (el.min ?? 0)) : 0,
        ticks: el.classList.contains('cb-meter--ticks'), low: el.style.getPropertyValue('--_low'), high: el.style.getPropertyValue('--_high'), animation: cs.animationName };
    });
    if (seen.has(info.key)) continue;
    seen.add(info.key);
    await m.scrollIntoViewIfNeeded();
    const px = await pixelsOf(m);
    const midTrack = (info.track / 2) / info.h;
    const wantH = info.sm ? 6 : 12;
    const results = [];
    let ok = Math.round(info.track) === wantH;
    results.push(`track ${info.track}px`);
    if (!info.indeterminate) {
      const fill = await px(0.05, midTrack); const empty = await px((Math.min(info.fraction, 0.96) + 1) / 2, midTrack);
      const got = nearest(fill, ['ok', 'warn', 'danger', 'accent']); const r = ratio(fill, empty);
      ok &&= got === info.tone && (info.fraction > 0.97 || r >= 3);
      results.push(`fill ${got} (want ${info.tone}), vs track ${r.toFixed(2)}`);
    } else {
      const a = (await m.screenshot()).toString('base64'); await page.waitForTimeout(300); const b = (await m.screenshot()).toString('base64');
      ok &&= info.animation === 'none' && a === b;
      results.push(`still ${a === b}, animation ${info.animation}`);
      // The hatch is drawn: about half of the track is the darker stripe (Firefox once drew a
      // repeating gradient with a color-mix() stop as hairlines on a flat track).
      const samples = []; for (let k = 0; k < 40; k++) samples.push(await px(0.05 + 0.9 * k / 39, midTrack));
      const light = samples.reduce((x, y) => (ratio(y, [0, 0, 0]) > ratio(x, [0, 0, 0]) ? y : x));
      const dark = samples.filter((c) => ratio(c, light) >= 1.4).length;
      ok &&= dark >= 10;
      results.push(`${dark}/40 samples on a stripe`);
    }
    check(ok, `meter: ${info.key.trim()}`, results.join(', '));
    const ruler = []; let rulerOk = true;
    const stripY = (info.h - 1) / info.h;
    if (info.ticks) {
      const tick = await px(0.5, stripY); const t = nearest(tick, ['border-main', 'bg-surface', 'text-main']);
      rulerOk &&= t !== 'bg-surface';
      ruler.push(`tick at 50% ${t}`);
    }
    if (info.low || info.high) {
      const w = (await m.boundingBox()).width;
      for (const f of [info.low, info.high].filter(Boolean).map(Number)) {
        const x = ((w - 2) * f + 1) / w; const mark = await px(x, stripY);
        const t = nearest(mark, ['text-main', 'border-main', 'bg-surface']);
        rulerOk &&= t === 'text-main';
        ruler.push(`mark at ${(f * 100).toFixed(0)}% ${t}`);
      }
    }
    // Without a ruler strip (Firefox) there is nothing to probe: the pixels under the track
    // could land on its border and pass by chance, so the check fails as an engine limit.
    if (ruler.length) check(info.strip > 0 && rulerOk, `meter ruler: ${info.key.trim()}`, info.strip > 0 ? ruler.join(', ') : 'no ruler strip');
  }
  const rows = await page.$$eval('.docs-demo .cb-table:has(.cb-meter--sm) tbody tr', (rs) => [...new Set(rs.map((r) => Math.round(r.getBoundingClientRect().height)))]);
  if (rows.length) check(rows.length === 1 && rows[0] === 28, 'table rows with compact meters stay 28px', `${rows.join(', ')}px`);

  await sectionShots('meters');
}

// 16. Segmented controls: the checked key is sunk on the selected tint and the others are
//     not, a click and the arrow keys move the choice, the input covers its key exactly (so
//     the focus ring frames the key), disabled keys and disabled fieldsets refuse a choice,
//     checkbox groups keep several keys on, and --fill keys share the row equally.
if (want('segmented') && await page.locator('.docs-demo .cb-segmented').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const look = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-selected)'; const selected = getComputedStyle(probe).color;
    probe.style.boxShadow = 'var(--cb-shadow-pressed)'; const pressed = getComputedStyle(probe).boxShadow; probe.remove();
    const keys = [...document.querySelectorAll('.docs-demo .cb-segmented > .cb-btn')].filter((k) => !k.querySelector(':disabled'));
    const wrong = keys.filter((k) => {
      const on = k.querySelector(':checked'); const cs = getComputedStyle(k);
      return on ? cs.backgroundColor !== selected || cs.boxShadow !== pressed : cs.backgroundColor === selected;
    }).map((k) => k.textContent.trim());
    const covers = keys.every((k) => { const a = k.getBoundingClientRect(); const b = k.querySelector('input').getBoundingClientRect(); return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5; });
    return { keys: keys.length, wrong, covers };
  });
  check(look.wrong.length === 0, 'segmented: checked keys are sunk on the selected tint, others are not', `${look.keys} keys${look.wrong.length ? ', wrong: ' + look.wrong.join(', ') : ''}`);
  check(look.covers, 'segmented: each input covers its key exactly, so the focus ring frames the key');

  // A group of three or more keys, so ArrowRight from a first key needs no wrap-around (WebKit does not wrap).
  const group = page.locator('.docs-demo .cb-segmented[role="radiogroup"]:has(> .cb-btn:nth-child(3))').first();
  const checkedValue = () => group.evaluate((g) => g.querySelector(':checked')?.value);
  const start = await checkedValue();
  await group.locator('.cb-btn:not(:has(:checked))').first().click(); const clicked = await checkedValue();
  await group.locator(':checked').focus(); await page.keyboard.press('ArrowRight'); const arrowed = await checkedValue();
  check(clicked !== start && arrowed !== clicked, 'segmented: a click and the arrow keys move the choice', `${start} -> click ${clicked} -> ArrowRight ${arrowed}`);

  const refused = await page.evaluate(() => {
    const key = document.querySelector('.docs-demo .cb-segmented > .cb-btn:has(> input:disabled:not(:checked))');
    const input = key.querySelector('input'); key.click();
    const fieldset = document.querySelector('.docs-demo fieldset.cb-segmented[disabled]');
    return { keyChecked: input.checked, keyCursor: getComputedStyle(key).cursor,
      fieldsetAll: fieldset ? [...fieldset.querySelectorAll('input')].every((i) => i.matches(':disabled')) : null };
  });
  check(!refused.keyChecked && refused.keyCursor === 'not-allowed' && refused.fieldsetAll !== false, 'segmented: disabled keys and disabled fieldsets refuse a choice', JSON.stringify(refused));

  const multi = await page.$eval('.docs-demo .cb-segmented[role="group"]', (g) => g.querySelectorAll(':checked').length);
  check(multi > 1, 'segmented: a checkbox group keeps several keys on', `${multi} on`);

  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const fill = await page.$eval('.docs-demo .cb-segmented--fill', (g) => {
      const ws = [...g.children].map((k) => k.getBoundingClientRect().width);
      const parent = g.parentElement.getBoundingClientRect().width;
      return { spread: Math.max(...ws) - Math.min(...ws), span: Math.abs(g.getBoundingClientRect().width - parent), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    check(fill.spread <= 1 && fill.span <= 1 && !fill.overflow, `segmented --fill keys share the row equally at ${width}px`, JSON.stringify(fill));
  }

  await sectionShots('segmented');
}

// 17. Details and disclosure: one chevron rule reaches every summary (panels, nav, tree,
//     details): -45deg closed, 45deg open, 0.25rem margin, no native marker. Summary rows are
//     28px (24px compact and inline), stacked blocks share a 1px seam, Enter and Space toggle,
//     a named group keeps one block open, meta sits at the row end, and inline blocks have no
//     frame and line their body up with the summary text.
if (want('details') && await page.locator('.docs-demo .cb-details').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const chevrons = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.docs-demo :is(summary.cb-panel__head, summary.cb-nav__link, [aria-expanded]:not([aria-busy="true"]) > .cb-nav__link, .cb-details > summary):not([dir="rtl"] *)')]
      .filter((r) => r.getClientRects().length);
    const bad = rows.filter((r) => {
      const b = getComputedStyle(r, '::before');
      const open = r.parentElement.matches('details[open], [aria-expanded="true"]');
      return b.rotate !== (open ? '45deg' : '-45deg') || b.marginLeft !== '4px' || !/flex/.test(getComputedStyle(r).display);
    }).map((r) => r.textContent.trim().slice(0, 20));
    return { rows: rows.length, bad };
  });
  check(chevrons.rows > 0 && chevrons.bad.length === 0, 'one chevron rule: every summary row turns -45deg / 45deg with a 0.25rem margin and no marker',
    `${chevrons.rows} rows${chevrons.bad.length ? ', wrong: ' + chevrons.bad.join(' | ') : ''}`);

  const geo = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.docs-demo .cb-details')];
    const heights = blocks.map((d) => {
      const h = Math.round(d.querySelector(':scope > summary').getBoundingClientRect().height);
      const want = d.matches('.cb-details--sm, .cb-details--inline') ? 24 : 28;
      return h === want ? null : `${d.querySelector(':scope > summary').textContent.trim()} ${h}px`;
    }).filter(Boolean);
    const seams = blocks.filter((d) => d.nextElementSibling?.matches('.cb-details') && !d.parentElement.matches('.cb-stack, .cb-grid, .cb-cluster')).map((d) => {
      const gap = d.nextElementSibling.getBoundingClientRect().top - d.getBoundingClientRect().bottom;
      return Math.abs(gap + 1) < 0.5 ? null : `${gap}px`;
    }).filter(Boolean);
    const meta = [...document.querySelectorAll('.docs-demo .cb-details > summary > :is(.cb-badge, .cb-led):last-child')].map((m) => {
      const s = m.parentElement.getBoundingClientRect(); return Math.abs(s.right - parseFloat(getComputedStyle(m.parentElement).paddingRight) - m.getBoundingClientRect().right);
    });
    const inline = document.querySelector('.docs-demo .cb-details--inline');
    const ics = getComputedStyle(inline);
    const text = (() => { const r = document.createRange(); r.selectNodeContents(inline.querySelector('summary').firstChild); return r.getBoundingClientRect().left; })();
    inline.open = true;
    const bodyLeft = inline.querySelector('.cb-details__body').getBoundingClientRect().left + parseFloat(getComputedStyle(inline.querySelector('.cb-details__body')).paddingLeft);
    inline.open = false;
    return { heights, seams, metaOff: Math.max(...meta), inlineFrame: ics.borderTopWidth === '0px' && ics.backgroundColor === 'rgba(0, 0, 0, 0)', align: Math.abs(text - bodyLeft) };
  });
  check(geo.heights.length === 0, 'summary rows are 28px (24px compact and inline)', geo.heights.join(', ') || 'all match');
  check(geo.seams.length === 0, 'stacked details share a 1px seam (outside gap layouts)', geo.seams.join(', ') || 'all seams 1px');
  check(geo.metaOff < 1, 'summary meta sits at the end of the row', `${geo.metaOff.toFixed(2)}px off`);
  check(geo.inlineFrame && geo.align < 1, 'inline details have no frame and their body lines up with the summary text', `frameless ${geo.inlineFrame}, offset ${geo.align.toFixed(2)}px`);

  const named = page.locator('.docs-demo .cb-details[name]');
  const toggled = [];
  const first = named.nth(0).locator('summary'); const second = named.nth(1).locator('summary');
  await first.scrollIntoViewIfNeeded();
  await second.focus(); await page.keyboard.press('Enter');
  const afterEnter = await named.evaluateAll((ds) => ds.map((d) => d.open));
  await page.keyboard.press('Space');
  const afterSpace = await named.evaluateAll((ds) => ds.map((d) => d.open));
  toggled.push(afterEnter.join(), afterSpace.join());
  check(afterEnter[1] && !afterEnter[0] && !afterSpace[1], 'Enter and Space toggle a summary; a named group keeps one block open', `Enter ${afterEnter}, Space ${afterSpace}`);
  await first.click();

  await sectionShots('details');
}

// 18. Modal dialogs: a data-cb-modal button opens its dialog as a modal with focus inside
//     (on the autofocus element when there is one) and the page inert under the backdrop
//     token; Escape closes it and focus returns to the opener; a method="dialog" button
//     reports its value; a typed confirmation refuses a wrong name; widths follow --sm,
//     default and --lg, --danger has a 3px stripe, a long dialog fits the viewport with a
//     scrolling body, and below 40rem a dialog fills the screen.
if (want('dialogs') && await page.locator('.docs-demo [data-cb-modal]').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const backdrop = await page.evaluate(() => { const i = document.body.appendChild(document.createElement('i')); i.style.color = 'var(--cb-bg-backdrop)'; const c = getComputedStyle(i).color; i.remove(); return c; });
  const ids = await page.$$eval('.docs-demo [data-cb-modal]', (bs) => bs.map((b) => b.getAttribute('data-cb-modal')));
  for (const id of ids) {
    const opener = page.locator(`[data-cb-modal="${id}"]`);
    await opener.scrollIntoViewIfNeeded(); await opener.focus(); await page.keyboard.press('Enter');
    const open = await page.evaluate(([i, bd]) => {
      const d = document.getElementById(i); const r = d.getBoundingClientRect(); const cs = getComputedStyle(d);
      const auto = d.querySelector('[autofocus]');
      const body = d.querySelector('.cb-panel__body'); const foot = d.querySelector('.cb-panel__foot').getBoundingClientRect();
      const nav = document.querySelector('.docs-nav__link').getBoundingClientRect();
      const hit = document.elementFromPoint(nav.x + 2, nav.y + 2);
      return { modal: d.matches(':modal'), focusInside: d.contains(document.activeElement), onAutofocus: !auto || document.activeElement === auto,
        backdrop: getComputedStyle(d, '::backdrop').backgroundColor === bd, inert: !hit || !hit.closest('.docs-nav'),
        width: Math.round(r.width), height: r.height, stripe: cs.borderTopWidth, scrolls: body.scrollHeight > body.clientHeight, footIn: foot.bottom <= innerHeight,
        sm: d.classList.contains('cb-dialog--sm'), lg: d.classList.contains('cb-dialog--lg'), danger: d.classList.contains('cb-dialog--danger') };
    }, [id, backdrop]);
    await snap(page, `dialog-${id}.png`);
    const want = open.sm ? 384 : open.lg ? 896 : 576;
    const sized = open.width === want && open.height <= 900 - 48 && open.footIn && (!open.danger || open.stripe === '3px');
    check(open.modal && open.focusInside && open.onAutofocus && open.backdrop && open.inert && sized,
      `dialog #${id} opens as a modal: focus inside, page inert, backdrop token, ${want}px wide`,
      `${open.width}x${Math.round(open.height)}, stripe ${open.stripe}${open.scrolls ? ', body scrolls' : ''}`);
    await page.keyboard.press('Escape');
    const closed = await page.evaluate((i) => ({ open: document.getElementById(i).open, back: document.activeElement?.getAttribute('data-cb-modal') === i }), id);
    check(!closed.open && closed.back, `dialog #${id}: Escape closes it and focus returns to the opener`, JSON.stringify(closed));
  }

  // At least one demo dialog (the long form) must overflow and scroll its body.
  const scrolled = [];
  for (const id of ids) {
    await page.click(`[data-cb-modal="${id}"]`);
    scrolled.push(await page.evaluate((i) => { const b = document.getElementById(i).querySelector('.cb-panel__body'); return b.scrollHeight > b.clientHeight; }, id));
    await page.keyboard.press('Escape');
  }
  check(scrolled.some(Boolean), 'a long dialog scrolls its body between a fixed head and foot', `${scrolled.filter(Boolean).length} of ${scrolled.length} dialogs`);

  const typed = await page.locator('.docs-demo dialog [pattern][required]').first();
  if (await typed.count()) {
    const dialogId = await typed.evaluate((i) => i.closest('dialog').id);
    const pattern = await typed.getAttribute('pattern');
    await page.click(`[data-cb-modal="${dialogId}"]`);
    const danger = page.locator(`#${dialogId} .cb-btn--danger-solid`);
    await danger.click(); const emptyOpen = await page.$eval(`#${dialogId}`, (d) => d.open);
    await typed.fill('gw-wrong'); await danger.click(); const wrongOpen = await page.$eval(`#${dialogId}`, (d) => d.open);
    await typed.fill(pattern); await danger.click();
    const done = await page.$eval(`#${dialogId}`, (d) => ({ open: d.open, value: d.returnValue }));
    await page.click(`[data-cb-modal="${dialogId}"]`); await typed.fill('');
    await page.locator(`#${dialogId} [formnovalidate]`).click();
    const cancelled = await page.$eval(`#${dialogId}`, (d) => ({ open: d.open, value: d.returnValue }));
    check(emptyOpen && wrongOpen && !done.open && done.value === await danger.getAttribute('value') && !cancelled.open && cancelled.value === 'cancel',
      'typed confirmation refuses an empty or wrong name; the right name or Cancel closes it', `empty ${emptyOpen}, wrong ${wrongOpen}, right -> ${done.value}, cancel -> ${cancelled.value}`);
  }

  await page.setViewportSize({ width: 360, height: 900 });
  await page.click(`[data-cb-modal="${ids[0]}"]`);
  const narrow = await page.$eval(`#${ids[0]}`, (d) => { const r = d.getBoundingClientRect(); return { w: r.width, h: r.height, radius: getComputedStyle(d).borderTopLeftRadius }; });
  await snap(page, `dialog-${ids[0]}-360.png`);
  await page.keyboard.press('Escape');
  check(narrow.w === 360 && narrow.h === 900 && narrow.radius === '0px', 'below 40rem a dialog fills the screen', JSON.stringify(narrow));
  await page.setViewportSize({ width: 1360, height: 900 });
}

// 19. Pagination: current page and size keys are sunk and the others are not, keys are 20px
//     high and at least 28px wide, attached strips overlap by 1px and spaced ones keep 4px,
//     disabled arrows have no href and leave the tab order, gap cells are silent and key-high,
//     narrow navs keep only the arrows and the current page (at 360px the wide one too),
//     and the jump field refuses a page above max.
if (want('pagination') && await page.locator('.docs-demo .cb-pagination').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const look = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-selected)'; const selected = getComputedStyle(probe).color;
    probe.style.boxShadow = 'var(--cb-shadow-pressed)'; const pressed = getComputedStyle(probe).boxShadow; probe.remove();
    const keys = [...document.querySelectorAll('.docs-demo :is(.cb-pagination__pages, .cb-pagination__sizes) > .cb-btn')].filter((k) => k.getClientRects().length && k.getAttribute('aria-disabled') !== 'true');
    const wrongSink = keys.filter((k) => { const cs = getComputedStyle(k); const on = k.hasAttribute('aria-current'); return on !== (cs.backgroundColor === selected && cs.boxShadow === pressed); }).map((k) => k.textContent.trim());
    const wrongSize = keys.filter((k) => { const r = k.getBoundingClientRect(); return Math.round(r.height) !== 20 || r.width < 27.5; }).map((k) => k.textContent.trim());
    const strips = [...document.querySelectorAll('.docs-demo :is(.cb-pagination__pages, .cb-pagination__sizes)')].filter((s) => s.getClientRects().length);
    const badGaps = strips.flatMap((s) => {
      const kids = [...s.children].filter((c) => c.getClientRects().length); const spaced = s.closest('.cb-pagination--spaced');
      return kids.slice(1).map((k, i) => k.getBoundingClientRect().left - kids[i].getBoundingClientRect().right).filter((g) => Math.abs(g - (spaced ? 4 : -1)) > 0.5);
    });
    const disabled = [...document.querySelectorAll('.docs-demo .cb-pagination [aria-disabled="true"]')].map((a) => { a.focus(); return { href: a.hasAttribute('href'), tab: document.activeElement === a ? 0 : -1, ink: getComputedStyle(a).color }; });
    probe.style.color = 'var(--cb-text-disabled)'; document.body.append(probe); const muted = getComputedStyle(probe).color; probe.remove();
    const gapsOk = [...document.querySelectorAll('.docs-demo .cb-pagination__gap')].filter((g) => g.getClientRects().length).every((g) => g.getAttribute('aria-hidden') === 'true' && Math.round(g.getBoundingClientRect().height) === 20);
    const shown = (nav) => [...nav.querySelectorAll('.cb-pagination__pages > *')].filter((c) => c.getClientRects().length).map((c) => c.textContent.trim()).join(' ');
    const navs = [...document.querySelectorAll('.docs-demo .cb-pagination')];
    const narrowNav = navs.find((n) => n.closest('.cb-grid')); const wideNav = navs.find((n) => n.closest('.cb-panel__foot'));
    const jump = document.querySelector('.docs-demo .cb-pagination__jump input');
    const old = jump.value; jump.value = String(Number(jump.max) + 1); const over = jump.matches(':invalid'); jump.value = old;
    return { keys: keys.length, wrongSink, wrongSize, badGaps, disabled: disabled.every((d) => !d.href && d.tab === -1 && d.ink === muted) && disabled.length > 0,
      gapsOk, narrow: shown(narrowNav), wide: shown(wideNav), jump: jump.type === 'number' && jump.hasAttribute('min') && jump.hasAttribute('max') && over };
  });
  check(look.wrongSink.length === 0, 'pagination: current page and size keys are sunk, the others are not', `${look.keys} keys${look.wrongSink.length ? ', wrong: ' + look.wrongSink.join(' ') : ''}`);
  check(look.wrongSize.length === 0, 'pagination keys are 20px high and at least 28px wide', look.wrongSize.join(' ') || 'all keys');
  check(look.badGaps.length === 0, 'pagination strips overlap by 1px; spaced strips keep 4px', look.badGaps.join(', ') || 'all seams');
  check(look.disabled, 'disabled arrows have no href, leave the tab order and are muted');
  check(look.gapsOk, 'gap cells are aria-hidden and as high as a key');
  check(look.narrow === '‹ 7 ›' && look.wide.split(' ').length > 3, 'a narrow pagination keeps only the arrows and the current page', `narrow "${look.narrow}", wide "${look.wide}"`);
  check(look.jump, 'the jump field is a number with min and max, and refuses a page above max');

  await page.setViewportSize({ width: 360, height: 900 });
  const at360 = await page.evaluate(() => ({ wide: [...document.querySelector('.docs-demo .cb-panel__foot .cb-pagination__pages').children].filter((c) => c.getClientRects().length).map((c) => c.textContent.trim()).join(' '), overflow: document.documentElement.scrollWidth > innerWidth }));
  check(at360.wide === '‹ 7 ›' && !at360.overflow, 'at 360px the full pagination collapses with no page overflow', JSON.stringify(at360));

  await sectionShots('pagination');
  await page.setViewportSize({ width: 1360, height: 900 });
}

// 20. Utilities: computed values match their tokens, a truncated table cell ellipsises inside
//     its wrapper, long hashes wrap at 360px, hidden text stays in the accessibility tree,
//     the skip link appears on the first Tab, and the code and key chips use their surfaces.
if (want('utilities') && await page.locator('.docs-demo .cb-mono').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const u = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const tok = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
    const t = { muted: tok('--cb-text-muted'), ok: tok('--cb-ok'), warn: tok('--cb-warn'), danger: tok('--cb-danger'), info: tok('--cb-info'), recessed: tok('--cb-bg-recessed'), btn: tok('--cb-bg-btn') };
    probe.style.fontFamily = 'var(--cb-font-mono)'; const mono = getComputedStyle(probe).fontFamily; probe.remove();
    const cs = (sel) => getComputedStyle(document.querySelector(`.docs-demo ${sel}`));
    const kbd = cs('.cb-kbd');
    return {
      mono: cs('.cb-mono').fontFamily === mono && cs('.cb-mono').fontVariantLigatures === 'none',
      num: cs('.cb-num').fontVariantNumeric === 'tabular-nums',
      tones: cs('.cb-muted').color === t.muted && cs('.cb-text-ok').color === t.ok && cs('.cb-text-warn').color === t.warn && cs('.cb-text-danger').color === t.danger && cs('.cb-text-info').color === t.info,
      xs: cs('.cb-text-xs').fontSize === '12px',
      chips: cs('.cb-code').backgroundColor === t.recessed && kbd.backgroundColor === t.btn && kbd.boxShadow !== 'none',
      nowrap: (() => { const n = document.querySelector('.docs-demo .cb-nowrap'); return n.getClientRects().length === 1; })(),
    };
  });
  check(u.mono && u.num && u.tones && u.xs, 'text utilities match their tokens (mono, tabular, tones, 12px)', JSON.stringify({ mono: u.mono, num: u.num, tones: u.tones, xs: u.xs }));
  check(u.chips && u.nowrap, '.cb-code and .cb-kbd use their surfaces; .cb-nowrap stays on one line', JSON.stringify({ chips: u.chips, nowrap: u.nowrap }));

  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const w = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.docs-demo td.cb-truncate')];
      const long = cells.reduce((a, c) => (c.scrollWidth - c.clientWidth > a.scrollWidth - a.clientWidth ? c : a));
      const table = long.closest('table'); const wrap = table.closest('.cb-table-wrap');
      return { cut: long.scrollWidth > long.clientWidth, ellipsis: getComputedStyle(long).textOverflow === 'ellipsis', fits: table.getBoundingClientRect().width <= wrap.clientWidth + 0.5,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const ok = w.ellipsis && w.fits && !w.overflow && (width === 1360 || w.cut);
    check(ok, `truncated cells ellipsise inside their wrapper, long hashes wrap (${width}px)`, JSON.stringify(w));
  }
  await page.setViewportSize({ width: 1360, height: 900 });

  const hidden = await page.evaluate(() => [...document.querySelectorAll('.docs-demo .cb-sr-only')].every((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return cs.display !== 'none' && r.width <= 1 && r.height <= 1 && cs.clipPath !== 'none';
  }));
  const named = await page.getByRole('table', { name: 'Gateways and their load' }).count();
  const button = await page.getByRole('button', { name: 'Refresh gateways' }).count();
  check(hidden && named === 1 && button === 1, '.cb-sr-only text is invisible but names the table and the icon key', JSON.stringify({ hidden, named, button }));

  // The skip link is judged on a fresh page: the first Tab of a new document.
  const ps = await context.newPage(); await applyOverrides(ps); await ps.goto(pathToFileURL(page_path).href);
  const before = await ps.$eval('.cb-skip-link', (a) => a.getBoundingClientRect().bottom);
  await ps.keyboard.press(TAB);
  const skip = await ps.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { cls: a.className, top: r.top, bottom: r.bottom }; });
  await ps.close();
  check(before < 0 && skip.cls === 'cb-skip-link' && skip.top >= 0 && skip.bottom <= 900, 'the skip link is off screen until the first Tab, then visible', `rest bottom ${before}, focused top ${skip.top}`);

  await sectionShots('utilities');
  await page.setViewportSize({ width: 1360, height: 900 });
}

// 23. Application frame (a page whose body holds a .cb-app, such as docs/example.html): at
//     1360 the shell fills the viewport with the top and status bars in view and main as its own
//     scroller; at 360 the sidebar stacks above main and the page scrolls; a sticky table keeps
//     its first column while its wrapper scrolls sideways.
if (want('frame') && await page.locator('body > .cb-app').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const wide = await page.evaluate(() => {
    const app = document.querySelector('body > .cb-app'); const r = (sel) => app.querySelector(sel).getBoundingClientRect();
    return { app: Math.round(app.getBoundingClientRect().height), top: r('.cb-app__top').top, status: Math.round(r('.cb-app__status').bottom),
      main: getComputedStyle(app.querySelector('.cb-app__main')).overflowY, page: document.documentElement.scrollHeight - innerHeight };
  });
  check(wide.app === 900 && wide.top === 0 && wide.status === 900 && wide.main === 'auto' && wide.page <= 0,
    'application frame at 1360px: fills the viewport, bars in view, main scrolls on its own', JSON.stringify(wide));
  await page.setViewportSize({ width: 360, height: 900 });
  const narrow = await page.evaluate(() => {
    const app = document.querySelector('body > .cb-app'); const r = (sel) => app.querySelector(sel).getBoundingClientRect();
    return { page: document.documentElement.scrollHeight > innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check(narrow.page && !narrow.overflow, 'application frame at 360px: the page scrolls, no overflow', JSON.stringify(narrow));
  // Below 50rem the sidebar folds away behind the top bar's Menu key; the key opens it between
  // the top bar and main and closes it again. Wide, the key is hidden and the sidebar shows.
  const toggle = page.locator('body > .cb-app > .cb-app__top [data-cb-toggle]');
  if (await toggle.count()) {
    const fold = () => page.evaluate(() => {
      const app = document.querySelector('body > .cb-app'); const side = app.querySelector('.cb-app__side'); const key = app.querySelector('.cb-app__top [data-cb-toggle]');
      return { side: side.getClientRects().length > 0, below: side.getBoundingClientRect().top >= app.querySelector('.cb-app__top').getBoundingClientRect().bottom - 0.5,
        above: side.getBoundingClientRect().bottom <= app.querySelector('.cb-app__main').getBoundingClientRect().top + 0.5,
        key: key.getClientRects().length > 0, expanded: key.getAttribute('aria-expanded'), sunk: getComputedStyle(key).boxShadow !== getComputedStyle(app.querySelector('.cb-app__top .cb-btn:not([data-cb-toggle])') ?? key).boxShadow };
    });
    // The key's look changes over --cb-duration (50ms); read it after that.
    const settle = () => page.waitForTimeout(120);
    const closed = await fold(); await toggle.click(); await settle(); const opened = await fold(); await toggle.click(); await settle(); const again = await fold();
    check(!closed.side && closed.key && closed.expanded === 'false' && opened.side && opened.below && opened.above && opened.expanded === 'true' && opened.sunk && !again.side,
      'application frame at 360px: the sidebar folds behind the Menu key, which opens it above main and closes it', JSON.stringify({ closed, opened, again }));
    await page.setViewportSize({ width: 1360, height: 900 });
    const wide = await fold();
    check(wide.side && !wide.key, 'application frame at 1360px: the Menu key is hidden and the sidebar shows', JSON.stringify(wide));
    // Without the script the key stays hidden and the sidebar stacks above main.
    const noJs = await browser.newContext({ ...contextOptions, viewport: { width: 360, height: 900 }, javaScriptEnabled: false });
    const pn = await noJs.newPage(); await applyOverrides(pn); await pn.goto(pathToFileURL(page_path).href);
    const plain = await pn.evaluate(() => {
      const app = document.querySelector('body > .cb-app'); const r = (sel) => app.querySelector(sel).getBoundingClientRect();
      return { key: app.querySelector('.cb-app__top [data-cb-toggle]').getClientRects().length > 0, stacked: r('.cb-app__side').height > 0 && r('.cb-app__side').bottom <= r('.cb-app__main').top + 1 };
    });
    await noJs.close();
    check(!plain.key && plain.stacked, 'application frame at 360px without the script: no Menu key, the sidebar stacked above main', JSON.stringify(plain));
    await page.setViewportSize({ width: 360, height: 900 });
  }
  const sticky = page.locator('body > .cb-app .cb-table--sticky').first();
  if (await sticky.count()) {
    await expose(page, 'body > .cb-app .cb-table--sticky');
    await sticky.scrollIntoViewIfNeeded();
    const pinned = await sticky.evaluate((t) => {
      const wrap = t.closest('.cb-table-wrap'); const cell = t.querySelector('tbody tr > :nth-child(2)');
      const before = cell.getBoundingClientRect().left; wrap.scrollLeft = wrap.scrollWidth; const after = cell.getBoundingClientRect().left;
      const moved = wrap.scrollLeft; wrap.scrollLeft = 0; return { before, after, moved };
    });
    check(pinned.moved > 0 && Math.abs(pinned.before - pinned.after) < 1, 'application frame: the sticky table keeps its pinned column at 360px', JSON.stringify(pinned));
  }
  for (const width of saving ? [1360, 800, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await snap(page, `example-${width}.png`);
  }
  await page.setViewportSize({ width: 1360, height: 900 });
}

// 24. Density: inside [data-cb-density] (and at the default) fields and keys take
//     --cb-control-h, small keys --cb-control-h-sm, table rows --cb-row-h, a small key fits
//     its row, and panel heads take --cb-row-h plus --cb-space-1: 22 / 18 / 24 / 26 compact,
//     26 / 20 / 28 / 32 default, 30 / 24 / 32 / 38 comfortable.
if (want('density') && await page.locator('.docs-demo [data-cb-density]').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const sizes = { compact: [22, 18, 24, 26], default: [26, 20, 28, 32], comfortable: [30, 24, 32, 38] };
  const panels = await page.$$eval('.docs-demo .cb-grid:has([data-cb-density]) > .cb-panel', (ps) => ps.map((p) => {
    const h = (sel) => Math.round(p.querySelector(sel).getBoundingClientRect().height);
    const row = p.querySelector('tbody tr'); const key = row.querySelector('.cb-btn--sm');
    return { mode: p.getAttribute('data-cb-density') ?? 'default', head: h(':scope > .cb-panel__head'), field: h('.cb-input'), segment: h('.cb-segmented > .cb-btn'),
      small: h('.cb-panel__head .cb-btn--sm'), row: Math.round(row.getBoundingClientRect().height),
      fits: key.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom && key.getBoundingClientRect().top >= row.getBoundingClientRect().top };
  }));
  for (const d of panels) {
    const [control, small, row, head] = sizes[d.mode];
    check(d.field === control && d.segment === control && d.small === small && d.row === row && d.fits && d.head === head,
      `density ${d.mode}: controls ${control}px, small keys ${small}px, rows ${row}px with the key inside, panel head ${head}px`,
      `field ${d.field}, segment ${d.segment}, small ${d.small}, row ${d.row}, key fits ${d.fits}, head ${d.head}`);
  }
}

// 21. Keyboard audit: Tab from the top of a fresh page through every stop until focus leaves
//     the page. Each stop must show the indicator (on a tree item, on its row label), and the
//     ring, grown by its width and offset, must lie inside the viewport and inside every
//     clipping ancestor; a stop that repeats before the end is a trap. Browsers do not scroll a
//     partly visible control further on Tab, so a control may stay partly scrolled out of a
//     container or the viewport (allowed by WCAG 2.4.11 as long as it is not hidden entirely);
//     those stops are listed, not failed. A fully shown control with a cut ring fails.
//     Date and time fields take several Tab presses (one per segment) while focus stays on the
//     same element, so a repeat of such a field walks on instead of ending the audit.
for (const width of want('keyboard') ? [1360, 360] : []) {
  const pa = await context.newPage(); await applyOverrides(pa);
  await pa.setViewportSize({ width, height: 900 }); await pa.goto(pathToFileURL(page_path).href);
  const seen = new Set(); const invisible = []; const clipped = []; const partly = []; let stops = 0; let trap = ''; let lastId = ''; let segments = 0;
  for (let i = 0; i < 3000; i++) {
    await pa.keyboard.press(TAB);
    // Firefox and WebKit scroll to the focused control a frame later; measure after it.
    await pa.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const measure = () => pa.evaluate((segmented) => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      if (!el.dataset.vbStop) el.dataset.vbStop = String(document.querySelectorAll('[data-vb-stop]').length);
      const target = el.matches('[data-cb-tree] [role="treeitem"]') ? el.querySelector(':scope > .cb-nav__link') : el;
      const cs = getComputedStyle(target);
      const w = parseFloat(cs.outlineWidth); const grow = w + parseFloat(cs.outlineOffset);
      const r = target.getBoundingClientRect();
      const ring = { l: r.left - grow, t: r.top - grow, r: r.right + grow, b: r.bottom + grow };
      const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}"`;
      const visible = (el.matches(':focus-visible') || (el.matches(segmented) && el.matches(':focus'))) && cs.outlineStyle !== 'none' && w >= 2;
      let clip = ''; let partial = '';
      // The ring must fit wherever the control itself is fully shown. A control partly scrolled
      // out (of a scroller or of the viewport) is reported; one hidden entirely, or a whole control
      // with a cut ring, fails.
      const inside = (box, label, scrolls = false) => {
        if (!(ring.l < box.l - 0.5 || ring.t < box.t - 0.5 || ring.r > box.r + 0.5 || ring.b > box.b + 0.5)) return;
        if (partial) return; // outer clipping follows from the scroll position already reported
        const seen = r.right > box.l && r.left < box.r && r.bottom > box.t && r.top < box.b;
        const whole = r.left >= box.l - 0.5 && r.top >= box.t - 0.5 && r.right <= box.r + 0.5 && r.bottom <= box.b + 0.5;
        const by = Math.max(box.l - ring.l, box.t - ring.t, ring.r - box.r, ring.b - box.b).toFixed(1);
        if (scrolls && seen && !whole) partial = label; else clip ||= `${label} (${by}px)`;
      };
      for (let n = target.parentElement; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n);
        if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
        const b = n.getBoundingClientRect();
        const scroller = n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1;
        inside({ l: b.left + n.clientLeft, t: b.top + n.clientTop, r: b.left + n.clientLeft + n.clientWidth, b: b.top + n.clientTop + n.clientHeight },
          n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/)[0] : n.tagName.toLowerCase(), scroller);
      }
      // A control taller or wider than the viewport cannot show its whole ring; judge the rest.
      if (ring.b - ring.t <= innerHeight && ring.r - ring.l <= innerWidth) inside({ l: 0, t: 0, r: innerWidth, b: innerHeight }, 'viewport', true);
      return { id: el.dataset.vbStop, name, visible, clip, partial, segmented: el.matches(segmented) };
    }, SEGMENTED);
    let stop = await measure();
    // Under load an engine can scroll to the control later still (seen in WebKit with three runs
    // side by side, up to a quarter of a second and more): a stop the viewport cuts is measured
    // again, for up to a second, before it counts.
    for (let tries = 0; stop?.clip.includes('viewport') && tries < 20; tries++) { await pa.waitForTimeout(50); stop = await measure(); }
    if (!stop) break;
    // The next segment of a date or time field (at most 8): keep walking.
    if (stop.id === lastId && stop.segmented && segments < 8) { segments++; continue; }
    // Back at the first stop, or still on the last one (focus could not move on): the end.
    if (seen.has(stop.id)) { if (stop.id !== '0' && stop.id !== lastId) trap = stop.name; break; }
    lastId = stop.id; segments = 0;
    seen.add(stop.id); stops++;
    if (!stop.visible) invisible.push(stop.name);
    if (stop.clip) clipped.push(`${stop.name} by ${stop.clip}`);
    else if (stop.partial) partly.push(`${stop.name} in ${stop.partial}`);
  }
  await pa.close();
  check(stops >= 5 && !trap && invisible.length === 0, `keyboard audit at ${width}px: every Tab stop shows the focus ring, no trap`,
    `${stops} stops${trap ? `, trap at ${trap}` : ''}${invisible.length ? `; no ring: ${invisible.slice(0, 5).join(' | ')}` : ''}`);
  // Firefox and WebKit apply scroll-margin only when Tab has to scroll; a control already fully in view
  // at the viewport edge keeps a ring cut by at most the ring itself (3px). Those are listed, not failed.
  const edge = engine !== 'chromium' ? clipped.filter((c) => /by viewport \((\d+(?:\.\d+)?)px\)$/.test(c) && Number(c.match(/\((\d+(?:\.\d+)?)px\)$/)[1]) <= 4) : [];
  clipped.splice(0, clipped.length, ...clipped.filter((c) => !edge.includes(c)));
  if (edge.length) partly.push(...edge.map((c) => `${c} [${engine}: no scroll-margin when already in view]`));
  check(clipped.length === 0, `keyboard audit at ${width}px: no focus ring is clipped`,
    `${partly.length ? `${partly.length} partly scrolled out (${partly.join(' | ')})` : 'none partly scrolled out'}${clipped.length ? `; clipped: ${clipped.slice(0, 6).join(' | ')}${clipped.length > 6 ? ` (+${clipped.length - 6})` : ''}` : ''}`);
}

// 22. The catalogue's contrast table (generated from scripts/contrast-pairs.mjs) matches the
//     live ratios row for row, so a token change cannot leave it stale.
const docRows = !want('contrast') ? [] : await page.$$eval('#a11y-contrast-table tbody tr', (rows) => rows.map((r) => [...r.children].map((c) => c.textContent.trim())));
if (docRows.length) {
  const stale = measured.flatMap((m, i) => {
    const row = docRows[i];
    if (!row) return [`missing row for ${label(m.fg)} on ${label(m.bg)}`];
    const same = row[0] === label(m.fg) && row[1] === label(m.bg) && Math.abs(Number(row[2]) - m.ratio) <= 0.01 && row[3] === `≥ ${m.need}`;
    return same ? [] : [`${row.slice(0, 4).join(' ')} vs live ${label(m.fg)} ${label(m.bg)} ${m.ratio.toFixed(2)}`];
  });
  if (docRows.length !== measured.length) stale.push(`${docRows.length} rows for ${measured.length} pairs`);
  check(stale.length === 0, 'the catalogue contrast table matches the live ratios', stale.slice(0, 3).join(' | ') || `${docRows.length} rows`);
}

// 24. Catalogue snippets: highlighted, numbered, white, collapsed by default, scrolling past 20 lines,
//     and copied whole by click or key. A mouse selection is left to the browser's own Ctrl+C.
const snippets = want('snippets') ? await page.locator('pre.docs-snippet').count() : 0;
if (snippets) {
  const ps = await context.newPage(); await applyOverrides(ps); await ps.goto(pathToFileURL(page_path).href);
  const frames = await ps.$$eval('details.docs-code', (els) => els.map((e) => e.open));
  check(frames.length === snippets && frames.every((o) => !o), 'every catalogue snippet sits in a frame that starts collapsed', `${frames.length} frames, ${frames.filter(Boolean).length} open`);

  const bare = await ps.$$eval('pre.docs-snippet', (els) => els.filter((e) => !e.querySelector('.token') || !e.hasAttribute('data-docs-copy') || e.getAttribute('tabindex') !== '0' || e.querySelector('code[tabindex]')).length);
  check(bare === 0, 'every catalogue snippet is highlighted, clickable and has one Tab stop (the block)', `${bare} of ${snippets} are not`);

  const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
  const painted = await ps.evaluate(() => {
    const pre = document.querySelector('pre.docs-snippet');
    const rows = pre.querySelector('.line-numbers-rows');
    const out = { bg: getComputedStyle(pre).backgroundColor, gutter: [getComputedStyle(rows).color, getComputedStyle(rows).backgroundColor], kinds: {} };
    for (const k of ['tag', 'attr-name', 'attr-value', 'punctuation']) {
      const t = pre.querySelector(`.token.${k}`); if (t) out.kinds[k] = getComputedStyle(t).color;
    }
    return out;
  });
  const weak = Object.entries(painted.kinds).filter(([, c]) => ratio(rgb(c), rgb(painted.bg)) < 4.5).map(([k]) => k);
  check(Object.keys(painted.kinds).length === 4 && weak.length === 0, 'snippet token colours reach 4.5:1 on the snippet background', weak.join(', ') || Object.keys(painted.kinds).join(', '));
  const gutter = ratio(rgb(painted.gutter[0]), rgb(painted.gutter[1]));
  check(gutter >= 4.5, 'snippet line numbers reach 4.5:1 on the gutter', gutter.toFixed(2));
  check(painted.bg === 'rgb(255, 255, 255)', 'snippet background is white', painted.bg);

  // Frames: summary opens and closes by pointer and by key; the hint shows only while open.
  const sizes = await ps.$$eval('details.docs-code', (els) => els.map((e) => +e.querySelector('.docs-code__meta').textContent.match(/\d+/)[0]));
  const longAt = sizes.findIndex((n) => n > 40), shortAt = sizes.findIndex((n) => n < 10);
  const frame = ps.locator('details.docs-code').nth(longAt);
  const summary = frame.locator('summary');
  await frame.scrollIntoViewIfNeeded();
  const hintClosed = await frame.locator('.docs-code__hint').isVisible();
  await summary.click();
  const openByClick = await frame.evaluate((e) => e.open);
  const hintOpen = await frame.locator('.docs-code__hint').isVisible();
  await summary.focus(); await ps.keyboard.press('Enter');
  const closedByEnter = await frame.evaluate((e) => !e.open);
  await ps.keyboard.press('Space');
  const openBySpace = await frame.evaluate((e) => e.open);
  check(openByClick && closedByEnter && openBySpace && !hintClosed && hintOpen, 'a snippet frame opens and closes by click, Enter and Space; its hint shows only when open',
    `click ${openByClick}, Enter ${closedByEnter}, Space ${openBySpace}, hint closed/open ${hintClosed}/${hintOpen}`);

  // Scroll: a long block stops at 20 lines and scrolls, a short one shows whole; the gutter holds still sideways.
  const pre = frame.locator('pre');
  const code = pre.locator('code');
  const lineH = await code.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
  const geo = await pre.evaluate((e) => ({ ch: e.clientHeight, sh: e.scrollHeight, rows: e.querySelector('.line-numbers-rows').children.length }));
  const lines = (await code.evaluate((e) => e.textContent)).replace(/\n$/, '').split('\n').length;
  check(geo.sh > geo.ch && Math.abs(geo.ch - (20 * lineH + 2 * 8)) <= 2, `a ${lines}-line snippet stops at 20 lines and scrolls`, `client ${geo.ch}px, content ${geo.sh}px, line ${lineH}px`);
  check(geo.rows === lines, 'a snippet shows one line number per line', `${geo.rows} numbers, ${lines} lines`);
  const wide = await pre.evaluate((e) => { e.scrollLeft = 60; e.scrollTop = 100; const g = e.querySelector('.line-numbers-rows').getBoundingClientRect(); return [Math.abs(g.left - e.getBoundingClientRect().left) < 2 && e.scrollLeft > 0, e.scrollTop > 0]; });
  check(wide[0] && wide[1], 'the line-number gutter stays at the left edge while the code scrolls', `sideways ${wide[0]}, down ${wide[1]}`);
  await snap(frame, 'snippet-long.png');
  await pre.evaluate((e) => { e.scrollLeft = 0; e.scrollTop = 0; });
  const short = ps.locator('details.docs-code').nth(shortAt);
  await short.locator('summary').click();
  const flat = await short.locator('pre').evaluate((e) => e.scrollHeight <= e.clientHeight);
  check(flat, 'a short snippet is shown whole, without a scroll bar');
  await snap(short, 'snippet-short.png');

  // Pointer: no highlight on hover.
  const look = (e) => { const c = getComputedStyle(e); return `${c.backgroundColor}|${c.borderColor}|${c.boxShadow}`; };
  const rest = await pre.evaluate(look);
  await pre.hover();
  check(await pre.evaluate(look) === rest, 'a snippet does not change under the pointer');

  const text = await code.evaluate((e) => e.textContent);
  await ps.evaluate(() => navigator.clipboard.writeText('stale').catch(() => {}));
  const box = await pre.boundingBox();
  await ps.mouse.click(box.x + box.width - 30, box.y + box.height - 30);
  await ps.waitForTimeout(100);
  const got = await readClipboard(ps);
  check(got === text, 'clicking a snippet reaches the clipboard whole, without line numbers', got === null ? 'clipboard unreadable' : got === text ? '' : 'MISMATCH');
  const hint = await frame.locator('.docs-code__hint').textContent();
  check(await frame.evaluate((e) => e.hasAttribute('data-docs-copied')) && hint === 'Copied' && /copied/i.test(await ps.evaluate(() => document.querySelector('[role="status"][data-cb-sr]')?.textContent ?? '')),
    'a snippet confirms the copy in its header and in the live region', `hint "${hint}"`);

  await ps.evaluate(() => navigator.clipboard.writeText('stale').catch(() => {}));
  await ps.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el.querySelector('code .token')); getSelection().removeAllRanges(); getSelection().addRange(r); }, await pre.elementHandle());
  const before = await readClipboard(ps);
  await pre.evaluate((e) => e.click());
  await ps.waitForTimeout(100);
  check(await readClipboard(ps) === before, 'a click with text selected inside the snippet does not copy', 'selection kept for Ctrl+C');

  await ps.evaluate(() => { getSelection().removeAllRanges(); navigator.clipboard.writeText('stale').catch(() => {}); });
  await pre.focus();
  await ps.keyboard.press('Enter');
  await ps.waitForTimeout(100);
  check(await readClipboard(ps) === text, 'Enter on a focused snippet reaches the clipboard whole');
  await snap(pre, 'snippet-focus.png');
  await ps.setViewportSize({ width: 360, height: 800 });
  const over = await ps.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(over <= 0, 'snippets do not widen the page at 360px', `${over}px`);
  await ps.close();
}

// 25. Native form controls, on a fixture appended to a fresh tab, so the stylesheet is tested
//     whatever the page documents: every single-line input type and the select, at both sizes
//     and in every density, against probes sized by that density's own tokens; plus readonly
//     fields and list boxes once.
if (want('forms')) {
  const TYPES = { text: 'gw-eu-1', password: 'secret', search: 'peer', email: 'soc@corp.example.net', url: 'https://idp.corp.example.net',
    tel: '+1 555 0100', number: '51820', date: '2026-11-01', time: '23:30', 'datetime-local': '2026-11-01T23:30', month: '2026-11', week: '2026-W44', file: '', color: '#1e4b85' };
  const pf = await context.newPage(); await applyOverrides(pf);
  await pf.setViewportSize({ width: 1360, height: 900 });
  await pf.goto(pathToFileURL(page_path).href);
  await pf.evaluate((types) => {
    const fields = (sm) => Object.entries(types).map(([t, v]) =>
      `<input class="cb-input${sm ? ' cb-input--sm' : ''}" type="${t}"${v ? ` value="${v}"` : ''} aria-label="${t}${sm ? '--sm' : ''}">`).join('')
      + `<select class="cb-select${sm ? ' cb-select--sm' : ''}" aria-label="select${sm ? '--sm' : ''}"><option>Operator</option></select>`;
    const density = (d) => `<div data-vb-density="${d}"${d === 'default' ? '' : ` data-cb-density="${d}"`}>`
      + `<div data-vb-size="md"><i data-vb-probe></i>${fields(false)}</div><div data-vb-size="sm"><i data-vb-probe></i>${fields(true)}</div></div>`;
    const roles = (attrs) => `<select class="cb-select" multiple size="4" aria-label="roles"${attrs}><option selected>admin</option><option>auditor</option><option selected>operator</option><option>viewer</option></select>`;
    const box = document.createElement('section');
    box.setAttribute('data-vb-forms', '');
    box.innerHTML = '<style>[data-vb-forms] { display: grid; gap: 8px; padding: 8px; background: var(--cb-bg-canvas); }'
      + '[data-vb-forms] :is([data-vb-size], [data-vb-extras]) { display: grid; grid-template-columns: repeat(7, 11rem); gap: 4px; align-items: start; }'
      + '[data-vb-probe] { inline-size: 1px; } [data-vb-size="md"] > [data-vb-probe] { block-size: var(--cb-control-h); }'
      + '[data-vb-size="sm"] > [data-vb-probe] { block-size: var(--cb-control-h-sm); }</style>'
      + ['compact', 'default', 'comfortable'].map(density).join('')
      + `<div data-vb-extras><select class="cb-select" readonly aria-label="select readonly"><option>Operator</option></select>`
      + `<input class="cb-input" type="text" readonly value="3f9c2a71" aria-label="input readonly">${roles('')}${roles(' disabled')}`
      + '<input class="cb-input" type="text" aria-disabled="true" readonly value="ou=staff" aria-label="input aria-disabled">'
      + '<div class="cb-input-group"><input class="cb-input" type="number" disabled value="25" aria-label="group disabled"><span class="cb-input-group__addon">s</span></div>'
      + '<div class="cb-input-group"><select class="cb-select" aria-disabled="true" aria-label="select aria-disabled"><option>Operator</option></select><span class="cb-input-group__addon">role</span></div>'
      + ['invalid', 'valid'].map((g) => `<fieldset class="cb-fieldset" data-vb-group="${g}"><legend>Roles</legend>`
        + `<label class="cb-choice"><input class="cb-check" type="checkbox"${g === 'invalid' ? ' aria-invalid="true"' : ''}>Viewer</label>`
        + '<p class="cb-field__error">Choose at least one role.</p></fieldset>').join('')
      + '<div class="cb-input-group"><input class="cb-input" type="text" aria-busy="true" value="ou=staff" aria-label="input busy">'
      + '<span class="cb-input-group__addon" aria-busy="true">Checking</span></div></div>';
    document.body.append(box);
  }, TYPES);
  const matrix = await pf.$$eval('[data-vb-density]', (ds) => ds.map((d) => ({
    density: d.getAttribute('data-vb-density'),
    sizes: [...d.querySelectorAll('[data-vb-size]')].map((s) => ({
      size: s.getAttribute('data-vb-size'),
      probe: s.querySelector('[data-vb-probe]').getBoundingClientRect().height,
      fields: [...s.querySelectorAll('.cb-input, .cb-select')].map((f) => ({
        name: f.getAttribute('aria-label'), h: Math.round(f.getBoundingClientRect().height * 10) / 10,
        num: getComputedStyle(f).fontVariantNumeric,
      })),
    })),
  })));
  const everyField = matrix.flatMap((d) => d.sizes.flatMap((s) => s.fields));
  const proportional = [...new Set(everyField.filter((f) => !f.num.includes('tabular-nums')).map((f) => f.name))];
  check(proportional.length === 0, 'native fields use tabular figures',
    proportional.length ? `proportional: ${proportional.join(', ')}` : `${everyField.length} fields`);
  for (const d of matrix) {
    const off = d.sizes.flatMap((s) => s.fields.filter((f) => Math.abs(f.h - s.probe) >= 0.5).map((f) => `${f.name} ${f.h}`));
    check(off.length === 0, `native fields take the control height (${d.density})`,
      `${d.sizes.map((s) => `${s.size} ${s.probe}px`).join(', ')}${off.length ? `; off: ${off.join(', ')}` : ''}`);
  }
  // A colour field is as wide as two control heights, at both sizes and in every density.
  const colours = await pf.$$eval('[data-vb-density] input[type="color"]', (cs) => cs.map((c) => {
    const r = c.getBoundingClientRect(); return { name: `${c.closest('[data-vb-density]').getAttribute('data-vb-density')} ${c.getAttribute('aria-label')}`, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  }));
  const wrong = colours.filter((c) => Math.abs(c.w - 2 * c.h) >= 0.5);
  check(colours.length > 0 && !wrong.length, 'colour fields are two control heights wide', wrong.map((c) => `${c.name} ${c.w}x${c.h}`).join(', ') || `${colours.length} fields`);
  // The file key is an engine pseudo-element; its computed box is readable in every engine.
  const keys = await pf.$$eval('[data-vb-density] input[type="file"]', (fs) => fs.map((f) => {
    const k = getComputedStyle(f, '::file-selector-button');
    const line = k.lineHeight === 'normal' ? parseFloat(k.fontSize) * 1.2 : parseFloat(k.lineHeight);
    const inner = parseFloat(k.blockSize) - parseFloat(k.borderTopWidth) - parseFloat(k.borderBottomWidth);
    return { name: `${f.closest('[data-vb-density]').getAttribute('data-vb-density')} ${f.getAttribute('aria-label')}`, line, inner };
  }));
  const cut = keys.filter((k) => k.line > k.inner + 0.01);
  check(keys.length === 6 && cut.length === 0, 'the file key label fits its key in every size and density',
    cut.length ? cut.map((k) => `${k.name}: ${k.line}px line in ${k.inner}px`).join(', ') : `${keys.length} keys`);
  // List boxes: the checked row of a resting list (no hover, no focus; a focused list takes the
  // system highlight in every engine) is read on pixels near its end edge, away from the text.
  const want = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-selected)'; const c = getComputedStyle(probe).color; probe.remove();
    return c.match(/\d+/g).slice(0, 3).map(Number);
  });
  const lists = pf.locator('[data-vb-extras] select[multiple]');
  const rows = [];
  for (const [i, state] of ['enabled', 'disabled'].entries()) {
    const list = lists.nth(i); await list.scrollIntoViewIfNeeded();
    const geo = await list.evaluate((s) => {
      const cs = getComputedStyle(s); const r = s.getBoundingClientRect();
      return { w: r.width, h: r.height, top: parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop), end: parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight) };
    });
    const px = await (await pixelsOf(list))((geo.w - geo.end - 4) / geo.w, (geo.top + 4) / geo.h);
    rows.push({ state, px, off: Math.hypot(px[0] - want[0], px[1] - want[1], px[2] - want[2]) });
  }
  check(rows.every((r) => r.off < 8), 'selected options in a multi-select take the selected tint (enabled and disabled)',
    `${rows.map((r) => `${r.state} ${r.px.join(',')}`).join('; ')} vs ${want.join(',')}`);
  // Engine keys (number spin buttons, the search clear key) show on hover or focus in some
  // engines and always in others: hovered and focused, the band before the end padding holds no
  // dark pixel. Escape is the remaining way to clear a search field.
  const engineKeys = [];
  for (const type of ['number', 'search']) {
    const field = pf.locator(`[data-vb-density="default"] [data-vb-size="md"] [aria-label="${type}"]`);
    await field.scrollIntoViewIfNeeded(); await field.hover(); await field.focus();
    const geo = await field.evaluate((f) => { const cs = getComputedStyle(f); return { w: f.offsetWidth, h: f.offsetHeight, end: parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight) }; });
    const png = (await field.screenshot()).toString('base64');
    const dark = await page.evaluate(async ([b64, g]) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
      const sx = img.width / g.w; const x0 = Math.floor((g.w - g.end - 20) * sx); const x1 = Math.floor((g.w - g.end) * sx);
      const d = ctx.getImageData(x0, Math.floor(3 * sx), x1 - x0, Math.floor((g.h - 6) * sx)).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 600) n++;
      return n;
    }, [png, geo]);
    engineKeys.push(`${type} ${dark}`);
  }
  check(engineKeys.every((k) => k.endsWith(' 0')), 'number and search fields show no engine keys', `dark pixels in the end band: ${engineKeys.join(', ')}`);
  const search = pf.locator('[data-vb-density="default"] [data-vb-size="md"] [aria-label="search"]');
  await search.focus(); await pf.keyboard.press('Escape');
  const left = await search.inputValue();
  check(left === '', 'Escape clears a search field', JSON.stringify(left));
  // Date and time fields reached with Tab show the standard ring (walking the segments of the
  // fields before them).
  const unringed = [];
  for (const type of ['date', 'time', 'datetime-local', 'month', 'week']) {
    await pf.locator('[data-vb-density="default"] [data-vb-size="md"] [aria-label="number"]').focus();
    let ring = null;
    for (let i = 0; i < 24 && ring === null; i++) {
      await pf.keyboard.press(TAB);
      ring = await pf.evaluate(([t, seg]) => {
        const el = document.activeElement;
        if (el?.getAttribute('aria-label') !== t) return null;
        const cs = getComputedStyle(el);
        return (el.matches(':focus-visible') || (el.matches(seg) && el.matches(':focus'))) && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
      }, [type, SEGMENTED]);
    }
    if (!ring) unringed.push(`${type}${ring === null ? ' (not reached)' : ''}`);
  }
  check(unringed.length === 0, 'date and time fields show the focus ring when tabbed to', unringed.join(', ') || '5 types');
  // <select> ignores readonly, so it must not look locked; inputs keep the recessed mono look.
  const readonly = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-bg-raised)'; const raised = getComputedStyle(probe).color;
    probe.style.color = 'var(--cb-bg-recessed)'; const recessed = getComputedStyle(probe).color; probe.remove();
    const look = (sel) => { const cs = getComputedStyle(document.querySelector(sel)); return { bg: cs.backgroundColor, mono: /mono/i.test(cs.fontFamily.split(',')[0]) }; };
    return { raised, recessed, select: look('[aria-label="select readonly"]'), input: look('[aria-label="input readonly"]') };
  });
  check(readonly.select.bg === readonly.raised && !readonly.select.mono && readonly.input.bg === readonly.recessed && readonly.input.mono,
    'the readonly look stays off <select>, which ignores readonly', JSON.stringify({ select: readonly.select, input: readonly.input }));
  // aria-disabled keeps a field focusable with the disabled look; a disabled field mutes its addon.
  const locked = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const token = (t) => { probe.style.color = `var(--cb-${t})`; return getComputedStyle(probe).color; };
    const want = { fill: token('bg-recessed'), ink: token('text-disabled') }; probe.remove();
    const field = getComputedStyle(document.querySelector('[aria-label="input aria-disabled"]'));
    const addon = getComputedStyle(document.querySelector('[aria-label="group disabled"] + .cb-input-group__addon'));
    return { want, field: { fill: field.backgroundColor, ink: field.color }, addon: addon.color };
  });
  check(locked.field.fill === locked.want.fill && locked.field.ink === locked.want.ink && locked.addon === locked.want.ink,
    'aria-disabled fields look disabled, and a disabled field mutes its addon', JSON.stringify(locked));
  // A <select> has no readonly, so aria-disabled leaves it editable: it must not look locked.
  const open = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const token = (t) => { probe.style.color = `var(--cb-${t})`; return getComputedStyle(probe).color; };
    const want = { fill: token('bg-raised'), ink: token('text-main'), muted: token('text-disabled') }; probe.remove();
    const field = getComputedStyle(document.querySelector('[aria-label="select aria-disabled"]'));
    const addon = getComputedStyle(document.querySelector('[aria-label="select aria-disabled"] + .cb-input-group__addon'));
    return { want, field: { fill: field.backgroundColor, ink: field.color, cursor: field.cursor }, addon: addon.color };
  });
  check(open.field.fill === open.want.fill && open.field.ink === open.want.ink && open.field.cursor !== 'not-allowed' && open.addon !== open.want.muted,
    'an aria-disabled <select> keeps the editable look, as it stays editable', JSON.stringify(open));
  // A group whose choices are invalid frames itself and its legend in crimson and shows its error.
  const groups = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-danger)'; const danger = getComputedStyle(probe).color; probe.remove();
    const look = (g) => { const f = document.querySelector(`[data-vb-group="${g}"]`);
      return { frame: getComputedStyle(f).borderTopColor, legend: getComputedStyle(f.querySelector('legend')).color, error: getComputedStyle(f.querySelector('.cb-field__error')).display }; };
    return { danger, invalid: look('invalid'), valid: look('valid') };
  });
  check(groups.invalid.frame === groups.danger && groups.invalid.legend === groups.danger && groups.invalid.error !== 'none'
    && groups.valid.frame !== groups.danger && groups.valid.error === 'none', 'a fieldset with invalid choices shows the group error', JSON.stringify(groups));
  // A field the server is checking: the field shows progress, its addon the stepped spinner.
  const busy = await pf.evaluate(() => {
    const field = document.querySelector('[aria-label="input busy"]'); const spin = getComputedStyle(field.nextElementSibling, '::before');
    return { cursor: getComputedStyle(field).cursor, animation: spin.animationName, ring: `${spin.borderTopStyle} ${spin.borderTopWidth}`, size: spin.inlineSize };
  });
  check(busy.cursor === 'progress' && busy.animation === 'cb-spin' && busy.ring === 'solid 2px', 'a busy field shows progress and its addon the spinner', JSON.stringify(busy));
  const forms = pf.locator('[data-vb-forms]');
  await forms.scrollIntoViewIfNeeded();
  await snap(forms, `forms-matrix.png`);
  await pf.close();
}

// 26. Property lists, every rendered .cb-props on the page: no UA margins or indent, key and
//     value side by side (stacked below 28rem of the list's width), one-line rows of
//     --cb-row-h with or without a .cb-btn--sm, a line between rows but not above the first or
//     between the values of one term, a line before each value, tabular figures, values that
//     wrap inside their cell, and a frame unless a flush panel body frames the list. The first
//     list also follows data-cb-density.
if (want('props') && await page.locator('.cb-props').count()) {
  const measure = () => page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const tok = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
    const subtle = tok('--cb-border-subtle'); const main = tok('--cb-border-main'); probe.remove();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return [...document.querySelectorAll('.cb-props')].filter((dl) => dl.getClientRects().length).map((dl, i) => {
      const cs = getComputedStyle(dl); const px = (name) => parseFloat(cs.getPropertyValue(name)) * rem;
      const row = Math.round(px('--cb-row-h')); const line = px('--cb-control-h-sm') + 0.5;
      const wide = dl.clientWidth >= 28 * rem; const problems = [];
      const oneLine = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().height <= line; };
      const groups = [];
      for (const c of dl.querySelectorAll(':scope > :is(dt, dd), :scope > div > :is(dt, dd)')) {
        if (c.localName === 'dt') groups.push({ dt: c, dds: [] }); else groups.at(-1)?.dds.push(c);
      }
      if (cs.margin !== '0px') problems.push(`margin ${cs.margin}`);
      const flush = dl.parentElement.matches('.cb-panel__body--flush');
      const frame = `${cs.borderTopWidth} ${cs.borderTopColor}`;
      if (frame !== (flush ? `0px ${cs.borderTopColor}` : `1px ${main}`)) problems.push(`frame ${frame}${flush ? ' (flush)' : ''}`);
      groups.forEach(({ dt, dds }, g) => {
        const name = dt.textContent.trim(); const k = dt.getBoundingClientRect(); const top = g ? `1px ${subtle}` : '0px';
        const edge = (el) => { const e = getComputedStyle(el); return e.borderTopWidth === '0px' ? '0px' : `${e.borderTopWidth} ${e.borderTopColor}`; };
        if (edge(dt) !== top) problems.push(`${name}: key line ${edge(dt)}`);
        dds.forEach((dd, d) => {
          const v = dd.getBoundingClientRect(); const s = getComputedStyle(dd);
          if (!s.fontVariantNumeric.includes('tabular-nums')) problems.push(`${name}: figures ${s.fontVariantNumeric}`);
          if (dd.scrollWidth > dd.clientWidth) problems.push(`${name}: value overflows by ${dd.scrollWidth - dd.clientWidth}px`);
          if (d) {
            const first = dds[0].getBoundingClientRect();
            if (Math.abs(v.left - first.left) > 0.5 || v.top < first.bottom - 0.5 || s.borderTopWidth !== '0px') problems.push(`${name}: extra value at ${Math.round(v.left)},${Math.round(v.top)}, line ${s.borderTopWidth}`);
            return;
          }
          if (wide) {
            if (Math.abs(v.left - k.right) > 0.5 || Math.abs(v.top - k.top) > 0.5) problems.push(`${name}: value at ${Math.round(v.left)},${Math.round(v.top)}, key ends ${Math.round(k.right)},${Math.round(k.top)}`);
            if (edge(dd) !== top) problems.push(`${name}: value line ${edge(dd)}`);
            if (`${s.borderLeftWidth} ${s.borderLeftColor}` !== `1px ${subtle}`) problems.push(`${name}: start line ${s.borderLeftWidth}`);
            const h = Math.round(Math.max(k.height, v.height));
            if (oneLine(dt) && oneLine(dd) && h !== row) problems.push(`${name}: row ${h}px, want ${row}`);
          } else {
            if (Math.abs(v.left - k.left) > 0.5 || v.top < k.bottom - 0.5) problems.push(`${name}: not stacked (value ${Math.round(v.left)},${Math.round(v.top)}, key ${Math.round(k.left)},${Math.round(k.bottom)})`);
            if (s.borderTopWidth !== '0px' || s.borderLeftWidth !== '0px') problems.push(`${name}: stacked value lines ${s.borderTopWidth} ${s.borderLeftWidth}`);
          }
        });
      });
      return { i, wide, rows: groups.length, problems };
    });
  });
  // Earlier checks may have left the first list in an idle tab panel (as on the example screen).
  await expose(page, '.cb-props');
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const lists = await measure();
    check(lists.length > 0, `property lists are rendered at ${width}px`, `${lists.length} measured`);
    for (const l of lists) {
      check(!l.problems.length && l.rows > 0, `property list ${l.i + 1} at ${width}px: ${l.wide ? 'key and value side by side' : 'key above value'}, rows, lines and frame`,
        l.problems.length ? l.problems.join('; ') : `${l.rows} rows`);
    }
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  const density = await page.evaluate(() => {
    // The first list wide enough for key and value side by side (stacked rows have no fixed height).
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const dl = [...document.querySelectorAll('.cb-props')].find((d) => d.getClientRects().length && d.clientWidth >= 28 * rem);
    const row = dl.querySelector(':scope > dt, :scope > div > dt');
    const got = {};
    for (const d of ['compact', 'comfortable']) {
      dl.setAttribute('data-cb-density', d);
      got[d] = Math.round(row.getBoundingClientRect().height);
    }
    dl.removeAttribute('data-cb-density');
    return got;
  });
  check(density.compact === 24 && density.comfortable === 32, 'property list rows follow data-cb-density (24px compact, 32px comfortable)', JSON.stringify(density));
  const section = page.locator('#props');
  if (saving && await section.count()) {
    for (const width of [1360, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await section.scrollIntoViewIfNeeded();
      await snap(section, `props-${width}.png`);
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  }
}

// 27. Busy containers (a table body or whole table, a panel body, a property list): a progress
//     cursor and muted ink, one still hatch fixed to the viewport on the container or its body
//     cells (never the head), with plain rgb stripes (Firefox draws color() stops in a repeating
//     gradient almost flat), muted ink >= 4.5 on every stripe, no hover paint on busy rows, and
//     nothing moves when aria-busy is set. A busy panel body hatches tables and lists inside it.
const BUSY = '[aria-busy="true"]:is(.cb-panel__body, .cb-props, .cb-table, .cb-table > tbody)';
if (want('busy') && await page.locator(BUSY).count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.mouse.move(2, 2);
  // The painting element of a container: its first body cell for tables, itself otherwise.
  const paintOf = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((c) => c.getClientRects().length).map((c) => {
    const body = c.matches('.cb-table') ? c.tBodies[0] : c.matches('tbody') ? c : null;
    const painter = body ? body.querySelector(':scope > tr > :is(th, td)') : c;
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const rgb = (col) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = col; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--cb-text-muted)'; const muted = getComputedStyle(probe).color; probe.remove();
    const ps = getComputedStyle(painter); const ink = getComputedStyle(body ?? c);
    const head = c.closest('.cb-table')?.querySelector('thead th');
    return { name: `${c.localName}${c.className ? `.${c.className.split(' ')[0]}` : ''}`, cursor: ink.cursor, ink: ink.color, muted,
      image: ps.backgroundImage, attach: ps.backgroundAttachment, head: head ? getComputedStyle(head).backgroundImage : 'none',
      stripes: (ps.backgroundImage.match(/(?:rgba?|color)\([^)]*\)/g) ?? []).map(rgb), ink3: rgb(ink.color) };
  }), sel);
  const judge = (b) => {
    const problems = [];
    if (b.cursor !== 'progress') problems.push(`cursor ${b.cursor}`);
    if (b.ink !== b.muted) problems.push(`ink ${b.ink}`);
    if (!b.image.startsWith('repeating-linear-gradient') || b.attach !== 'fixed') problems.push(`paint ${b.image.slice(0, 40)} ${b.attach}`);
    if (b.head.includes('repeating')) problems.push('head hatched');
    const low = b.stripes.map((c) => ratio(b.ink3, c)).filter((r) => r < 4.5);
    if (b.stripes.length < 2 || low.length) problems.push(`stripes ${b.stripes.length}, low ${low.map((r) => r.toFixed(2))}`);
    // Firefox draws a repeating gradient with a color() stop (any color-mix) almost flat.
    if (b.image.includes('color(')) problems.push('a stripe is a color() value');
    return problems;
  };
  const busy = await paintOf(BUSY);
  for (const b of busy) check(!judge(b).length, `busy ${b.name}: progress cursor, muted ink on a still hatch, head untouched`, judge(b).join('; ') || b.image.slice(0, 60));
  check(new Set(busy.map((b) => b.image)).size === 1, 'every busy container paints the same hatch', `${new Set(busy.map((b) => b.image)).size} patterns`);

  // Setting aria-busy moves nothing: every box inside each container stays where it was.
  const shift = await page.evaluate((s) => [...document.querySelectorAll(s)].filter((c) => c.getClientRects().length).map((c) => {
    const boxes = () => [c, ...c.querySelectorAll('*')].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    const on = boxes(); c.removeAttribute('aria-busy'); const off = boxes(); c.setAttribute('aria-busy', 'true');
    return Math.max(0, ...on.flatMap((b, i) => b.map((v, k) => Math.abs(v - off[i][k]))));
  }), BUSY);
  check(shift.every((d) => d < 0.01), 'setting aria-busy on a container moves nothing inside it', `largest shift ${Math.max(...shift).toFixed(3)}px`);

  // A busy row keeps its paint under the pointer.
  const row = page.locator('.cb-table > tbody[aria-busy="true"] > tr, .cb-table[aria-busy="true"] > tbody > tr').first();
  if (await row.count()) {
    const paint = () => row.evaluate((r) => { const c = getComputedStyle(r.querySelector('td')); return `${c.backgroundImage} ${c.backgroundColor}`; });
    await row.scrollIntoViewIfNeeded(); const rest = await paint(); await row.hover(); const hovered = await paint(); await page.mouse.move(2, 2);
    check(rest === hovered, 'a busy table row keeps its hatch under the pointer', rest === hovered ? '' : `${rest.slice(0, 40)} -> ${hovered.slice(0, 40)}`);
  }

  // Tables and property lists inside a busy panel body are hatched too.
  const nested = await page.evaluate(() => {
    const body = (inner) => [...document.querySelectorAll(`.docs-demo .cb-panel__body:not([aria-busy]):has(${inner})`)].find((b) => b.getClientRects().length);
    const out = {};
    for (const [key, inner, cell] of [['props', '.cb-props', '.cb-props'], ['table', '.cb-table > tbody', '.cb-table > tbody > tr > td']]) {
      const b = body(inner); if (!b) continue;
      b.setAttribute('aria-busy', 'true');
      const s = getComputedStyle(b.querySelector(cell)); out[key] = `${s.backgroundImage.slice(0, 25)} ${s.backgroundAttachment}`;
      b.removeAttribute('aria-busy');
    }
    return out;
  });
  check(Object.keys(nested).length === 2 && Object.values(nested).every((v) => v.startsWith('repeating-linear-gradient') && v.endsWith('fixed')),
    'a busy panel body hatches the tables and property lists inside it', JSON.stringify(nested));

  if (saving) {
    const demos = page.locator(`.docs-demo:has(${BUSY})`);
    for (const width of [1360, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (let i = 0; i < await demos.count(); i++) {
        await demos.nth(i).scrollIntoViewIfNeeded();
        await snap(demos.nth(i), `busy-${i + 1}-${width}.png`);
      }
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  }
}

// 28. Empty states: .cb-empty and the table's empty row share one look (16px above and below,
//     muted, centred); a .cb-empty centres its children with no margins, has no frame or fill of
//     its own (its container frames it, a flush body too) and sets its title in main ink at 600.
if (want('empty') && await page.locator('.cb-empty, .cb-table__empty').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const empties = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const tok = (n) => { probe.style.color = `var(${n})`; return getComputedStyle(probe).color; };
    const muted = tok('--cb-text-muted'); const main = tok('--cb-text-main'); probe.remove();
    return [...document.querySelectorAll('.cb-empty, .cb-table__empty')].filter((e) => e.getClientRects().length).map((e) => {
      const s = getComputedStyle(e); const problems = [];
      if (s.paddingTop !== '16px' || s.paddingBottom !== '16px') problems.push(`padding ${s.paddingTop} ${s.paddingBottom}`);
      if (s.color !== muted) problems.push(`ink ${s.color}`);
      if (s.textAlign !== 'center') problems.push(`align ${s.textAlign}`);
      if (e.matches('.cb-empty')) {
        if (s.borderTopWidth !== '0px' || s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.backgroundImage !== 'none') problems.push(`frame ${s.borderTopWidth} ${s.backgroundColor}`);
        const r = e.getBoundingClientRect(); const mid = r.left + parseFloat(s.paddingLeft) + (e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)) / 2;
        for (const c of e.children) {
          const cr = c.getBoundingClientRect(); const cs = getComputedStyle(c);
          if (Math.abs(cr.left + cr.width / 2 - mid) > 1) problems.push(`${c.localName} off centre by ${(cr.left + cr.width / 2 - mid).toFixed(1)}px`);
          if (cs.margin !== '0px') problems.push(`${c.localName} margin ${cs.margin}`);
        }
        const title = e.querySelector(':scope > .cb-empty__title');
        if (title && (getComputedStyle(title).color !== main || getComputedStyle(title).fontWeight !== '600')) problems.push(`title ${getComputedStyle(title).color} ${getComputedStyle(title).fontWeight}`);
      }
      const where = e.parentElement.matches('.cb-panel__body--flush') ? ' in a flush body' : '';
      return { name: `${e.matches('.cb-empty') ? '.cb-empty' : '.cb-table__empty'}${where}`, problems };
    });
  });
  empties.forEach((e, i) => check(!e.problems.length, `empty state ${i + 1} (${e.name}): padded, muted, centred`, e.problems.join('; ')));
  const section = page.locator('#empty');
  if (saving && await section.count()) {
    for (const width of [1360, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await section.scrollIntoViewIfNeeded();
      await snap(section, `empty-${width}.png`);
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  }
}

// 29. Toast stack, in a catalogue stage that stands in for the viewport (layout containment):
//     fixed 12px inside its bottom-end corner, 24rem or the stage less 24px wide, a polite live
//     region that is not atomic, clicks through the gaps between messages, and each message a
//     compact alert on the float shadow framed by its ring and the 4px tone edge.
if (want('toasts') && await page.locator('.docs-stage .cb-toasts').count()) {
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const stack = page.locator('.docs-stage .cb-toasts').first();
    await stack.evaluate((t) => t.closest('.docs-stage').scrollIntoView({ block: 'center' }));
    const t = await stack.evaluate((st) => {
      const stage = st.closest('.docs-stage'); const sr = stage.getBoundingClientRect(); const ss = getComputedStyle(stage);
      const inner = { right: sr.right - parseFloat(ss.borderRightWidth), bottom: sr.bottom - parseFloat(ss.borderBottomWidth),
        width: stage.clientWidth };
      const r = st.getBoundingClientRect(); const cs = getComputedStyle(st);
      const msgs = [...st.children]; const problems = [];
      if (cs.position !== 'fixed') problems.push(`position ${cs.position}`);
      if (Math.abs(inner.right - r.right - 12) > 0.5 || Math.abs(inner.bottom - r.bottom - 12) > 0.5) problems.push(`corner gap ${(inner.right - r.right).toFixed(1)} / ${(inner.bottom - r.bottom).toFixed(1)}`);
      const want = Math.min(24 * 16, inner.width - 24);
      if (Math.abs(r.width - want) > 0.5) problems.push(`width ${r.width} (want ${want})`);
      if (st.getAttribute('aria-live') !== 'polite' || st.getAttribute('aria-atomic') === 'true' || st.getAttribute('role') === 'status') problems.push('live region is not polite and per message');
      if (cs.pointerEvents !== 'none') problems.push(`stack pointer-events ${cs.pointerEvents}`);
      for (const m of msgs) {
        const ms = getComputedStyle(m);
        if (!m.matches('.cb-alert.cb-alert--sm') || ms.pointerEvents !== 'auto') problems.push(`message ${m.className} pointer-events ${ms.pointerEvents}`);
        if (!/0px 0px 0px 1px/.test(ms.boxShadow)) problems.push(`no float ring: ${ms.boxShadow.slice(0, 50)}`);
        const clear = [ms.borderTopColor, ms.borderRightColor, ms.borderBottomColor].every((c) => c === 'rgba(0, 0, 0, 0)');
        if (!clear || ms.borderLeftWidth !== '4px') problems.push(`edges ${ms.borderTopColor} ${ms.borderLeftWidth}`);
      }
      if (msgs.length > 1) {
        const a = msgs[0].getBoundingClientRect(); const b = msgs[1].getBoundingClientRect();
        const hit = document.elementFromPoint(a.left + a.width / 2, (a.bottom + b.top) / 2);
        if (!hit || st.contains(hit)) problems.push(`the gap between messages catches the pointer (${hit?.className})`);
      }
      return { problems, n: msgs.length };
    });
    check(!t.problems.length && t.n > 0, `toast stack at ${width}px: fixed in the corner, polite, clicks pass between messages`, t.problems.join('; ') || `${t.n} messages`);
    // Laid out is not painted: the middle of the first message must show its tint, not the stage.
    const stage = page.locator('.docs-stage:has(.cb-toasts)').first();
    const at = await stage.evaluate((s) => { const r = s.getBoundingClientRect(); const m = s.querySelector('.cb-toasts > *').getBoundingClientRect();
      return [(m.left + m.width / 2 - r.left) / r.width, (m.top + m.height / 2 - r.top) / r.height]; });
    const px = await pixelsOf(stage);
    const [msg, bare] = [await px(...at), await px(0.05, 0.1)];
    check(msg.some((v, k) => Math.abs(v - bare[k]) > 6), `toast stack at ${width}px is painted, not only laid out`, `message ${msg} vs stage ${bare}`);
    await snap(page.locator('.docs-stage:has(.cb-toasts)').first(), `toasts-${width}.png`);
  }
  await page.setViewportSize({ width: 1360, height: 900 });
}

// 30. Menus. Without the script (native popover and CSS only): the key opens its menu in the
//     top layer, unclipped by the table wrapper and centred by the UA; a raised list on the
//     float shadow with 24px items, danger and disabled ink, and the focus ring inside the list.
if (want('menu') && await page.locator('.docs-demo [data-cb-menu]').count()) {
  const KEY = '.docs-demo [popovertarget="m-peer-1"]';
  const noJs = await browser.newContext({ ...contextOptions, javaScriptEnabled: false });
  const pn = await noJs.newPage(); await applyOverrides(pn); await pn.goto(pathToFileURL(page_path).href);
  for (const width of [1360, 360]) {
    await pn.setViewportSize({ width, height: 900 });
    await pn.locator(KEY).scrollIntoViewIfNeeded();
    await pn.click(KEY);
    const m = await pn.evaluate(() => {
      const menu = document.getElementById('m-peer-1'); const r = menu.getBoundingClientRect(); const cs = getComputedStyle(menu);
      const probe = document.body.appendChild(document.createElement('i'));
      const tok = (n) => { probe.style.color = `var(${n})`; return getComputedStyle(probe).color; };
      const t = { raised: tok('--cb-bg-raised'), strong: tok('--cb-border-strong'), danger: tok('--cb-danger'), disabled: tok('--cb-text-disabled') }; probe.remove();
      const items = [...menu.querySelectorAll('.cb-menu__item')];
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { open: menu.matches(':popover-open'), top: hit ? menu.contains(hit) : false, centre: [r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight / 2],
        look: cs.backgroundColor === t.raised && cs.borderTopColor === t.strong && cs.borderTopWidth === '1px' && /0px 0px 0px 1px/.test(cs.boxShadow),
        heights: [...new Set(items.map((i) => Math.round(i.getBoundingClientRect().height)))],
        full: items.every((i) => Math.abs(i.getBoundingClientRect().width - menu.clientWidth) < 1),
        danger: getComputedStyle(menu.querySelector('.cb-menu__item--danger')).color === t.danger,
        disabled: getComputedStyle(menu.querySelector('.cb-menu__item:disabled')).color === t.disabled };
    });
    const ok = m.open && m.top && Math.abs(m.centre[0]) < 2 && Math.abs(m.centre[1]) < 2 && m.look && m.heights.length === 1 && m.heights[0] === 24 && m.full && m.danger && m.disabled;
    check(ok, `menu without the script at ${width}px: opens centred over the page, raised list, 24px items, danger and disabled ink`, JSON.stringify(m));
    if (width === 1360) {
      // From the key, Tab enters the open popover at its first item (Option+Tab in WebKit).
      await pn.locator(KEY).focus(); await pn.keyboard.press(TAB);
      const ring = await pn.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a);
        return `${a.matches('#m-peer-1 .cb-menu__item') ? 'item' : a.tagName} ${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset}`; });
      check(ring === 'item solid 2px -3px', 'a menu item reached by Tab draws the focus ring inside the list', ring);
    }
    await snap(pn, `menu-nojs-${width}.png`);
    await pn.keyboard.press('Escape');
  }
  await noJs.close();

  // With cubicle.js: placed at its key (below, or above near the viewport bottom; flush with the
  // key's right edge in the right half, its left edge otherwise), focus on the first item, arrow
  // keys that skip disabled items and wrap, Home / End, Escape and Tab back to the key's place,
  // aria-expanded on the key, and closing on an item click, an outside click and a scroll.
  const pm = await context.newPage(); await applyOverrides(pm);
  await pm.setViewportSize({ width: 1360, height: 900 }); await pm.goto(pathToFileURL(page_path).href);
  const key = pm.locator(KEY); const menu = pm.locator('#m-peer-1');
  const open = () => menu.evaluate((m) => m.matches(':popover-open'));
  const focused = () => pm.evaluate(() => (document.activeElement.closest('.cb-menu') ? document.activeElement.textContent.trim() : document.activeElement.getAttribute('popovertarget') ?? document.activeElement.tagName));
  const place = () => pm.evaluate(() => {
    const k = document.querySelector('.docs-demo [popovertarget="m-peer-1"]').getBoundingClientRect(); const m = document.getElementById('m-peer-1').getBoundingClientRect();
    return { below: m.top - k.bottom, above: k.top - m.bottom, right: m.right - k.right, inView: m.top >= 0 && m.bottom <= document.documentElement.clientHeight };
  });
  const expanded = () => key.getAttribute('aria-expanded');
  const steps = {};
  await key.evaluate((k) => k.scrollIntoView({ block: 'center' }));
  // The key opens the menu natively; its toggle event (a task later) moves focus in.
  const tick = () => pm.waitForTimeout(50);
  await key.click(); await tick();
  steps.click = { open: await open(), place: await place(), focus: await focused(), expanded: await expanded() };
  // A scroll event that does not move the key (a wrapper scrolled into view just before the
  // click reports it a frame later) leaves the menu open.
  await key.evaluate((k) => k.closest('.cb-table-wrap').dispatchEvent(new Event('scroll'))); await tick();
  steps.still = await open();
  const walk = [];
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'End', 'Home', 'ArrowUp']) { await pm.keyboard.press(k); walk.push(await focused()); }
  steps.walk = walk;
  await pm.keyboard.press('Escape');
  steps.escape = { open: await open(), focus: await focused(), expanded: await expanded() };
  await pm.keyboard.press('ArrowUp');
  steps.up = { open: await open(), focus: await focused() };
  await pm.keyboard.press('Escape'); await pm.keyboard.press('ArrowDown');
  steps.down = await focused();
  await pm.keyboard.press(TAB);
  steps.tab = { open: await open(), focus: await focused() };
  await key.click(); await tick(); await pm.locator('#m-peer-1 .cb-menu__item').nth(1).click();
  steps.item = { open: await open(), focus: await focused() };
  await key.click(); await tick(); await pm.mouse.click(5, 5);
  steps.outside = await open();
  await key.click(); await tick(); await pm.mouse.wheel(0, 60); await pm.waitForTimeout(150);
  steps.scroll = await open();
  // Near the bottom of the viewport the menu opens upwards.
  await key.evaluate((k) => { const r = k.getBoundingClientRect(); scrollBy(0, r.bottom - document.documentElement.clientHeight + 40); });
  await pm.waitForTimeout(100);
  await key.click(); await tick();
  steps.flip = await place();
  await snap(pm, 'menu-up-1360.png');
  await pm.keyboard.press('Escape');
  // A key and menu swapped in at the left edge: placed flush with the key's left edge.
  steps.left = await pm.evaluate(async () => {
    const box = document.createElement('div');
    box.innerHTML = '<button class="cb-btn cb-btn--sm" type="button" popovertarget="m-vb" aria-haspopup="menu">Act</button>'
      + '<div class="cb-menu" id="m-vb" popover role="menu" aria-label="Probe" data-cb-menu><button class="cb-menu__item" type="button" role="menuitem">One</button></div>';
    document.body.prepend(box); scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))); // let that scroll event pass
    const k = box.querySelector('button'); k.click(); await new Promise((r) => setTimeout(r, 50));
    const m = document.getElementById('m-vb'); const out = { open: m.matches(':popover-open'), left: m.getBoundingClientRect().left - k.getBoundingClientRect().left, focus: document.activeElement.textContent };
    m.hidePopover(); box.remove(); return out;
  });
  await pm.close();
  const ok = steps.click.open && steps.click.place.below >= 0 && steps.click.place.below <= 4 && Math.abs(steps.click.place.right) < 1 && steps.click.place.inView
    && steps.click.focus === 'Show details' && steps.click.expanded === 'true' && steps.still
    && steps.walk.join('|') === 'Rotate key|Download config|Copy public key|Revoke…|Show details|Revoke…|Show details|Revoke…'
    && !steps.escape.open && steps.escape.focus === 'm-peer-1' && steps.escape.expanded === 'false'
    && steps.up.open && steps.up.focus === 'Revoke…' && steps.down === 'Show details'
    && !steps.tab.open && steps.tab.focus === 'm-peer-2'
    && !steps.item.open && steps.item.focus === 'm-peer-1' && !steps.outside && !steps.scroll
    && steps.flip.above >= 0 && steps.flip.above <= 4 && steps.flip.inView
    && steps.left.open && Math.abs(steps.left.left) < 1 && steps.left.focus === 'One';
  check(ok, 'menu with cubicle.js: placed at its key, keys, Escape, Tab, closes on item, outside click and scroll, flips up', JSON.stringify(steps));
}

// 31. Logs: a recessed monospace well (12px, tabular, no ligatures) whose time, level and message
//     columns line up on every line (subgrid), a number gutter as wide as its longest number
//     (start), level words in their tones and a 2px tone edge on warn and error lines, the
//     :target line selected, wrapping (or one line per entry with --nowrap), scrolling past
//     20rem, and the focus ring drawn inside.
if (want('log') && await page.locator('.docs-demo .cb-log').count()) {
  const looks = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    return page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('i'));
      const tok = (n) => { probe.style.color = `var(${n})`; return getComputedStyle(probe).color; };
      const t = { recessed: tok('--cb-bg-recessed'), main: tok('--cb-text-main'), debug: tok('--cb-text-muted'), info: tok('--cb-info'), warn: tok('--cb-warn'), error: tok('--cb-danger') };
      probe.style.fontFamily = 'var(--cb-font-mono)'; const mono = getComputedStyle(probe).fontFamily; probe.remove();
      return [...document.querySelectorAll('.docs-demo .cb-log')].map((log, i) => {
        const cs = getComputedStyle(log); const problems = [];
        if (cs.fontFamily !== mono || cs.fontSize !== '12px' || !cs.fontVariantNumeric.includes('tabular-nums') || cs.fontVariantLigatures !== 'none') problems.push(`type ${cs.fontSize} ${cs.fontVariantNumeric} ${cs.fontVariantLigatures}`);
        if (cs.backgroundColor !== t.recessed || cs.boxShadow === 'none') problems.push(`well ${cs.backgroundColor}`);
        const lines = [...log.children];
        for (const part of ['.cb-log__time', '.cb-log__level', '.cb-log__msg']) {
          const xs = new Set(lines.map((l) => Math.round(l.querySelector(part).getBoundingClientRect().left)));
          if (xs.size !== 1) problems.push(`${part} starts at ${[...xs]}`);
        }
        const digits = String(log.start + lines.length - 1).length;
        const gutter = parseFloat(getComputedStyle(lines[0], '::before').width) - parseFloat(getComputedStyle(lines[0], '::before').paddingLeft);
        const ch = (() => { const m = document.createElement('span'); m.textContent = '0'.repeat(10); log.querySelector('.cb-log__msg').append(m); const w = m.getBoundingClientRect().width / 10; m.remove(); return w; })();
        if (Math.abs(gutter - digits * ch) > 1) problems.push(`gutter ${gutter.toFixed(1)} for ${digits} digits of ${ch.toFixed(1)}`);
        for (const l of lines) {
          const lvl = l.dataset.cbLevel; const ls = getComputedStyle(l); const word = getComputedStyle(l.querySelector('.cb-log__level')).color;
          if (word !== (t[lvl] ?? t.main)) problems.push(`${lvl} word ${word}`);
          const edge = ['warn', 'error'].includes(lvl) ? `2px ${t[lvl]}` : '2px rgba(0, 0, 0, 0)';
          if (`${ls.borderLeftWidth} ${ls.borderLeftColor}` !== edge) problems.push(`${lvl} edge ${ls.borderLeftWidth} ${ls.borderLeftColor}`);
        }
        const nowrap = log.matches('.cb-log--nowrap');
        const lineH = parseFloat(cs.lineHeight);
        const tall = lines.some((l) => l.querySelector('.cb-log__msg').getBoundingClientRect().height > lineH * 1.5);
        const sideways = log.scrollWidth > log.clientWidth;
        if (nowrap ? (tall || !sideways) : (!tall || sideways)) problems.push(`${nowrap ? 'nowrap' : 'wrap'}: tall ${tall}, sideways ${sideways}`);
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        if (!nowrap && (log.scrollHeight <= log.clientHeight || Math.round(log.getBoundingClientRect().height) > 20 * rem)) problems.push(`scroll ${log.scrollHeight} in ${log.clientHeight}`);
        return { i, problems };
      });
    });
  };
  for (const width of [1360, 360]) {
    for (const l of await looks(width)) check(!l.problems.length, `log ${l.i + 1} at ${width}px: monospace well, aligned columns, gutter, tones, edges, wrapping, scroll`, l.problems.join('; '));
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  // Generated numbers cannot be read from script: the gutters of the first two lines are
  // compared as pixels, and must differ (the counter counts lines, not a constant).
  const log = page.locator('.docs-demo .cb-log').first();
  await log.evaluate((l) => { l.scrollTop = 0; l.scrollIntoView({ block: 'center' }); });
  const gutters = [];
  for (const n of [0, 1]) {
    const box = await log.evaluate((l, k) => { const li = l.children[k]; const r = li.getBoundingClientRect(); const w = parseFloat(getComputedStyle(li, '::before').width); return { x: r.left, y: r.top, width: w + 2, height: r.height }; }, n);
    gutters.push((await page.screenshot({ clip: box })).toString('base64'));
  }
  check(gutters[0] !== gutters[1], 'log line numbers count up from start (the first two gutters differ)', gutters[0] === gutters[1] ? 'identical gutters' : '');
  // The linked line takes the selected tint; Tab gives the log an inner ring.
  const target = await page.evaluate(async () => {
    const link = document.querySelector('a[href="#L4803"]'); link.click(); await new Promise((r) => setTimeout(r, 50));
    const probe = document.body.appendChild(document.createElement('i')); probe.style.color = 'var(--cb-bg-selected)'; const sel = getComputedStyle(probe).color; probe.remove();
    const out = { selected: getComputedStyle(document.getElementById('L4803')).backgroundColor === sel, other: getComputedStyle(document.getElementById('L4804')).backgroundColor !== sel };
    history.replaceState(null, '', location.pathname); return out;
  });
  check(target.selected && target.other, 'a linked log line (:target) takes the selected tint', JSON.stringify(target));
  const pk = await context.newPage(); await applyOverrides(pk); await pk.goto(pathToFileURL(page_path).href);
  await pk.locator('a[href="#L4803"]').focus(); await pk.keyboard.press(TAB); await pk.keyboard.press(SHIFT_TAB); await pk.keyboard.press(TAB);
  const ring = await pk.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return `${a.matches('.cb-log') ? 'log' : a.tagName} ${s.outlineStyle} ${s.outlineOffset}`; });
  await pk.close();
  check(ring === 'log solid -3px', 'a log reached by Tab draws the focus ring inside', ring);
  const section = page.locator('#log');
  if (saving) {
    for (const width of [1360, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await section.scrollIntoViewIfNeeded();
      await snap(section, `log-${width}.png`);
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  }
}

// 32. Master-detail: at 1360px the split's two children sit side by side, tops aligned, the
//     master about twice the detail; at 360px the detail goes under the master at full width.
if (want('split') && await page.locator('.docs-demo .cb-split').count()) {
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const sp = await page.$eval('.docs-demo .cb-split', (s) => {
      const [m, d] = [...s.children].map((c) => c.getBoundingClientRect()); const w = s.clientWidth;
      return { side: Math.abs(m.top - d.top) < 0.5 && d.left > m.right, ratio: m.width / d.width,
        stacked: d.top >= m.bottom && Math.abs(m.width - w) < 0.5 && Math.abs(d.width - w) < 0.5, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const ok = !sp.overflow && (width === 1360 ? sp.side && sp.ratio > 1.8 && sp.ratio < 2.2 : sp.stacked);
    check(ok, `master-detail at ${width}px: ${width === 1360 ? 'side by side, 2:1' : 'detail under the master'}`, JSON.stringify(sp));
    await snap(page.locator('.docs-demo:has(> .cb-split)').first(), `split-${width}.png`);
  }
  await page.setViewportSize({ width: 1360, height: 900 });
}

// 33. Forced colours (a forcedColors: 'active' context; Chromium and Firefox force the palette,
//     WebKit only matches the media query, so there the rules are checked as written). State
//     that a fill or a shadow carries maps to Highlight / HighlightText, and unavailable controls
//     to GrayText; system colours are resolved through a probe in the same context.
if (want('forced') && await page.locator('.docs-demo').count()) {
  const fc = await browser.newContext({ ...contextOptions, forcedColors: 'active' });
  const pf = await fc.newPage(); await applyOverrides(pf); await pf.goto(pathToFileURL(page_path).href);
  const STATES = ['.cb-btn[aria-pressed="true"]:not(:disabled)', '.cb-segmented > .cb-btn:has(> input:checked:not(:disabled))', '.cb-pagination .cb-btn[aria-current="page"]',
    '.cb-table tbody tr[aria-selected="true"]:not([aria-busy="true"] tr) > td', '.cb-table tbody tr:has(> td > .cb-check:checked):not([aria-busy="true"] tr) > td',
    '.cb-nav__link[aria-current="page"]', '[role="treeitem"][aria-selected="true"] > .cb-nav__link', '.cb-tabs__tab[aria-selected="true"]'];
  const DISABLED = ['.cb-btn:disabled', '.cb-btn[aria-disabled="true"]', '.cb-input:disabled', '.cb-input[aria-disabled="true"]', '.cb-select:disabled',
    '.cb-nav__link[aria-disabled="true"]', '.cb-tabs__tab:disabled', '.cb-table tbody tr[aria-disabled="true"] > td', '.cb-menu__item:disabled', '.cb-choice:has(:disabled)', '.cb-fieldset:disabled > legend'];
  const states = await pf.evaluate(([st, dis]) => {
    const probe = document.body.appendChild(document.createElement('i'));
    const sys = (c) => { probe.style.color = c; return getComputedStyle(probe).color; };
    const t = { hl: sys('Highlight'), hlText: sys('HighlightText'), gray: sys('GrayText') }; probe.remove();
    const first = (sel) => document.querySelector(`.docs-demo ${sel}`);
    return {
      states: st.map((sel) => { const e = first(sel); if (!e) return `${sel}: missing`; const c = getComputedStyle(e); return c.backgroundColor === t.hl && c.color === t.hlText ? null : `${sel}: ${c.backgroundColor} / ${c.color}`; }).filter(Boolean),
      disabled: dis.map((sel) => { const e = first(sel); if (!e) return `${sel}: missing`; const c = getComputedStyle(e); return c.color === t.gray ? null : `${sel}: ${c.color}`; }).filter(Boolean),
      t };
  }, [STATES, DISABLED]);
  check(!states.states.length, 'forced colours: selected, pressed, current and checked states take Highlight', states.states.join('; ') || `${STATES.length} states`);
  check(!states.disabled.length, 'forced colours: unavailable controls take GrayText', states.disabled.join('; ') || `${DISABLED.length} kinds`);
  const option = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i')); probe.style.color = 'Highlight'; const hl = getComputedStyle(probe).color; probe.remove();
    const o = getComputedStyle(document.querySelector('.docs-demo .cb-select[multiple]:not(:disabled) option:checked')); return { ok: o.backgroundColor === hl, bg: o.backgroundColor };
  });
  check(option.ok, 'forced colours: selected list-box options take Highlight', option.bg);
  const link = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i')); probe.style.color = 'HighlightText'; const ink = getComputedStyle(probe).color; probe.remove();
    const a = document.querySelector('.docs-demo .cb-table tbody tr[aria-selected="true"] > :is(th, td) a'); return a ? { ok: getComputedStyle(a).color === ink, color: getComputedStyle(a).color } : { ok: false, color: 'missing' };
  });
  check(link.ok, 'forced colours: a link in a selected row takes HighlightText', link.color);
  const inner = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i')); probe.style.color = 'CanvasText'; const text = getComputedStyle(probe).color; probe.remove();
    const box = document.querySelector('.docs-demo .cb-table tbody tr:has(> td > .cb-check:checked) .cb-check:checked');
    return { adjust: getComputedStyle(box).forcedColorAdjust, mark: getComputedStyle(box, '::before').backgroundColor === text };
  });
  // WebKit has no forced-color-adjust (undefined), which is the same as auto there.
  check((inner.adjust ?? 'auto') === 'auto' && inner.mark, 'forced colours: a check box in a highlighted row is forced again, with its mark', JSON.stringify(inner));
  // Marks, lamps, arrows, the spinner, the select's arrow and log edges stay visible.
  const marks = await pf.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('i'));
    const sys = (c) => { probe.style.color = c; return getComputedStyle(probe).color; };
    const t = { text: sys('CanvasText'), canvas: sys('Canvas'), gray: sys('GrayText') }; probe.remove();
    const q = (sel, pseudo) => { const e = document.querySelector(`.docs-demo ${sel}`); return e ? getComputedStyle(e, pseudo) : null; };
    const problems = [];
    for (const sel of ['.cb-check[type="checkbox"]:checked:not(:disabled)', '.cb-check[type="radio"]:checked:not(:disabled)', '.cb-led--ok', '.cb-badge--ok:not([aria-busy="true"])', '[aria-sort="ascending"] > .cb-table__sort']) {
      const c = q(sel, sel.includes('cb-table__sort') ? '::after' : '::before'); if (!c) { problems.push(`${sel}: missing`); continue; }
      if (c.backgroundColor !== t.text) problems.push(`${sel}: ${c.backgroundColor}`);
    }
    const off = q('.cb-led--off', '::before'); if (off && off.backgroundColor === t.text) problems.push('off lamp filled');
    const spin = q('.cb-btn[aria-busy="true"]', '::before');
    if (!spin || spin.borderTopColor !== t.text || spin.borderBottomColor !== t.gray) problems.push(`spinner ${spin?.borderTopColor} / ${spin?.borderBottomColor}`);
    const sel = q('select.cb-select:not([multiple]):not([size])'); if (!sel || sel.appearance === 'none') problems.push(`select appearance ${sel?.appearance}`);
    const lines = [...document.querySelectorAll('.docs-demo .cb-log > li')];
    const info = lines.find((l) => l.dataset.cbLevel === 'info'); const err = lines.find((l) => l.dataset.cbLevel === 'error');
    if (getComputedStyle(info).borderLeftColor !== t.canvas || getComputedStyle(err).borderLeftColor !== t.text) problems.push(`log edges ${getComputedStyle(info).borderLeftColor} / ${getComputedStyle(err).borderLeftColor}`);
    return problems;
  });
  check(!marks.length, 'forced colours: marks, lamps, sort arrows, the spinner, the select arrow and log edges stay visible', marks.join('; '));
  // Meter fills are engine pseudo-elements: compare pixels of the filled and the empty part.
  const meter = pf.locator('.docs-demo meter.cb-meter').first(); await meter.scrollIntoViewIfNeeded();
  const fill = await pf.evaluate(async ([b64, frac]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const at = (fx) => [...g.getImageData(Math.floor(fx * img.width), Math.floor(img.height * 0.3), 1, 1).data].slice(0, 3);
    return { filled: at(0.03), empty: at(Math.min(0.97, frac + 0.1)) };
  }, [(await meter.screenshot()).toString('base64'), await meter.evaluate((m) => (m.value - m.min) / (m.max - m.min))]);
  check(fill.filled.some((v, k) => Math.abs(v - fill.empty[k]) > 40), 'forced colours: a meter shows its fill against the empty track', JSON.stringify(fill));
  for (const id of saving ? ['fields', 'badges', 'meters'] : []) {
    const sec = pf.locator(`#${id}`); await sec.scrollIntoViewIfNeeded(); await snap(sec, `forced-${id}.png`);
  }
  for (const id of saving ? ['buttons', 'tables', 'nav'] : []) {
    const sec = pf.locator(`#${id}`); await sec.scrollIntoViewIfNeeded(); await snap(sec, `forced-${id}.png`);
  }
  await fc.close();
}

// 34. Right to left. On the catalogue's dir="rtl" demo: the select chevron sits at the left end,
//     the current link's accent bar on its right edge, the vertical tab line on the list's left
//     edge, a closed disclosure chevron points left and an open one down, and the meter's low
//     mark sits 70% from the right, where the fill starts. Then both pages with dir="rtl" on
//     <html> have no horizontal overflow at 360, 800 and 1360px.
if (want('rtl')) {
  const demo = page.locator('.docs-demo > [dir="rtl"]');
  if (await demo.count()) {
    await page.setViewportSize({ width: 1360, height: 900 });
    await demo.scrollIntoViewIfNeeded();
    const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const darkCols = async (loc, from, to) => {
      const px = await pixelsOf(loc); let dark = 0;
      for (let k = 0; k <= 20; k++) { const c = await px(from + (to - from) * k / 20, 0.5); if (lum(c) < 120) dark++; }
      return dark;
    };
    const select = page.locator('#rtl-role');
    const chevron = { left: await darkCols(select, 0.01, 0.06) };
    const link = page.locator('.docs-demo > [dir="rtl"] .cb-nav__link[aria-current="page"]');
    const lp = await pixelsOf(link); const bar = { right: lum(await lp(0.998, 0.5)), left: lum(await lp(0.002, 0.5)) };
    // The chevron turns over --cb-duration: read it after that.
    const geo = await page.evaluate(async () => {
      const d = document.querySelector('.docs-demo > [dir="rtl"]'); const wait = () => new Promise((r) => setTimeout(r, 120));
      const list = d.querySelector('.cb-tabs--vertical > .cb-tabs__list'); const sum = d.querySelector('details > summary');
      const closed = getComputedStyle(sum, '::before').rotate; sum.parentElement.open = true; await wait();
      const open = getComputedStyle(sum, '::before').rotate; sum.parentElement.open = false; await wait();
      const tab = getComputedStyle(list.querySelector('[aria-current="page"]'));
      return { line: getComputedStyle(list).backgroundPositionX, closed, open, sheet: tab.borderLeftColor === tab.backgroundColor };
    });
    // The low and high marks (main ink, darker than the ticks) in the ruler strip, as fractions
    // from the left: low 70% and high 90% from the right are 0.3 and 0.1.
    const meter = page.locator('#rtl-cpu'); const mp = await pixelsOf(meter);
    const h = await meter.evaluate((m) => m.getBoundingClientRect().height);
    const marks = [];
    for (let k = 3; k <= 197; k++) { const c = await mp(k / 200, (h - 1) / h); if (lum(c) < 60 && !marks.some((m) => Math.abs(m - k / 200) < 0.02)) marks.push(k / 200); }
    const engineStrip = await meter.evaluate((m) => parseFloat(getComputedStyle(m).paddingBottom) > 0);
    const ok = chevron.left > 0 && bar.right < bar.left - 40 && /^0(%|px)$/.test(geo.line) && geo.closed === '45deg' && geo.open === '-45deg' && geo.sheet;
    check(ok, 'right to left: select chevron at the left, accent bar on the right, tab line on the left and the selected tab joined to its panel, chevrons turned', JSON.stringify({ chevron, bar, geo }));
    if (engineStrip) check(marks.length === 2 && Math.abs(marks[0] - 0.1) < 0.03 && Math.abs(marks[1] - 0.3) < 0.03,
      'right to left: the meter marks count from the right, where the fill starts', `marks at ${marks.join(', ')}`);
    for (const width of saving ? [1360, 360] : []) {
      await page.setViewportSize({ width, height: 900 }); await demo.scrollIntoViewIfNeeded();
      await snap(page.locator('.docs-demo:has(> [dir="rtl"])'), `rtl-${width}.png`);
    }
    await page.setViewportSize({ width: 1360, height: 900 });
  }
  const pr = await context.newPage(); await applyOverrides(pr); await pr.goto(pathToFileURL(page_path).href);
  await pr.evaluate(() => { document.documentElement.dir = 'rtl'; });
  const over = [];
  for (const width of [360, 800, 1360]) {
    await pr.setViewportSize({ width, height: 900 });
    const w = await pr.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (w > 0) over.push(`${width}px: ${w}px`);
  }
  await pr.close();
  check(!over.length, 'right to left: the whole page has no horizontal overflow at 360, 800 and 1360px', over.join(', '));
}

// 35. Recipes and their primitives. .cb-center puts its child in the middle of the frame on
//     both axes, at most 24rem wide (full width less 16px on each side when narrower).
if (want('recipes') && await page.locator('.docs-demo .cb-center').count()) {
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const c = await page.$eval('.docs-demo .cb-center', (el) => {
      const r = el.getBoundingClientRect(); const k = el.firstElementChild.getBoundingClientRect(); const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return { dx: (k.left + k.width / 2) - (r.left + r.width / 2), dy: (k.top + k.height / 2) - (r.top + r.height / 2), w: k.width, want: Math.min(24 * rem, r.width - 32), h: r.height, frame: el.parentElement.clientHeight };
    });
    check(Math.abs(c.dx) < 1 && Math.abs(c.dy) < 1 && Math.abs(c.w - c.want) < 1 && Math.abs(c.h - c.frame) < 1, `centre at ${width}px: the child sits in the middle, ${Math.round(c.want)}px wide`, JSON.stringify(c));
  }
  await page.setViewportSize({ width: 1360, height: 900 });
}
// The recipes themselves: the filter bar wraps inside its panel at 360px, the code field asks
// for digits and one-time codes, the current wizard step is bold, the colour readout follows
// its field, and the masked secret shows nothing until its details open.
if (want('recipes') && await page.locator('#recipes').count()) {
  await page.setViewportSize({ width: 360, height: 900 });
  const bar = await page.$eval('#recipes-filter ~ .docs-demo form[role="search"]', (f) => {
    const panel = f.closest('.cb-panel').getBoundingClientRect(); const kids = [...f.children].map((k) => k.getBoundingClientRect());
    return { rows: new Set(kids.map((k) => Math.round(k.top))).size, inside: kids.every((k) => k.left >= panel.left && k.right <= panel.right + 0.5), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check(bar.rows > 1 && bar.inside && !bar.overflow, 'recipe filter bar: wraps inside its panel at 360px', JSON.stringify(bar));
  await page.setViewportSize({ width: 1360, height: 900 });
  // Enter in a field presses the form's first submit key: it must filter, not drop a filter.
  await page.evaluate(() => {
    const f = document.querySelector('#recipes-filter ~ .docs-demo form[role="search"]');
    f.addEventListener('submit', (e) => { e.preventDefault(); f.dataset.submitter = e.submitter ? `${e.submitter.textContent.trim()} ${e.submitter.name}=${e.submitter.value}` : 'none'; }, { once: true });
  });
  await page.focus('#recipes-filter ~ .docs-demo form[role="search"] input[type="search"]');
  await page.keyboard.press('Enter');
  const submitter = await page.$eval('#recipes-filter ~ .docs-demo form[role="search"]', (f) => { const s = f.dataset.submitter ?? 'no submit'; delete f.dataset.submitter; return s; });
  check(!/drop=/.test(submitter) && submitter !== 'no submit', 'recipe filter bar: Enter in the search field filters, without dropping a filter', submitter);
  const r = await page.evaluate(async () => {
    const code = document.getElementById('rs-code');
    const step = document.querySelector('#recipes-steps ~ .docs-demo [aria-current="step"]');
    const colour = document.getElementById('rc-colour'); const out = document.querySelector('output[for="rc-colour"]');
    colour.value = '#991b1b'; colour.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((x) => setTimeout(x, 0));
    const read = out.value; colour.value = '#1e4b85'; colour.dispatchEvent(new Event('input', { bubbles: true }));
    // Earlier checks may have opened it (expose() for the copy key): start closed.
    const well = document.getElementById('rm-key'); const details = well.closest('details'); details.open = false;
    // A closed details hides its content with content-visibility, which keeps boxes: ask for visibility.
    const closed = !well.checkVisibility(); details.open = true; const opened = well.checkVisibility(); details.open = false;
    return { code: `${code.inputMode} ${code.getAttribute("autocomplete")} ${code.pattern}`, step: getComputedStyle(step).fontWeight, read, closed, opened };
  });
  check(r.code === 'numeric one-time-code [0-9]{6}' && r.step === '600' && r.read === '#991b1b' && r.closed && r.opened,
    'recipes: one-time code field, current step, colour readout, masked secret', JSON.stringify(r));
  for (const id of saving ? ['recipes-filter', 'recipes-inspector', 'recipes-signin'] : []) {
    for (const width of [1360, 360]) {
      await page.setViewportSize({ width, height: 900 });
      const demo = page.locator(`#${id} ~ .docs-demo`).first(); await demo.scrollIntoViewIfNeeded(); await snap(demo, `${id}-${width}.png`);
    }
  }
  await page.setViewportSize({ width: 1360, height: 900 });
}

// 36. Print (print media emulated on a fresh page). The application frame unrolls into one
//     column without the sidebar, main stops scrolling, and script-only actions, the Menu key,
//     chip remove keys and toasts are hidden; scroll wrappers and logs print in full and a
//     --nowrap log wraps.
if (want('print')) {
  const pp = await context.newPage(); await applyOverrides(pp); await pp.goto(pathToFileURL(page_path).href);
  await pp.emulateMedia({ media: 'print' });
  const r = await pp.evaluate(() => {
    const out = {}; const cs = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e) : null; };
    const app = document.querySelector('body > .cb-app');
    if (app) {
      out.frame = { main: cs('.cb-app__main').overflowY, side: cs('.cb-app__side').display, height: cs('body > .cb-app').blockSize, min: cs('body > .cb-app').minBlockSize };
    }
    const hidden = [...document.querySelectorAll('[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-dismiss], [data-cb-modal], [data-cb-toggle], .cb-chip__remove, .cb-toasts')].filter((e) => getComputedStyle(e).display !== 'none');
    out.shown = hidden.slice(0, 3).map((e) => e.outerHTML.slice(0, 60));
    const wrap = cs('.cb-table-wrap--scroll'); if (wrap) out.wrap = `${wrap.maxBlockSize} ${wrap.overflowY}`;
    const log = cs('.cb-log:not(.cb-log--nowrap)'); if (log) out.log = `${log.maxBlockSize} ${log.overflowY}`;
    const msg = cs('.cb-log--nowrap .cb-log__msg'); if (msg) out.nowrap = msg.whiteSpace;
    return out;
  });
  const problems = [];
  if (r.frame && (r.frame.main !== 'visible' || r.frame.side !== 'none' || r.frame.min !== '0px')) problems.push(`frame ${JSON.stringify(r.frame)}`);
  if (r.shown.length) problems.push(`still shown: ${r.shown.join(' | ')}`);
  if (r.wrap && r.wrap !== 'none visible') problems.push(`table wrapper ${r.wrap}`);
  if (r.log && r.log !== 'none visible') problems.push(`log ${r.log}`);
  if (r.nowrap && r.nowrap !== 'pre-wrap') problems.push(`nowrap log ${r.nowrap}`);
  check(!problems.length, 'print: the frame unrolls without the sidebar, actions are hidden, wrappers and logs print in full', problems.join('; ') || JSON.stringify(r));
  if (saving && engine === 'chromium' && r.frame) await pp.pdf({ path: resolve(shots, 'print-example.pdf'), printBackground: false });
  await pp.close();
}

// 36b. Target size (WCAG 2.5.8) at default and comfortable density, on a fresh page with every
//     <details> open and every tab panel shown: a target is at least 24x24 CSS px, or a 24px
//     circle on its centre meets no other target or another small target's circle. A control in
//     its label is targeted through the label; links in running text are exempt. Compact density
//     trades this for density on purpose, so compact subtrees are left out. The catalogue's
//     target-size table is measured at all three densities: per row the height of the first
//     target, the distance to the next one when it is small, and whether any of them fails.
const TARGET_ROWS = [
  { name: 'Navigation and tree rows', sel: '#nav .cb-nav__link' },
  { name: 'Stacked check boxes and radios', sel: '#fields .cb-stack--tight .cb-choice' },
  { name: 'Attached page keys', sel: '#pagination .cb-btn' },
  { name: 'Small keys in table rows', sel: '#tables .cb-table .cb-btn--sm' },
  { name: 'Keys stacked in a column', sel: '#secrets .cb-secret__actions .cb-btn' },
  { name: 'Keys in a row', sel: '#buttons .cb-btn:not(.cb-btn--sm)' },
  { name: 'Chip remove keys', sel: '#badges .cb-chip__remove' },
];
const measureTargets = ([d, rows]) => {
  if (d === 'default') document.documentElement.removeAttribute('data-cb-density'); else document.documentElement.dataset.cbDensity = d;
  const SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="tab"], [role="menuitem"], [role="treeitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const inText = (el) => el.localName === 'a' && [...el.parentElement.childNodes].some((n) => n !== el && n.nodeType === 3 && n.textContent.trim());
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const targets = [...document.querySelectorAll(SEL)].filter((el) => !el.closest('.docs-nav, pre, [inert], [hidden], [data-cb-density="compact"]:not(html)') && !inText(el) && shown(el)).map((el) => {
    const host = el.matches('input') && el.closest('label') ? el.closest('label') : el;
    const r = host.getBoundingClientRect();
    return { el, host, r, small: r.width < 23.5 || r.height < 23.5, c: [r.left + r.width / 2, r.top + r.height / 2] };
  });
  const toRect = ([x, y], r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
  const fails = targets.filter((t) => t.small && targets.some((o) => o !== t && o.r !== t.r && !o.el.contains(t.el) && !t.el.contains(o.el)
    && (o.small ? Math.hypot(o.c[0] - t.c[0], o.c[1] - t.c[1]) < 24 : toRect(t.c, o.r) < 12)));
  const cells = rows.map(({ sel }) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => !e.closest('[data-cb-density]:not(html)') && shown(e));
    if (!els.length) return 'no target';
    const [a, b] = els.map((e) => e.getBoundingClientRect());
    const small = a.width < 23.5 || a.height < 23.5;
    const gap = b ? Math.round(Math.hypot(b.left + b.width / 2 - a.left - a.width / 2, b.top + b.height / 2 - a.top - a.height / 2)) : Infinity;
    const failing = fails.some((t) => els.includes(t.host) || els.includes(t.el));
    return `${Math.round(a.height)}px${small ? (gap < 32 ? `, ${gap}px apart` : ', spaced') : ''}${failing ? ' · fails' : ''}`;
  });
  return { cells, fails: d === 'compact' ? [] : fails.map((t) => `#${t.el.parentElement.closest('[id]')?.id} ${t.el.localName}.${[...t.el.classList].join('.')} ${Math.round(t.r.width)}x${Math.round(t.r.height)} "${(t.el.textContent || t.el.getAttribute('aria-label') || '').trim().slice(0, 20)}"`) };
};
if (want('targets')) {
  const pt = await context.newPage(); await applyOverrides(pt); await pt.goto(pathToFileURL(page_path).href);
  await pt.evaluate(() => {
    document.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
    document.querySelectorAll('[role="tabpanel"][hidden]').forEach((t) => t.removeAttribute('hidden'));
  });
  for (const density of ['default', 'comfortable']) {
    const { fails } = await pt.evaluate(measureTargets, [density, []]);
    check(!fails.length, `targets are 24px or spaced apart at ${density} density (WCAG 2.5.8)`, fails.join('; '));
  }
  if (await pt.locator('#accessibility').count()) {
    const doc = await pt.$$eval('#a11y-targets-table tbody tr', (rows) => rows.map((r) => [...r.children].map((c) => c.textContent.trim())));
    const live = {};
    for (const density of ['compact', 'default', 'comfortable']) live[density] = (await pt.evaluate(measureTargets, [density, TARGET_ROWS])).cells;
    const stale = !doc.length ? ['table missing'] : TARGET_ROWS.flatMap(({ name }, i) => {
      const row = [name, live.compact[i], live.default[i], live.comfortable[i]];
      return doc[i]?.join(' | ') === row.join(' | ') ? [] : [`${doc[i]?.join(' | ') ?? 'missing row'} vs live ${row.join(' | ')}`];
    });
    if (doc.length && doc.length !== TARGET_ROWS.length) stale.push(`${doc.length} rows for ${TARGET_ROWS.length} patterns`);
    check(!stale.length, 'the catalogue target-size table matches the measured sizes', stale.slice(0, 3).join(' || ') || `${doc.length} rows`);
  }
  await pt.close();
}

// 37. The example console's refresh (host code standing in for the server): Enter on Refresh
//     makes the key and the peer table's body busy (the key stays focusable but inert), then
//     clears both, keeps focus on the key, and drops a confirmation into the toast stack, whose
//     close key hides it.
if (want('example') && await page.locator('body > .cb-app [data-cb-tabs]').count()) {
  const px = await context.newPage(); await applyOverrides(px); await px.goto(pathToFileURL(page_path).href);
  const has = await px.locator('#x-refresh').count();
  if (!has) check(false, 'example: the Peers tab has a Refresh key', 'missing #x-refresh');
  else {
    await px.click('#x-tab-peers'); await px.focus('#x-refresh'); await px.keyboard.press('Enter');
    const state = () => px.evaluate(() => { const k = document.getElementById('x-refresh'); const b = document.querySelector('#x-peer-table > tbody');
      return { key: k.getAttribute('aria-busy'), inert: k.getAttribute('aria-disabled'), rows: b.getAttribute('aria-busy'), hatch: getComputedStyle(b.querySelector('td')).backgroundImage.startsWith('repeating'),
        focus: document.activeElement === k, toasts: document.querySelectorAll('#x-toasts > .cb-alert').length }; });
    const busy = await state();
    await px.waitForFunction(() => !document.getElementById('x-refresh').hasAttribute('aria-busy'), null, { timeout: 5000 });
    const done = await state();
    const toast = await px.evaluate(() => { const t = document.querySelector('#x-toasts > .cb-alert:last-child'); return t ? { ok: t.matches('.cb-alert--sm.cb-alert--ok'), text: t.textContent, close: !!t.querySelector('[data-cb-dismiss]') } : null; });
    await px.click('#x-toasts > .cb-alert:last-child [data-cb-dismiss]');
    const hidden = await px.evaluate(() => document.querySelector('#x-toasts > .cb-alert:last-child').hidden);
    check(busy.key === 'true' && busy.inert === 'true' && busy.rows === 'true' && busy.hatch && busy.focus
      && done.key === null && done.inert === null && done.rows === null && done.focus && done.toasts === busy.toasts + 1
      && toast?.ok && /refreshed/.test(toast.text) && toast.close && hidden,
      'example: Refresh shows a busy table, then a confirmation toast that closes', JSON.stringify({ busy, done, toast, hidden }));
  }
  await px.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.skip ? 'skip' : r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}${r.skip ? `  [${engine}: ${r.skip}]` : ''}`);
const skipped = results.filter((r) => r.skip).length;
console.log(`\n${engine} ${engineVersion}: ${results.length - failed.length}/${results.length} checks passed${skipped ? ` (${skipped} skipped as engine limits)` : ''}${only ? ` (only ${only.join(', ')})` : ''}. Screenshots: ${saving ? `${relative(root, shots)}/` : 'none'}`);
process.exit(failed.length ? 1 : 0);
