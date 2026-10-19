// Cubicle browser verification. Development tool only; not part of the shipped kit.
//
// Setup (once):   cd scripts && npm install && npx playwright install chromium
// Run:            node scripts/verify-browser.mjs [docs/index.html] [--css dist/cubicle.min.css] [--js dist/cubicle.min.js]
//                 --css / --js serve the given file in place of dist/cubicle.css / dist/cubicle.js
//                 (to check the minified build).
// Output:         a pass/fail report and screenshots in tmp/shots/ (git-ignored), including
//                 state-<element>-<rest|hover|focus|active>.png for every interactive demo control
//                 badges-<width>.png and tables-<width>.png of those sections, and
//                 tables-sticky-360.png of the wide grid scrolled sideways.
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
      .map((a) => `[${a}${n.getAttribute(a) ? `=${n.getAttribute(a)}` : ''}]`).join(''));
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
  const ring = await el.evaluate((n) => { const cs = getComputedStyle(n); return n.matches(':focus-visible') && parseFloat(cs.outlineWidth) >= 2 && cs.outlineStyle !== 'none'; });
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
//    table select-all, the plain-HTTP copy fallback, and hiding of script-only controls
//    without JavaScript.
//    Every part starts from a fresh page so earlier clicks do not leak state.
const ACTIONS = '[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-select-all]';
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
    const targets = buttons.map((b) => document.getElementById(b.getAttribute('data-cb-copy') ?? b.getAttribute('data-cb-reveal') ?? b.getAttribute('data-cb-download') ?? b.getAttribute('data-cb-select-all')));
    return { hidden: buttons.every((b) => getComputedStyle(b).display === 'none'), visible: targets.every((t) => t && getComputedStyle(t).display !== 'none') };
  }, ACTIONS);
  check(r.hidden && r.visible, 'without JavaScript, script-only actions are hidden and values stay visible', JSON.stringify(r));
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
  const heights = await page.$$eval('.docs-demo .cb-table', (tables) => tables.map((t, i) => {
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

await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: tmp/shots/`);
process.exit(failed.length ? 1 : 0);
