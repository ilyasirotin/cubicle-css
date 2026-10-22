// Contrast pairs of the Cubicle palette. Development tool only; not part of the shipped kit.
//
// One list serves two readers: verify-browser.mjs measures every pair (checks 6 and 22), and the
// catalogue's Accessibility section prints them as its contrast table. Edit this list when tokens
// or derived mixes change, then regenerate the catalogue table.
//
// Each entry: [foreground, background, minimum ratio, purpose]. A colour is a --cb-* token name
// or any CSS colour expression (color-mix of tokens).

// --- Configuration -----------------------------------------------------------------

const TEXT_MINIMUM = 4.5;
const NON_TEXT_MINIMUM = 3;

const STATUS_TONES = ['--cb-ok', '--cb-warn', '--cb-danger', '--cb-info'];
const PAGE_SURFACES = ['--cb-bg-surface', '--cb-bg-raised', '--cb-bg-canvas'];

const PRIMARY_TEXT_SURFACES = [
  '--cb-bg-canvas',
  '--cb-bg-surface',
  '--cb-bg-raised',
  '--cb-bg-btn',
  '--cb-bg-recessed',
  '--cb-bg-header',
  '--cb-bg-zebra',
  '--cb-bg-hover',
  '--cb-bg-selected',
];
const MUTED_TEXT_SURFACES = ['--cb-bg-canvas', '--cb-bg-surface', '--cb-bg-raised', '--cb-bg-recessed', '--cb-bg-header'];
const INVERSE_TEXT_FILLS = ['--cb-accent', '--cb-ok', '--cb-warn', '--cb-danger', '--cb-info', '--cb-text-main'];
const BADGE_TONES = ['--cb-ok', '--cb-warn', '--cb-danger', '--cb-info', '--cb-text-muted'];
const LOG_LEVEL_TONES = ['--cb-info', '--cb-warn', '--cb-danger'];
const LOG_LINE_SURFACES = ['--cb-bg-recessed', '--cb-bg-selected'];
const METER_FILL_TONES = ['--cb-ok', '--cb-warn', '--cb-danger', '--cb-accent'];
const FIELD_EDGE = 'color-mix(in srgb, var(--cb-border-strong) 60%, var(--cb-border-main))';

// Turns "color-mix(in srgb, var(--a) 10%, var(--b))" into "mix(--a 10%, --b)".
const COLOR_MIX_PATTERN = /color-mix\(in srgb, var\((--[a-z-]+)\) (\d+)%, var\((--[a-z-]+)\)\)/;

// --- Helpers -----------------------------------------------------------------------

// The 10% tint of a tone over a base surface, as the stylesheet mixes it.
function tintOf(tone, base) {
  return `color-mix(in srgb, var(${tone}) 10%, var(${base}))`;
}

// WCAG 2 linear value of one 0-255 sRGB channel.
function linearChannel(channel) {
  const normalized = channel / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

// WCAG 2 relative luminance of an [r, g, b] triple.
function relativeLuminance([red, green, blue]) {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

// WCAG 2 contrast ratio of two [r, g, b] triples, from 1 to 21.
export function contrastRatio(firstRgb, secondRgb) {
  const firstLuminance = relativeLuminance(firstRgb);
  const secondLuminance = relativeLuminance(secondRgb);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

// Short label of a colour expression for reports and the catalogue table.
export function colourLabel(colour) {
  return colour.replace(COLOR_MIX_PATTERN, 'mix($1 $2%, $3)');
}

// --- Pairs -------------------------------------------------------------------------

// The order of this list is the order of the catalogue's table.
function buildPairs() {
  const pairs = [];

  // Primary ink across all neutral surfaces
  for (const surface of PRIMARY_TEXT_SURFACES) {
    pairs.push(['--cb-text-main', surface, TEXT_MINIMUM, 'Primary text']);
  }
  pairs.push(['--cb-text-main', 'color-mix(in srgb, var(--cb-bg-selected) 70%, var(--cb-bg-raised))', TEXT_MINIMUM, 'Primary text: selected row, hovered']);
  pairs.push(['--cb-text-main', 'color-mix(in srgb, var(--cb-bg-header) 50%, var(--cb-bg-surface))', TEXT_MINIMUM, 'Primary text: table totals']);

  // Muted ink across main reading surfaces
  for (const surface of MUTED_TEXT_SURFACES) {
    pairs.push(['--cb-text-muted', surface, TEXT_MINIMUM, 'Muted text: hints, metadata']);
  }
  pairs.push(['--cb-text-muted', 'color-mix(in srgb, var(--cb-bg-header) 60%, var(--cb-bg-surface))', TEXT_MINIMUM, 'Muted text: idle tabs']);

  // Inverse ink on solid fills
  for (const fill of INVERSE_TEXT_FILLS) {
    pairs.push(['--cb-text-inverse', fill, TEXT_MINIMUM, 'Inverse text: solid buttons, badges, glyphs']);
  }

  // Tones on their 10% tints and on the page
  pairs.push(['--cb-danger', 'color-mix(in srgb, var(--cb-danger) 10%, var(--cb-bg-btn))', TEXT_MINIMUM, 'Tinted danger button']);
  for (const tone of BADGE_TONES) {
    pairs.push([tone, tintOf(tone, '--cb-bg-surface'), TEXT_MINIMUM, 'Status badges, alert titles']);
  }
  pairs.push(['--cb-text-main', 'color-mix(in srgb, var(--cb-text-main) 10%, var(--cb-bg-surface))', TEXT_MINIMUM, 'Neutral tag']);
  for (const tone of STATUS_TONES) {
    pairs.push(['--cb-text-main', tintOf(tone, '--cb-bg-surface'), TEXT_MINIMUM, 'Alert body text']);
  }
  pairs.push(['--cb-accent', 'color-mix(in srgb, var(--cb-danger) 10%, var(--cb-bg-surface))', TEXT_MINIMUM, 'Links in a danger alert']);
  for (const tone of STATUS_TONES) {
    for (const surface of PAGE_SURFACES) {
      pairs.push([tone, surface, TEXT_MINIMUM, 'Text tones (.cb-text-*)']);
    }
  }

  // Log levels on the recessed well and on a linked (:target) line
  for (const tone of LOG_LEVEL_TONES) {
    for (const surface of LOG_LINE_SURFACES) {
      pairs.push([tone, surface, TEXT_MINIMUM, 'Log levels']);
    }
  }
  pairs.push(['--cb-text-muted', '--cb-bg-selected', TEXT_MINIMUM, 'Log numbers and times: linked line']);

  // Non-text: boundaries, fills and the focus ring (>= 3)
  for (const surface of PAGE_SURFACES) {
    pairs.push([FIELD_EDGE, surface, NON_TEXT_MINIMUM, 'Field and checkbox edges']);
  }
  pairs.push(['--cb-border-strong', '--cb-bg-surface', NON_TEXT_MINIMUM, 'Strong edges: field tops, pinned columns']);
  pairs.push(['--cb-border-strong', '--cb-bg-raised', NON_TEXT_MINIMUM, 'Strong edges: field tops, dialog frame']);
  for (const tone of METER_FILL_TONES) {
    pairs.push([tone, '--cb-bg-recessed', NON_TEXT_MINIMUM, 'Meter and progress fills']);
  }
  pairs.push(['--cb-accent', '--cb-bg-surface', NON_TEXT_MINIMUM, 'Focus ring, accent bars']);
  pairs.push(['--cb-accent', '--cb-bg-canvas', NON_TEXT_MINIMUM, 'Focus ring, accent bars']);

  return pairs;
}

export const PAIRS = buildPairs();

// --- Measurement -------------------------------------------------------------------

// Resolves every colour of PAIRS in the page (so tokens and mixes are the browser's own) and
// returns the pairs with their measured ratio, or null for a colour the page could not resolve.
export async function measurePairs(page) {
  const colourNames = new Set();
  for (const [foreground, background] of PAIRS) {
    colourNames.add(foreground);
    colourNames.add(background);
  }

  // A 1x1 canvas turns any computed colour into its sRGB bytes.
  const rgbByColour = await page.evaluate((colours) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
    const probe = document.body.appendChild(document.createElement('div'));
    const rgbByName = {};
    for (const colour of colours) {
      probe.style.color = colour.startsWith('--') ? `var(${colour})` : colour;
      canvasContext.clearRect(0, 0, 1, 1);
      canvasContext.fillStyle = '#000';
      canvasContext.fillStyle = getComputedStyle(probe).color;
      canvasContext.fillRect(0, 0, 1, 1);
      const pixel = canvasContext.getImageData(0, 0, 1, 1).data;
      rgbByName[colour] = [pixel[0], pixel[1], pixel[2]];
    }
    probe.remove();
    return rgbByName;
  }, [...colourNames]);

  const measured = [];
  for (const [fg, bg, need, purpose] of PAIRS) {
    const bothResolved = rgbByColour[fg] && rgbByColour[bg];
    const ratio = bothResolved ? contrastRatio(rgbByColour[fg], rgbByColour[bg]) : null;
    measured.push({ fg, bg, need, purpose, ratio });
  }
  return measured;
}
