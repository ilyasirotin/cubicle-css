# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `dist/cubicle.css`: cascade layer order (`reset, tokens, base, layout, components, utilities`),
  a minimal zero-specificity reset, the full `--cb-*` design token set, and a document-level base
  layer (sans typography at 13px, accent links, monospace without ligatures for `code`/`kbd`/`samp`/`pre`,
  `color-scheme: light`, and the single `:focus-visible` ring).
- `scripts/check-snippets.mjs`: zero-dependency check that every catalogue demo matches its
  copy-paste snippet byte for byte and contains no inline styles.
- `docs/index.html` and `docs/docs.css`: catalogue shell with skip link, sticky navigation,
  Principles, and token reference (colour, depth and shadow, radius, motion and focus, spacing,
  typography) with a base typography demo.
- `scripts/check-tokens.mjs`: zero-dependency check that every token in `@layer tokens` is
  documented in the catalogue with the same value, and that every `var(--cb-*)` reference resolves.
- `dist/cubicle.css` layout layer: application shell `.cb-app` (`__top`, `__side`, `__main`,
  `__status`) as a fixed frame that fills the viewport or its size container and stacks the
  sidebar below 800px; layout primitives `.cb-stack` (`--tight`, `--loose`), `.cb-cluster`
  (`--end`, `--between`) and container-relative `.cb-grid` (`--2`, `--3`, `--4`).
- Tokens `--cb-radius-round` (round status indicators only) and `--cb-duration-spin` (stepped busy
  spinner), with their AGENTS.md rules and catalogue rows.
- Catalogue "Layout & grids" section: live application shell in a size-container frame, stack,
  cluster and grid demos with snippets and reference tables.
- `scripts/verify-browser.mjs`: captures rest, hover, focus and active screenshots of every distinct
  interactive demo control, checks text contrast in each pointer state and the focus ring, and
  checks that every button has an accessible name.
- `dist/cubicle.css` buttons: `.cb-btn` raised key with asymmetric bevel and 1px press travel;
  variants `--primary`, `--danger` (tinted, inline), `--danger-solid` (modal confirmations);
  sizes `--sm` and `--icon`; states `disabled`, `aria-disabled`, `aria-pressed` (sunk, no travel)
  and `aria-busy` (stepped spinner that stops under reduced motion); attached `.cb-btn-group`.
- `dist/cubicle.css` form controls: recessed `.cb-input` (text, textarea, file) and `.cb-select`
  with `readonly` (recessed monospace), `disabled`, `aria-invalid` / `:user-invalid` states and
  `--sm` size; custom `.cb-check` checkbox (with indeterminate) and round radio; `.cb-choice`
  labels; `.cb-field` with label, hint, error (shown only while invalid) and an automatic
  required marker; container-collapsing `.cb-field--horizontal`; `.cb-input-group` with addons;
  `.cb-range`. AGENTS.md now allows round radios, range engine pseudo-elements and `:user-invalid`.
- `dist/cubicle.js` (optional, dependency-free) and secret boxes: delegated `data-cb-copy`,
  `data-cb-reveal` (with `data-cb-reveal-timeout` re-masking) and `data-cb-download` actions that
  work on swapped markup; copy falls back to a hidden buffer on plain-HTTP pages and announces
  results through a live region. CSS hides script-only actions until `html[data-cb-js]`, tints
  copied buttons, and adds the multi-line `.cb-secret` well with an attached toolbar.
- `dist/cubicle.css` badges and LEDs: `.cb-badge` neutral tag; `--ok`, `--warn`, `--danger`,
  `--info` status badges with an LED lamp and `--off` with a hollow lamp; `--solid` and `--count`;
  `aria-busy` swaps the lamp for the stepped spinner, now shared with buttons; frameless `.cb-led`
  with the same modifiers. New token `--cb-shadow-highlight` for the badge and lamp top edge.
- `dist/cubicle.css` data tables: `.cb-table-wrap` scroll frame (`--scroll` limits the height);
  `.cb-table` styled by element with separate 1px borders, fixed 28px rows, zebra, instant hover,
  selection by `aria-selected` or a checked row `.cb-check`, `caption` and `tfoot` totals; cell
  helpers `__num`, `__select`, `__actions`, `__empty`; sortable headers (`__sort` + `aria-sort`);
  modifiers `--compact`, `--wrap` and `--sticky` (header and first column). `dist/cubicle.js`
  adds `data-cb-select-all` with indeterminate sync; the box stays hidden without the script.
- `dist/cubicle.css` alerts: `.cb-alert` with a 4px tone edge and a glyph tile (`--info`, `--ok`,
  `--warn`, `--danger`), `__title`, `__actions`, lists for error summaries, a `__close` key, `--sm`
  (one 28px line) and `--banner`; the shell gains an optional `.cb-app__banner` strip under the top
  bar. `dist/cubicle.js` adds `data-cb-dismiss`, which hides the target and moves focus on; the key
  stays hidden without the script.
- `dist/cubicle.css` tabs: `.cb-tabs` folder tabs for links (`aria-current`) and ARIA tabs
  (`role="tab"`, `aria-selected`), with counts, lamps and `aria-disabled`; a sideways-scrolling
  list, tabs in a `.cb-panel` head, `--vertical` (horizontal below 30rem), and a no-script layout
  that stacks every panel under its `.cb-tabs__heading`. `dist/cubicle.js` switches tabs inside
  `[data-cb-tabs]` on click and with arrow keys, Home and End; AGENTS.md now names its click and
  keydown listeners.
- `dist/cubicle.css` navigation and trees: `.cb-nav` with headings, 24px link rows (`aria-current`),
  `<details>` branches, counts and lamps; ARIA trees with `aria-expanded` / `aria-selected`, a focus
  ring on the row, `.cb-nav__kind` RDN chips, busy branches (shared spinner) and `--lines`
  connectors; `.cb-breadcrumb`. `dist/cubicle.js` adds the APG tree keys inside `[data-cb-tree]`,
  click/Enter/Space select and toggle, and a `cb-toggle` event for lazy loading.
- `scripts/build-min.sh` minifies `dist/cubicle.js` with terser (pinned dev dependency).
- `scripts/verify-browser.mjs`: `--js` override for the minified script, and checks for copy (incl.
  the plain-HTTP fallback), reveal and timed re-masking, download, and hiding of script-only
  actions without JavaScript.
- `scripts/verify-browser.mjs`: badge and LED check (text and lamp contrast, 20px height limit,
  busy spinner stopping under reduced motion), neutral tag contrast pairs, and badge screenshots.
- `scripts/verify-browser.mjs`: select-all behaviour (row sync, indeterminate, highlight, change
  events) and its no-JS hiding; table checks for row heights, sticky columns and header while
  scrolled, cell text contrast in every row paint, sort arrows, and table screenshots.
- `scripts/verify-browser.mjs`: alert dismiss from the keyboard (target hidden, focus moved on) and
  its no-JS hiding; alert checks for the 4px tone edge, glyph tile and its contrast, text and title
  contrast, compact height and square banners; alert contrast pairs and screenshots.
- `scripts/verify-browser.mjs`: ARIA tab behaviour (click, arrow keys by orientation, Home, End,
  wrapping, disabled tabs skipped) and the no-script stacked layout; tab checks for the merged
  selected tab, sideways scrolling at 360px, the End tab kept in view and vertical collapse; idle
  tab contrast and screenshots.
- `dist/cubicle.css` fieldsets and panels: `.cb-fieldset` group box (legend on the border, native
  `disabled` cascade); `.cb-panel` with `__head`, `__title`, `__body`, `__foot`; flush body whose
  children lose their own frame; recessed `--inset` well for logs and config previews; `--ok`,
  `--warn`, `--danger`, `--info` status stripes; collapsible `<details>` panels with a CSS chevron.
- Catalogue "Buttons" section: variants, states, sizes and icon buttons in a dense row, button
  groups, with snippets and a reference table of modifiers and state attributes.
- Catalogue "Inputs & fields" section: text field states, select and textarea, checkbox and radio,
  horizontal settings layout, input groups, small size, file and range, with a reference table.
- Catalogue "Secret boxes" section: masked API token with timed reveal, public key and peer ID
  copy, certificate and client configuration wells with copy and save, behaviour and fallback notes.
- Catalogue "Fieldsets & panels" section: group boxes (one disabled), panel anatomy, flush body
  with a log well, status stripes and collapsible panels, with a reference table.
- Catalogue "Status badges & LEDs" section: tags and statuses (with a busy badge), solid marks,
  counts in buttons and a panel head, an LED status line, an account panel in context,
  accessibility notes and a reference table.
- Catalogue "Tabs" section: ARIA tabs with a count, a lamp and a disabled tab, scrolling link
  tabs, tabs in a panel head, vertical tabs, a keyboard table and a reference table.
- Catalogue "Data tables" section: a sticky, selectable, sortable VPN session grid, a certificate
  table with a selected row, an audit log in a flush panel with wrapping cells and a scrolling
  sticky header, a compact table with caption and totals, an empty state, accessibility notes
  and a reference table.
- Catalogue "Alerts" section: tones with actions and dismiss, compact alerts above a table, an
  error summary linking to invalid fields, banners in a shell frame, accessibility notes and a
  reference table; the shell reference lists `.cb-app__banner`.
- Catalogue "Tree views & navigation" section: sidebar navigation with branches, counts and a
  lamp, a directory tree with lines, kinds, a selected user and a loading branch, a DN breadcrumb,
  keyboard and reference tables; the Layout shell sidebar now uses `.cb-nav`.

### Changed

- Catalogue reference tables use `.cb-table` (row headers as `<th scope="row">`); the temporary
  `.docs-table` styles are removed from `docs/docs.css`.
