// Cubicle browser verification. Development tool only; not part of the shipped kit.
//
// Setup (once):   cd scripts && npm install && npx playwright install chromium
// Run:            node scripts/verify-browser.mjs [docs/index.html] [--css dist/cubicle.min.css]
//                 --css serves the given file in place of dist/cubicle.css (to check the minified build).
// Output:         a pass/fail report and screenshots in tmp/shots/ (git-ignored).
// Exit code:      0 when every check passes, 1 otherwise.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cssFlag = args.indexOf('--css');
const css_override = cssFlag >= 0 ? resolve(root, args.splice(cssFlag, 2)[1] ?? '') : null;
const page_path = resolve(root, args[0] ?? 'docs/index.html');
const shots = resolve(root, 'tmp/shots');
mkdirSync(shots, { recursive: true });

const results = [];
const check = (ok, name, detail = '') => results.push({ ok, name, detail });

const browser = await chromium.launch();
const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1360, height: 900 } });
const page = await context.newPage();

const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));
if (css_override) {
  await page.route(/\/dist\/cubicle\.css$/, (route) => route.fulfill({ path: css_override, contentType: 'text/css' }));
}
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

await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: tmp/shots/`);
process.exit(failed.length ? 1 : 0);
