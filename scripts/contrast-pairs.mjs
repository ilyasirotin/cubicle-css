// Contrast pairs of the Cubicle palette. Development tool only; not part of the shipped kit.
//
// One list serves two readers: verify-browser.mjs measures every pair (checks 6 and 22), and the
// catalogue's Accessibility section prints them as its contrast table. Edit this list when tokens
// or derived mixes change, then regenerate the catalogue table.
//
// Each entry: [foreground, background, minimum ratio, purpose]. A colour is a --cb-* token name
// or any CSS colour expression (color-mix of tokens).

const tints = (tones, base) => tones.map((c) => `color-mix(in srgb, var(${c}) 10%, var(${base}))`);

export const PAIRS = [
  // Primary ink across all neutral surfaces
  ...['--cb-bg-canvas', '--cb-bg-surface', '--cb-bg-raised', '--cb-bg-btn', '--cb-bg-recessed', '--cb-bg-header',
    '--cb-bg-zebra', '--cb-bg-hover', '--cb-bg-selected'].map((bg) => ['--cb-text-main', bg, 4.5, 'Primary text']),
  ['--cb-text-main', 'color-mix(in srgb, var(--cb-bg-selected) 70%, var(--cb-bg-raised))', 4.5, 'Primary text: selected row, hovered'],
  ['--cb-text-main', 'color-mix(in srgb, var(--cb-bg-header) 50%, var(--cb-bg-surface))', 4.5, 'Primary text: table totals'],

  // Muted ink across main reading surfaces
  ...['--cb-bg-canvas', '--cb-bg-surface', '--cb-bg-raised', '--cb-bg-recessed', '--cb-bg-header']
    .map((bg) => ['--cb-text-muted', bg, 4.5, 'Muted text: hints, metadata']),
  ['--cb-text-muted', 'color-mix(in srgb, var(--cb-bg-header) 60%, var(--cb-bg-surface))', 4.5, 'Muted text: idle tabs'],

  // Inverse ink on solid fills
  ...['--cb-accent', '--cb-ok', '--cb-warn', '--cb-danger', '--cb-info', '--cb-text-main']
    .map((bg) => ['--cb-text-inverse', bg, 4.5, 'Inverse text: solid buttons, badges, glyphs']),

  // Tones on their 10% tints and on the page
  ['--cb-danger', 'color-mix(in srgb, var(--cb-danger) 10%, var(--cb-bg-btn))', 4.5, 'Tinted danger button'],
  ...['--cb-ok', '--cb-warn', '--cb-danger', '--cb-info', '--cb-text-muted'].map((c) =>
    [c, tints([c], '--cb-bg-surface')[0], 4.5, 'Status badges, alert titles']),
  ['--cb-text-main', 'color-mix(in srgb, var(--cb-text-main) 10%, var(--cb-bg-surface))', 4.5, 'Neutral tag'],
  ...tints(['--cb-ok', '--cb-warn', '--cb-danger', '--cb-info'], '--cb-bg-surface').map((bg) => ['--cb-text-main', bg, 4.5, 'Alert body text']),
  ['--cb-accent', 'color-mix(in srgb, var(--cb-danger) 10%, var(--cb-bg-surface))', 4.5, 'Links in a danger alert'],
  ...['--cb-ok', '--cb-warn', '--cb-danger', '--cb-info'].flatMap((c) => ['--cb-bg-surface', '--cb-bg-raised', '--cb-bg-canvas']
    .map((bg) => [c, bg, 4.5, 'Text tones (.cb-text-*)'])),

  // Log levels on the recessed well and on a linked (:target) line
  ...['--cb-info', '--cb-warn', '--cb-danger'].flatMap((c) => ['--cb-bg-recessed', '--cb-bg-selected']
    .map((bg) => [c, bg, 4.5, 'Log levels'])),
  ['--cb-text-muted', '--cb-bg-selected', 4.5, 'Log numbers and times: linked line'],

  // Non-text: boundaries, fills and the focus ring (>= 3)
  ...['--cb-bg-surface', '--cb-bg-raised', '--cb-bg-canvas'].map((bg) =>
    ['color-mix(in srgb, var(--cb-border-strong) 60%, var(--cb-border-main))', bg, 3, 'Field and checkbox edges']),
  ['--cb-border-strong', '--cb-bg-surface', 3, 'Strong edges: field tops, pinned columns'],
  ['--cb-border-strong', '--cb-bg-raised', 3, 'Strong edges: field tops, dialog frame'],
  ...['--cb-ok', '--cb-warn', '--cb-danger', '--cb-accent'].map((c) => [c, '--cb-bg-recessed', 3, 'Meter and progress fills']),
  ['--cb-accent', '--cb-bg-surface', 3, 'Focus ring, accent bars'],
  ['--cb-accent', '--cb-bg-canvas', 3, 'Focus ring, accent bars'],
];

// WCAG 2 relative luminance and contrast ratio of two sRGB triples.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Resolves every colour of PAIRS in the page (so tokens and mixes are the browser's own) and
// returns the pairs with their measured ratio.
export const measurePairs = async (page) => {
  const names = [...new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]))];
  const rgb = await page.evaluate((list) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const probe = document.body.appendChild(document.createElement('div'));
    const out = {};
    for (const n of list) {
      probe.style.color = n.startsWith('--') ? `var(${n})` : n;
      g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = getComputedStyle(probe).color; g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data; out[n] = [d[0], d[1], d[2]];
    }
    probe.remove(); return out;
  }, names);
  return PAIRS.map(([fg, bg, need, purpose]) => ({ fg, bg, need, purpose, ratio: rgb[fg] && rgb[bg] ? ratio(rgb[fg], rgb[bg]) : null }));
};

// Short label of a colour expression for reports and the catalogue table.
export const label = (c) => c.replace(/color-mix\(in srgb, var\((--[a-z-]+)\) (\d+)%, var\((--[a-z-]+)\)\)/, 'mix($1 $2%, $3)');
