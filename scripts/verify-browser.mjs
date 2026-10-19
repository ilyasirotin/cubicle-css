// Cubicle browser verification. Development tool only; not part of the shipped kit.
//
// Setup (once):   cd scripts && npm install && npx playwright install chromium
// Run:            node scripts/verify-browser.mjs [docs/index.html] [--css dist/cubicle.min.css] [--js dist/cubicle.min.js]
//                 --css / --js serve the given file in place of dist/cubicle.css / dist/cubicle.js
//                 (to check the minified build).
// Output:         a pass/fail report and screenshots in tmp/shots/ (git-ignored), including
//                 state-<element>-<rest|hover|focus|active>.png for every interactive demo control
//                 badges-<width>.png and tables-<width>.png of those sections, and
//                 tables-sticky-360.png of the wide grid scrolled sideways, and
//                 alerts-<width>.png, tabs-<width>.png, nav-<width>.png, meters-<width>.png
//                 segmented-<width>.png, details-<width>.png and dialog-<id>.png.
// Exit code:      0 when every check passes, 1 otherwise.

import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cssFlag = args.indexOf('--css');
const css_override = cssFlag >= 0 ? resolve(root, args.splice(cssFlag, 2)[1] ?? '') : null;
const jsFlag = args.indexOf('--js');
const js_override = jsFlag >= 0 ? resolve(root, args.splice(jsFlag, 2)[1] ?? '') : null;
const page_path = resolve(root, args[0] ?? 'docs/index.html');
const shots = resolve(root, 'tmp/shots');
mkdirSync(shots, { recursive: true });

const results = [];
const check = (ok, name, detail = '') => results.push({ ok, name, detail });

const browser = await chromium.launch();
const contextOptions = { colorScheme: 'light', viewport: { width: 1360, height: 900 } };
const context = await browser.newContext({ ...contextOptions, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
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
for (const width of [360, 800, 1360]) {
  await page.setViewportSize({ width, height: 900 });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(sw <= 0, `no horizontal overflow at ${width}px`, sw > 0 ? `${sw}px too wide` : '');
  await page.screenshot({ path: `${shots}/page-${width}.png`, fullPage: true });
}
await page.setViewportSize({ width: 1360, height: 900 });

// 3. Visible focus ring on the first instance of each control type
const controls = ['a[href]', 'button:not([disabled])', 'input:not([type=hidden])', 'select', 'textarea', 'summary'];
for (const sel of controls) {
  const el = page.locator(sel).first();
  if (await el.count() === 0) continue;
  await el.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const r = await el.evaluate((n) => { const cs = getComputedStyle(n); return { fv: n.matches(':focus-visible'), w: parseFloat(cs.outlineWidth), s: cs.outlineStyle }; });
  check(r.fv && r.w >= 2 && r.s !== 'none', `focus ring visible on ${sel}`, `${r.w}px ${r.s}`);
}

// 4. Key travel on press (first .cb-btn)
const btn = page.locator('.cb-btn:not([disabled]):not([aria-disabled])').first();
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
  await page.screenshot({ path: `${shots}/dialog-${id}.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const closed = await page.evaluate((i) => !document.getElementById(i).matches(':popover-open'), id);
  check(opened && closed, `dialog #${id} opens and closes with Escape`);
}

// 6. Contrast of text pairs (Cool Industrial Steel palette). Edit PAIRS when tokens change.
const PAIRS = [
  // Primary ink across all neutral surfaces
  ['--cb-text-main', '--cb-bg-canvas', 4.5],
  ['--cb-text-main', '--cb-bg-surface', 4.5],
  ['--cb-text-main', '--cb-bg-raised', 4.5],
  ['--cb-text-main', '--cb-bg-btn', 4.5],
  ['--cb-text-main', '--cb-bg-recessed', 4.5],
  ['--cb-text-main', '--cb-bg-header', 4.5],
  ['--cb-text-main', '--cb-bg-zebra', 4.5],
  ['--cb-text-main', '--cb-bg-hover', 4.5],
  ['--cb-text-main', '--cb-bg-selected', 4.5],

  // Muted ink across main reading surfaces
  ['--cb-text-muted', '--cb-bg-canvas', 4.5],
  ['--cb-text-muted', '--cb-bg-surface', 4.5],
  ['--cb-text-muted', '--cb-bg-raised', 4.5],
  ['--cb-text-muted', '--cb-bg-recessed', 4.5],
  ['--cb-text-muted', '--cb-bg-header', 4.5],

  // Solid semantic buttons (inverse text on dark corporate tones)
  ['--cb-text-inverse', '--cb-accent', 4.5],
  ['--cb-text-inverse', '--cb-ok', 4.5],
  ['--cb-text-inverse', '--cb-warn', 4.5],
  ['--cb-text-inverse', '--cb-danger', 4.5],
  ['--cb-text-inverse', '--cb-info', 4.5],

  // Tinted danger button (.cb-btn--danger)
  ['--cb-danger', 'color-mix(in srgb, var(--cb-danger) 10%, var(--cb-bg-btn))', 4.5],

  // Derived semantic badge tints (10% mix on surface)
  ...['--cb-ok', '--cb-warn', '--cb-danger', '--cb-info', '--cb-text-muted'].map((c) => [
    c,
    `color-mix(in srgb, var(${c}) 10%, var(--cb-bg-surface))`,
    4.5,
  ]),
  // Neutral tag (.cb-badge) and neutral solid badge
  ['--cb-text-main', 'color-mix(in srgb, var(--cb-text-main) 10%, var(--cb-bg-surface))', 4.5],
  ['--cb-text-inverse', '--cb-text-main', 4.5],
  // Table rows: selected + hover, totals row
  ['--cb-text-main', 'color-mix(in srgb, var(--cb-bg-selected) 70%, var(--cb-bg-raised))', 4.5],
  ['--cb-text-main', 'color-mix(in srgb, var(--cb-bg-header) 50%, var(--cb-bg-surface))', 4.5],
  // Alert bodies (10% tone tint) and links in a danger alert
  ...['--cb-ok', '--cb-warn', '--cb-danger', '--cb-info'].map((c) => ['--cb-text-main', `color-mix(in srgb, var(${c}) 10%, var(--cb-bg-surface))`, 4.5]),
  ['--cb-accent', 'color-mix(in srgb, var(--cb-danger) 10%, var(--cb-bg-surface))', 4.5],
  // Meter and progress fills against the recessed track (non-text, >= 3)
  ...['--cb-ok', '--cb-warn', '--cb-danger', '--cb-accent'].map((c) => [c, '--cb-bg-recessed', 3]),
  // Idle tabs (muted ink on the darker tab tint)
  ['--cb-text-muted', 'color-mix(in srgb, var(--cb-bg-header) 60%, var(--cb-bg-surface))', 4.5],

  // Non-text structural & focus contrast (>= 3.0)
  ['--cb-border-strong', '--cb-bg-surface', 3],
  ['--cb-border-strong', '--cb-bg-raised', 3],
  ['--cb-accent', '--cb-bg-surface', 3],
  ['--cb-accent', '--cb-bg-canvas', 3],
];

const rgb = await page.evaluate((names) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const probe = document.body.appendChild(document.createElement('div'));
  const out = {};
  for (const n of names) {
    probe.style.color = n.startsWith('--') ? `var(${n})` : n;
    g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = getComputedStyle(probe).color; g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data; out[n] = [d[0], d[1], d[2]];
  }
  probe.remove(); return out;
}, [...new Set(PAIRS.flat().filter((x) => typeof x === 'string'))]);

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const [fg, bg, need] of PAIRS) {
  if (!rgb[fg] || !rgb[bg]) { check(false, `contrast ${fg} on ${bg}`, 'token missing'); continue; }
  const r = ratio(rgb[fg], rgb[bg]);
  const label = bg.replace(/color-mix\(in srgb, var\((--[a-z-]+)\) (\d+)\%, var\((--[a-z-]+)\)\)/, 'mix($1 $2% + $3)');
  check(r >= need, `contrast ${fg} on ${label} >= ${need}`, r.toFixed(2));
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

const controls7 = await page.$$('.docs-demo :is(button, a[href], input, select, textarea, summary):not([disabled], [aria-disabled="true"], [aria-busy="true"])');
const seenKeys = new Set();
for (const el of controls7) {
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
    const b = await el.boundingBox();
    await page.screenshot({ path: `${shots}/state-${slug}-${state}.png`, clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 } });
  };
  const contrast = async () => {
    const { need, pairs } = await el.evaluate(readContrast);
    return pairs.map(([name, fg, bg]) => ({ name, need, r: ratio(fg, bg) }));
  };
  const box = await el.boundingBox();
  const centre = [box.x + box.width / 2, box.y + box.height / 2];
  const ratios = {};

  await page.mouse.move(2, 2); await page.waitForTimeout(100);
  ratios.rest = await contrast(); await shot('rest');

  await page.mouse.move(...centre); await page.waitForTimeout(100);
  ratios.hover = await contrast(); await shot('hover');

  await page.mouse.down(); await page.waitForTimeout(100);
  ratios.active = await contrast(); await shot('active');
  await el.evaluate((n) => n.addEventListener('click', (e) => e.preventDefault(), { once: true }));
  await page.mouse.up(); await page.mouse.move(2, 2);

  await el.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  // Tab returns to the checked radio of a group, so judge whichever radio of the group took focus.
  const ring = await el.evaluate((n) => {
    const f = n.type === 'radio' && document.activeElement?.name === n.name ? document.activeElement : n;
    const cs = getComputedStyle(f); return f.matches(':focus-visible') && parseFloat(cs.outlineWidth) >= 2 && cs.outlineStyle !== 'none';
  });
  await shot('focus');
  await el.evaluate((n) => n.blur());

  const all = Object.entries(ratios).flatMap(([state, list]) => list.map((m) => ({ state, ...m })));
  const low = all.filter((m) => m.r < m.need);
  check(!low.length && ring, `states of ${key}: contrast at rest/hover/active, focus ring visible`,
    `${all.length ? all.map((m) => `${m.state} ${m.name} ${m.r.toFixed(2)}`).join(', ') : 'contrast n/a'}${ring ? '' : ', NO FOCUS RING'}`);
}

// 8. Every button and button-styled link has an accessible name (text or aria-label).
const unnamed = await page.$$eval('button, a.cb-btn', (els) => els
  .filter((e) => !(e.getAttribute('aria-label') ?? '').trim() && !e.textContent.trim())
  .map((e) => e.outerHTML.slice(0, 80)));
check(unnamed.length === 0, 'every button has an accessible name', unnamed.join(' | '));

// 9. Behaviour of dist/cubicle.js on the catalogue: copy, reveal, auto re-mask, download,
//    table select-all, alert dismiss, ARIA tabs and trees, meter marks, the plain-HTTP copy fallback, and hiding of script-only controls
//    without JavaScript.
//    Every part starts from a fresh page so earlier clicks do not leak state.
const ACTIONS = '[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-select-all], [data-cb-dismiss], [data-cb-modal]';
if (await page.locator(ACTIONS).count()) {
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
      const btn = p.locator(`[data-cb-copy="${id}"]`);
      await btn.scrollIntoViewIfNeeded(); await btn.click(); await p.waitForTimeout(100);
      const got = await p.evaluate(() => navigator.clipboard.readText());
      const flagged = await btn.evaluate((b) => b.hasAttribute('data-cb-copied'));
      const live = await p.evaluate(() => document.querySelector('[role="status"][data-cb-sr]')?.textContent ?? '');
      check(got === await valueOf(p, id) && flagged && /copied/i.test(live), `copy #${id}: clipboard holds the value, button and live region confirm`,
        `clipboard ${got === await valueOf(p, id) ? 'ok' : 'MISMATCH'}, data-cb-copied ${flagged}, live "${live}"`);
    }

    for (const id of await ids(p, 'data-cb-reveal')) {
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

    // Plain-HTTP pages have no navigator.clipboard: the hidden-buffer fallback must still copy.
    const copyId = (await ids(p, 'data-cb-copy'))[0];
    if (copyId) {
      await p.evaluate(() => navigator.clipboard.writeText('sentinel'));
      const ph = await fresh(context, (q) => q.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })));
      await ph.locator(`[data-cb-copy="${copyId}"]`).click(); await ph.waitForTimeout(100);
      const got = await p.evaluate(() => navigator.clipboard.readText());
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
  await noJs.close();
}

// 10. Badges and LEDs, once per distinct look: text >= 4.5 against the painted background,
//     the LED lamp rim >= 3 against it (WCAG 1.4.11), at most 20px high so badges fit
//     .cb-btn--sm table rows, and busy badges spin except under reduced motion.
const INDICATORS = '.docs-demo :is(.cb-badge, .cb-led)';
if (await page.locator(INDICATORS).count()) {
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

  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const section = page.locator('.docs-section:has(.docs-demo .cb-badge)').first();
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${shots}/badges-${width}.png` });
  }
}

// 11. Data tables: one row height (28px, compact 24px) with or without .cb-btn--sm,
//     sticky first column(s) and header that stay put while their wrapper scrolls,
//     text contrast in every row paint (zebra, hover, selected, totals), and a visible
//     sort arrow for each aria-sort value.
if (await page.locator('.docs-demo .cb-table').count()) {
  await page.setViewportSize({ width: 1360, height: 900 });
  // Tables inside closed dialogs are not rendered; they are measured by check 18 instead.
  const heights = await page.$$eval('.docs-demo .cb-table', (tables) => tables.filter((t) => t.getClientRects().length).map((t, i) => {
    const rows = [...t.querySelectorAll('tbody tr, thead tr, tfoot tr')].filter((r) => !r.querySelector('.cb-table__empty'));
    const want = t.classList.contains('cb-table--compact') ? 24 : 28;
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
  await wide.locator('xpath=..').screenshot({ path: `${shots}/tables-sticky-360.png` });
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
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${shots}/tables-${width}.png` });
  }
}

// 12. Alerts: a 4px edge in the tone, a rendered glyph tile with readable inverse ink,
//     readable title and body text, one-line compact alerts 28px high (27px as a banner,
//     which has no top border), and square banners.
if (await page.locator('.docs-demo .cb-alert').count()) {
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
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${shots}/alerts-${width}.png` });
  }
}

// 13. Tabs: the selected tab takes its panel's colour and hides the line under it (one
//     sheet), long link lists scroll inside themselves at 360px, the tab chosen with End
//     stays in view, and vertical lists turn horizontal below 30rem.
if (await page.locator('.docs-demo .cb-tabs').count()) {
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
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${shots}/tabs-${width}.png` });
  }
}

// 14. Navigation and trees: 24px rows, the current or selected row paints the selected
//     tint with a 2px accent bar, leaf and branch labels line up, --lines draws a 1px
//     vertical per nested item (stopping at the row centre on the last one), a loading
//     branch spins (and stops under reduced motion), and breadcrumb separators are silent.
if (await page.locator('.docs-demo .cb-nav').count()) {
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
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${shots}/nav-${width}.png` });
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
if (await page.locator('.docs-demo .cb-meter').count()) {
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
      const fill = await px(0.05, midTrack); const empty = await px(0.98, midTrack);
      const got = nearest(fill, ['ok', 'warn', 'danger', 'accent']); const r = ratio(fill, empty);
      ok &&= got === info.tone && (info.fraction > 0.97 || r >= 3);
      results.push(`fill ${got} (want ${info.tone}), vs track ${r.toFixed(2)}`);
    } else {
      const a = (await m.screenshot()).toString('base64'); await page.waitForTimeout(300); const b = (await m.screenshot()).toString('base64');
      ok &&= info.animation === 'none' && a === b;
      results.push(`still ${a === b}, animation ${info.animation}`);
    }
    const stripY = (info.h - 1) / info.h;
    if (info.ticks) {
      const tick = await px(0.5, stripY); const t = nearest(tick, ['border-main', 'bg-surface', 'text-main']);
      ok &&= t !== 'bg-surface';
      results.push(`tick at 50% ${t}`);
    }
    if (info.low || info.high) {
      const w = (await m.boundingBox()).width;
      for (const f of [info.low, info.high].filter(Boolean).map(Number)) {
        const x = ((w - 2) * f + 1) / w; const mark = await px(x, stripY);
        const t = nearest(mark, ['text-main', 'border-main', 'bg-surface']);
        ok &&= t === 'text-main';
        results.push(`mark at ${(f * 100).toFixed(0)}% ${t}`);
      }
    }
    check(ok, `meter: ${info.key.trim()}`, results.join(', '));
  }
  const rows = await page.$$eval('.docs-demo .cb-table:has(.cb-meter--sm) tbody tr', (rs) => [...new Set(rs.map((r) => Math.round(r.getBoundingClientRect().height)))]);
  if (rows.length) check(rows.length === 1 && rows[0] === 28, 'table rows with compact meters stay 28px', `${rows.join(', ')}px`);

  const section = page.locator('.docs-section:has(.docs-demo .cb-gauge)').first();
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${shots}/meters-${width}.png` });
  }
}

// 16. Segmented controls: the checked key is sunk on the selected tint and the others are
//     not, a click and the arrow keys move the choice, the input covers its key exactly (so
//     the focus ring frames the key), disabled keys and disabled fieldsets refuse a choice,
//     checkbox groups keep several keys on, and --fill keys share the row equally.
if (await page.locator('.docs-demo .cb-segmented').count()) {
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

  const group = page.locator('.docs-demo .cb-segmented[role="radiogroup"]').first();
  const checkedValue = () => group.evaluate((g) => g.querySelector(':checked')?.value);
  const start = await checkedValue();
  await group.locator('.cb-btn').first().click(); const clicked = await checkedValue();
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
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${shots}/segmented-${width}.png` });
  }
}

// 17. Details and disclosure: one chevron rule reaches every summary (panels, nav, tree,
//     details): -45deg closed, 45deg open, 0.25rem margin, no native marker. Summary rows are
//     28px (24px compact and inline), stacked blocks share a 1px seam, Enter and Space toggle,
//     a named group keeps one block open, meta sits at the row end, and inline blocks have no
//     frame and line their body up with the summary text.
if (await page.locator('.docs-demo .cb-details').count()) {
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
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${shots}/details-${width}.png` });
  }
}

// 18. Modal dialogs: a data-cb-modal button opens its dialog as a modal with focus inside
//     (on the autofocus element when there is one) and the page inert under the backdrop
//     token; Escape closes it and focus returns to the opener; a method="dialog" button
//     reports its value; a typed confirmation refuses a wrong name; widths follow --sm,
//     default and --lg, --danger has a 3px stripe, a long dialog fits the viewport with a
//     scrolling body, and below 40rem a dialog fills the screen.
if (await page.locator('.docs-demo [data-cb-modal]').count()) {
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
    await page.screenshot({ path: `${shots}/dialog-${id}.png` });
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
  await page.screenshot({ path: `${shots}/dialog-${ids[0]}-360.png` });
  await page.keyboard.press('Escape');
  check(narrow.w === 360 && narrow.h === 900 && narrow.radius === '0px', 'below 40rem a dialog fills the screen', JSON.stringify(narrow));
  await page.setViewportSize({ width: 1360, height: 900 });
}

await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: tmp/shots/`);
process.exit(failed.length ? 1 : 0);
