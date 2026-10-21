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
//                 forms-matrix.png of the native form-control fixture.
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
  'segmented', 'details', 'dialogs', 'pagination', 'utilities', 'frame', 'density', 'keyboard', 'snippets', 'forms'];
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
// A control inside an idle ARIA tab panel or a closed <details> (as on the example screen) is
// shown first: its tab is clicked and its details opened.
const expose = (pg, selector) => pg.evaluate((sel) => {
  const el = document.querySelector(sel);
  for (let n = el; n; n = n.parentElement) {
    if (n.matches('[role="tabpanel"][hidden]')) document.querySelector(`[role="tab"][aria-controls="${n.id}"]`)?.click();
    if (n.matches('details:not([open])')) n.open = true;
  }
}, selector);

// Date and time fields: Tab walks their segments, and WebKit never matches :focus-visible on them
// (the stylesheet draws the same ring on :focus there), so focus checks accept :focus.
const SEGMENTED = 'input:is([type="date"], [type="time"], [type="datetime-local"], [type="month"], [type="week"])';

const ENGINE_LIMITS = [
  { engine: 'firefox', check: /^meter ruler:/, reason: 'Firefox paints the meter track on the element itself, so there is no ruler strip for ticks and marks' },
  { engine: 'webkit', check: /reaches the clipboard|falls back when the async clipboard/, reason: 'WebKit refuses clipboard reads from automation, so the copied text cannot be compared' },
  { engine: 'webkit', check: /^selected options in a multi-select/, reason: 'WebKit paints list-box selection natively and ignores option backgrounds' },
  { engine: 'webkit', check: /^Escape clears a search field/, reason: 'WebKit does not clear a search field on Escape' },
  { engine: 'firefox', check: /^states of input\.cb-input\[type=(date|time|datetime-local)\]\[readonly\]/, reason: 'Firefox does not let a readonly date or time field take focus' },
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

// 1. No console errors
check(problems.length === 0, 'no console errors or warnings', problems.join(' | '));

// 2. No horizontal overflow at three widths
if (want('layout')) {
  for (const width of [360, 800, 1360]) {
    await page.setViewportSize({ width, height: 900 });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(sw <= 0, `no horizontal overflow at ${width}px`, sw > 0 ? `${sw}px too wide` : '');
    // Firefox refuses screenshots taller than 32767px; the catalogue is longer, so it gets the viewport.
    await snap(page, `page-${width}.png`, { fullPage: true }).catch(() => snap(page, `page-${width}.png`));
  }
  await page.setViewportSize({ width: 1360, height: 900 });
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

  // 5. Popover dialogs open and close with Escape
  for (const id of await page.$$eval('[popovertarget]:not([popovertargetaction])', (n) => [...new Set(n.map((x) => x.getAttribute('popovertarget')))])) {
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
const ACTIONS = '[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-select-all], [data-cb-dismiss], [data-cb-modal]';
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
          focus: document.activeElement?.id ?? '', enabled: tabs.filter((t) => t.getAttribute('aria-disabled') !== 'true').map((t) => t.id),
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
    const targets = buttons.filter((b) => !b.hasAttribute('data-cb-modal')).map((b) => document.getElementById(b.getAttribute('data-cb-copy') ?? b.getAttribute('data-cb-reveal') ?? b.getAttribute('data-cb-download') ?? b.getAttribute('data-cb-select-all') ?? b.getAttribute('data-cb-dismiss') ?? b.getAttribute('data-cb-modal')));
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
//     .cb-btn--sm table rows, and busy badges spin except under reduced motion.
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

  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    const section = page.locator('.docs-section:has(.docs-demo .cb-badge)').first();
    await section.scrollIntoViewIfNeeded();
    await snap(section, `badges-${width}.png`);
  }
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
    const headTop = t.querySelector('thead th').getBoundingClientRect().top - box().top;
    const scrolledY = wrap.scrollTop;
    wrap.scrollLeft = 0; wrap.scrollTop = 0;
    return { i, pinned, before, after, scrolledX, headTop, scrolledY };
  }));
  for (const s of sticky.filter((x) => !x.skip)) {
    const columnsHold = !s.scrolledX || s.after.every((x, k) => Math.abs(x - s.before[k]) < 1);
    const headHolds = !s.scrolledY || Math.abs(s.headTop - 1) < 1;
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
  const paints = async () => page.$$eval('.docs-demo .cb-table :is(tbody, tfoot) tr', (rows) => {
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

  const arrows = await page.$$eval('.docs-demo th[aria-sort] > .cb-table__sort', (bs) => bs.map((b) => {
    const a = getComputedStyle(b, '::after');
    return { sort: b.parentElement.getAttribute('aria-sort'), w: parseFloat(a.width), h: parseFloat(a.height), clip: a.clipPath !== 'none' };
  }));
  for (const sort of new Set(arrows.map((a) => a.sort))) {
    const a = arrows.find((x) => x.sort === sort);
    check(a.w > 0 && a.h > 0 && a.clip, `sort arrow visible for aria-sort="${sort}"`, `${a.w}x${a.h}px`);
  }

  const section = page.locator('.docs-section:has(.docs-demo .cb-table)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `tables-${width}.png`);
  }
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
  const section = page.locator('.docs-section:has(.docs-demo .cb-alert)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `alerts-${width}.png`);
  }
}

// 13. Tabs: the selected tab takes its panel's colour and hides the line under it (one
//     sheet), long link lists scroll inside themselves at 360px, the tab chosen with End
//     stays in view, and vertical lists turn horizontal below 30rem.
if (want('tabs') && await page.locator('.docs-demo .cb-tabs').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const merged = await page.$$eval('.docs-demo .cb-tabs', (sets) => sets.map((set, i) => {
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

  const section = page.locator('.docs-section:has(.docs-demo .cb-tabs)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `tabs-${width}.png`);
  }
}

// 14. Navigation and trees: 24px rows, the current or selected row paints the selected
//     tint with a 2px accent bar, leaf and branch labels line up, --lines draws a 1px
//     vertical per nested item (stopping at the row centre on the last one), a loading
//     branch spins (and stops under reduced motion), and breadcrumb separators are silent.
if (want('nav') && await page.locator('.docs-demo .cb-nav').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const nav = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.docs-demo .cb-nav__link')].filter((r) => r.getClientRects().length);
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

  const section = page.locator('.docs-section:has(.docs-demo .cb-nav--lines)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `nav-${width}.png`);
  }
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
    if (ruler.length) check(rulerOk, `meter ruler: ${info.key.trim()}`, ruler.join(', '));
  }
  const rows = await page.$$eval('.docs-demo .cb-table:has(.cb-meter--sm) tbody tr', (rs) => [...new Set(rs.map((r) => Math.round(r.getBoundingClientRect().height)))]);
  if (rows.length) check(rows.length === 1 && rows[0] === 28, 'table rows with compact meters stay 28px', `${rows.join(', ')}px`);

  const section = page.locator('.docs-section:has(.docs-demo .cb-gauge)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `meters-${width}.png`);
  }
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

  const section = page.locator('.docs-section:has(.docs-demo .cb-segmented--fill)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `segmented-${width}.png`);
  }
}

// 17. Details and disclosure: one chevron rule reaches every summary (panels, nav, tree,
//     details): -45deg closed, 45deg open, 0.25rem margin, no native marker. Summary rows are
//     28px (24px compact and inline), stacked blocks share a 1px seam, Enter and Space toggle,
//     a named group keeps one block open, meta sits at the row end, and inline blocks have no
//     frame and line their body up with the summary text.
if (want('details') && await page.locator('.docs-demo .cb-details').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const chevrons = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.docs-demo :is(summary.cb-panel__head, summary.cb-nav__link, [aria-expanded]:not([aria-busy="true"]) > .cb-nav__link, .cb-details > summary)')]
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

  const section = page.locator('.docs-section:has(.docs-demo .cb-details--inline)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `details-${width}.png`);
  }
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

  const section = page.locator('.docs-section:has(.docs-demo .cb-pagination)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `pagination-${width}.png`);
  }
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

  const section = page.locator('.docs-section:has(.docs-demo .cb-mono)').first();
  for (const width of saving ? [1360, 360] : [360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await snap(section, `utilities-${width}.png`);
  }
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
    return { stacked: r('.cb-app__side').bottom <= r('.cb-app__main').top + 1, page: document.documentElement.scrollHeight > innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check(narrow.stacked && narrow.page && !narrow.overflow, 'application frame at 360px: sidebar above main, page scrolls, no overflow', JSON.stringify(narrow));
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
//     --cb-control-h, small keys --cb-control-h-sm, table rows --cb-row-h, and a small key
//     fits its row: 22 / 18 / 24 compact, 26 / 20 / 28 default, 30 / 24 / 32 comfortable.
if (want('density') && await page.locator('.docs-demo [data-cb-density]').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  const sizes = { compact: [22, 18, 24], default: [26, 20, 28], comfortable: [30, 24, 32] };
  const panels = await page.$$eval('.docs-demo .cb-grid:has([data-cb-density]) > .cb-panel', (ps) => ps.map((p) => {
    const h = (sel) => Math.round(p.querySelector(sel).getBoundingClientRect().height);
    const row = p.querySelector('tbody tr'); const key = row.querySelector('.cb-btn--sm');
    return { mode: p.getAttribute('data-cb-density') ?? 'default', field: h('.cb-input'), segment: h('.cb-segmented > .cb-btn'),
      small: h('.cb-panel__head .cb-btn--sm'), row: Math.round(row.getBoundingClientRect().height),
      fits: key.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom && key.getBoundingClientRect().top >= row.getBoundingClientRect().top };
  }));
  for (const d of panels) {
    const [control, small, row] = sizes[d.mode];
    check(d.field === control && d.segment === control && d.small === small && d.row === row && d.fits,
      `density ${d.mode}: controls ${control}px, small keys ${small}px, rows ${row}px with the key inside`,
      `field ${d.field}, segment ${d.segment}, small ${d.small}, row ${d.row}, key fits ${d.fits}`);
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
    // Under load an engine can scroll to the control later still (seen in WebKit with runs side by
    // side): a stop the viewport cuts is measured again before it counts.
    for (let tries = 0; stop?.clip.includes('viewport') && tries < 5; tries++) { await pa.waitForTimeout(50); stop = await measure(); }
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
    tel: '+1 555 0100', number: '51820', date: '2026-11-01', time: '23:30', 'datetime-local': '2026-11-01T23:30', month: '2026-11', week: '2026-W44', file: '' };
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

await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.skip ? 'skip' : r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}${r.skip ? `  [${engine}: ${r.skip}]` : ''}`);
const skipped = results.filter((r) => r.skip).length;
console.log(`\n${engine} ${engineVersion}: ${results.length - failed.length}/${results.length} checks passed${skipped ? ` (${skipped} skipped as engine limits)` : ''}${only ? ` (only ${only.join(', ')})` : ''}. Screenshots: ${saving ? `${relative(root, shots)}/` : 'none'}`);
process.exit(failed.length ? 1 : 0);
