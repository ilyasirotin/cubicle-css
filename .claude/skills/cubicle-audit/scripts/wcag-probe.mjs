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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(resolve(root, 'scripts/package.json'));
const playwright = require('playwright');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] ?? '' : fallback; };
const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const engine = option('--browser', 'chromium');
const only = option('--only', 'target,reflow,resize,spacing,obscured').split(',').filter(Boolean);
const aria = option('--aria', null);
const verbose = flag('--verbose');
const asServed = flag('--as-served');
const url = pathToFileURL(resolve(root, args[0] ?? 'docs/index.html')).href;
if (!playwright[engine]) { console.error(`unknown --browser ${engine}`); process.exit(2); }

// Firefox moves Tab between form controls only unless told otherwise (as in verify-browser.mjs).
const browser = await playwright[engine].launch(engine === 'firefox' ? { firefoxUserPrefs: { 'accessibility.tabfocus': 7 } } : {});
const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
const load = async () => {
  await page.goto(url);
  if (asServed) return;
  await page.evaluate(() => {
    document.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
    document.querySelectorAll('[role="tabpanel"][hidden]').forEach((p) => p.removeAttribute('hidden'));
  });
};
await load();

// In-page helpers, inlined into each evaluate: a signature and a location for an element.
const HELPERS = `
  const sig = (el) => {
    const cb = [...el.classList].find((c) => c.startsWith('cb-'));
    const role = el.getAttribute('role');
    return el.localName + (el.localName === 'input' ? '[type=' + el.type + ']' : '') + (cb ? '.' + cb : '') + (role ? '[role=' + role + ']' : '');
  };
  const at = (el) => '#' + (el.parentElement?.closest('[id]')?.id ?? '');
  const text = (el) => (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 30);
`;
// Text clipped by its own box (overflow hidden or clip), ellipsis truncation excepted.
const CLIPPED = `(() => {${HELPERS}
  return [...document.body.querySelectorAll('*')].filter((el) => {
    if (el.closest('.docs-nav, pre, [hidden]') || el.matches('.cb-sr-only, [data-cb-sr]')) return false;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
    const cs = getComputedStyle(el);
    const clips = (o) => o === 'hidden' || o === 'clip';
    const v = clips(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    const h = clips(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis';
    return (v || h) && el.getBoundingClientRect().width > 0;
  }).map((el) => ({ sig: sig(el), at: at(el), text: text(el), detail: 'over by ' + (el.scrollHeight - el.clientHeight) + 'px tall, ' + (el.scrollWidth - el.clientWidth) + 'px wide' }));
})()`;
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const report = (title, rows) => {
  console.log(`${title}: ${rows.length}`);
  if (verbose) {
    for (const r of rows) console.log(`    ${r.sig}  ${r.at}  "${r.text}"  ${r.detail}`);
    return;
  }
  const by = new Map();
  for (const r of rows) { const g = by.get(r.sig) ?? { n: 0, r, places: new Set() }; g.n++; g.places.add(r.at); by.set(r.sig, g); }
  for (const [s, g] of [...by].sort((a, b) => b[1].n - a[1].n)) {
    const places = [...g.places];
    console.log(`    ${String(g.n).padStart(4)} ${s}  e.g. "${g.r.text}" ${g.r.detail}  in ${places.slice(0, 4).join(' ')}${places.length > 4 ? ` +${places.length - 4}` : ''}`);
  }
};

if (only.includes('target')) {
  console.log('2.5.8 Target size: undersized targets that fail the spacing exception');
  for (const density of ['compact', 'default', 'comfortable']) {
    await page.evaluate((d) => { if (d === 'default') document.documentElement.removeAttribute('data-cb-density'); else document.documentElement.dataset.cbDensity = d; }, density);
    const fails = await page.evaluate(`(() => {${HELPERS}
      const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=menuitem], [role=treeitem], [role=option], [tabindex]:not([tabindex="-1"])';
      const inText = (el) => el.localName === 'a' && [...el.parentElement.childNodes].some((n) => n !== el && n.nodeType === 3 && n.textContent.trim());
      const targets = [...document.querySelectorAll(SEL)].filter((el) => {
        if (el.closest('.docs-nav, pre, [inert], [hidden]') || inText(el)) return false;
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden';
      }).map((el) => {
        // A native control inside its label: the label is the target.
        const host = el.matches('input') && el.closest('label') ? el.closest('label') : el;
        const r = host.getBoundingClientRect();
        return { el, r, small: r.width < 23.5 || r.height < 23.5, c: [r.left + r.width / 2, r.top + r.height / 2] };
      });
      const distToRect = ([x, y], r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      const out = [];
      for (const t of targets) {
        if (!t.small) continue;
        const clash = targets.find((o) => o !== t && o.r !== t.r && !o.el.contains(t.el) && !t.el.contains(o.el) &&
          (o.small ? Math.hypot(o.c[0] - t.c[0], o.c[1] - t.c[1]) < 24 : distToRect(t.c, o.r) < 12));
        if (clash) out.push({ sig: sig(t.el), at: at(t.el), text: text(t.el), detail: Math.round(t.r.width) + 'x' + Math.round(t.r.height) + ' next to ' + sig(clash.el) });
      }
      return out;
    })()`);
    report(`  ${density}`, fails);
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-cb-density'));
}

if (only.includes('reflow')) {
  await page.setViewportSize({ width: 320, height: 256 });
  const wide = await page.evaluate(`(() => {${HELPERS}
    const de = document.documentElement;
    const inScroller = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { if (/auto|scroll|hidden|clip/.test(getComputedStyle(n).overflowX)) return true; } return false; };
    const out = (el) => el.getBoundingClientRect().right > de.clientWidth + 1;
    return [...document.body.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().width > 0 && out(el) && !inScroller(el) && !(el.parentElement && out(el.parentElement)))
      .map((el) => ({ sig: sig(el), at: at(el), text: text(el), detail: 'right edge at ' + Math.round(el.getBoundingClientRect().right) + 'px' }));
  })()`);
  console.log(`\n1.4.10 Reflow at 320px: page scrolls sideways by ${await sideways()}px`);
  report('  outermost boxes past the edge outside a scroller', wide);
  await page.setViewportSize({ width: 1360, height: 800 });
}

if (only.includes('resize')) {
  const style = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  console.log(`\n1.4.4 Resize text (root 200%) at 1360px: page scrolls sideways by ${await sideways()}px`);
  report('  boxes that clip their text', await page.evaluate(CLIPPED));
  await style.evaluate((s) => s.remove());
}

if (only.includes('spacing')) {
  const style = await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-block-end: 2em !important; }' });
  for (const width of [1360, 360]) {
    await page.setViewportSize({ width, height: 800 });
    console.log('');
    report(`1.4.12 Text spacing at ${width}px, boxes that clip their text`, await page.evaluate(CLIPPED));
  }
  await style.evaluate((s) => s.remove());
  await page.setViewportSize({ width: 1360, height: 800 });
}

if (only.includes('obscured')) {
  const TAB = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (const [width, height] of [[1360, 800], [360, 640]]) {
    await page.setViewportSize({ width, height });
    await load();
    const hidden = []; const seen = new Set(); let last = null;
    // Date and time fields take one Tab per segment, so a repeat of the last stop is not the end.
    for (let i = 0; i < 2000; i++) {
      await page.keyboard.press(TAB);
      const r = await page.evaluate(`(() => {${HELPERS}
        const el = document.activeElement;
        if (!el || el === document.body) return { end: true };
        if (el.closest('dialog[open], :popover-open')) return { skip: true };
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return { skip: true };
        const pts = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([x, y]) => [b.left + b.width * x, b.top + b.height * y]);
        const cover = (t) => !t || (!el.contains(t) && !t.contains(el) && t.control !== el && !(el.labels && [...el.labels].includes(t)));
        const tops = pts.map(([x, y]) => document.elementFromPoint(x, y));
        const all = tops.every(cover);
        return { key: sig(el) + '@' + [...document.querySelectorAll('*')].indexOf(el), all, sig: sig(el), at: at(el), text: text(el), detail: all && tops[0] ? 'under ' + sig(tops[0]) : '' };
      })()`);
      if (r.end) break;
      if (r.skip) { await page.keyboard.press('Escape'); continue; }
      if (r.key === last) continue;
      if (seen.has(r.key)) break;
      seen.add(r.key); last = r.key;
      if (r.all) hidden.push(r);
    }
    console.log('');
    report(`2.4.11 Focus not obscured at ${width}px (${seen.size} stops), entirely covered`, hidden);
  }
}

if (aria) {
  await page.setViewportSize({ width: 1360, height: 800 });
  console.log(`\nAccessibility tree of ${aria}:`);
  console.log(await page.locator(aria).first().ariaSnapshot());
}

await browser.close();
