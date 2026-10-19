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
- `dist/cubicle.css` meters and progress: `.cb-meter` on `<meter>` and `<progress>` with a recessed
  track and a solid fill coloured by the browser's reading of `low` / `high` / `optimum` (neutral
  without them), a still hatch for indeterminate progress, `--sm` for table cells, a `--ticks`
  ruler, and `.cb-gauge` label / value / note. `dist/cubicle.js` marks `low` and `high` on
  `meter[data-cb-marks]` and follows changed and swapped-in meters. AGENTS.md §6 now allows
  `<progress>` engine pseudo-elements.
- `dist/cubicle.css` segmented controls: `.cb-segmented` on a `.cb-btn-group` turns labels with
  native radios or checkboxes into attached keys; the input covers its key and carries the focus
  ring, the checked key is sunk like an `aria-pressed` toggle, disabled keys (and `<fieldset
  disabled>` groups) are flat, a disabled checked key keeps a muted tint, and `--fill` spreads equal
  keys across the container. No script.
- `dist/cubicle.css` details and disclosure: `.cb-details` framed blocks with a summary row,
  trailing meta, a padded `__body`, shared seams when stacked (exclusive with `<details name>`),
  nesting, `--sm` and a frameless `--inline` variant. AGENTS.md §10 lists `<details name>` as
  progressive enhancement.
- `dist/cubicle.css` dialogs: `.cb-dialog` on `<dialog>`, built from the panel parts, raised in a
  strong frame with the float shadow; non-blocking with `popover` + `popovertarget` (no script),
  modal through `data-cb-modal` in `dist/cubicle.js` (`showModal()`) over a dimmed backdrop; the
  body scrolls between a fixed head and foot; `--sm`, `--lg`, `--danger`; full screen below 40rem.
  New token `--cb-bg-backdrop`; AGENTS.md §10 lists the popover API and modal `<dialog>`.
- `dist/cubicle.css` pagination: `.cb-pagination` with a range summary, an attached strip of
  `.cb-btn--sm` link keys (`aria-current` sinks the current page, now part of the shared `.cb-btn`
  pressed state), a `__gap` cell, a `__sizes` strip for rows per page, a GET `__jump` form,
  `--spaced` keys, and a collapse to ‹ current › below 30rem of its own width. No script.
- `dist/cubicle.css` inline code and keys (`.cb-code` recessed chip, `.cb-kbd` raised key) and the
  utilities layer: `.cb-mono`, `.cb-num`, `.cb-muted`, `.cb-text-ok` / `-warn` / `-danger` /
  `-info`, `.cb-text-xs`, `.cb-truncate` (also in table cells), `.cb-nowrap`, `.cb-break`,
  `.cb-sr-only` (one rule with the script's `[data-cb-sr]`) and `.cb-skip-link`. No spacing
  utilities.
- Density modes: tokens `--cb-control-h`, `--cb-control-h-sm`, `--cb-row-h` and `--cb-row-h-sm`
  size buttons, fields, tabs, table rows, navigation rows, details summaries and pagination keys;
  `data-cb-density="compact"` or `"comfortable"` on `<html>` or any subtree redefines them and
  the small spacing steps. Table cell padding is derived so a `.cb-btn--sm` fits every row.
  `scripts/check-tokens.mjs` reads defaults from `:root` and checks that density blocks only
  redefine declared tokens.
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
- `scripts/verify-browser.mjs`: ARIA tree keys (arrows, Home, End, Enter, `cb-toggle`), click to
  select and toggle, the focus ring on the row, and the no-script open tree; navigation checks for
  24px rows, the current or selected paint, label alignment, tree lines, the loading spinner (and
  its reduced-motion stop), silent breadcrumb separators, and screenshots.
- `scripts/verify-browser.mjs`: pixel checks for meters and progress (fill tone from the browser's
  low / high / optimum reading, contrast against the track, 12px and 6px tracks, a still
  indeterminate bar, ruler ticks and threshold marks), marks that follow changed and inserted
  meters, no marks without JavaScript, fill contrast pairs and screenshots.
- `scripts/verify-browser.mjs`: segmented controls (sunk checked keys, click and arrow keys,
  inputs that cover their keys, disabled keys and fieldsets, checkbox groups, equal `--fill` keys at
  1360 and 360px); state captures judge a segment by its key's text and follow the radio that
  takes focus in a group.
- `scripts/verify-browser.mjs`: details checks (one chevron rule across panels, nav, trees and
  details; summary heights; 1px seams; Enter, Space and named groups; meta at the row end; the
  frameless inline variant) and screenshots.
- `scripts/verify-browser.mjs`: modal dialog checks (opening as a modal with focus inside, inert
  page, backdrop token, widths and the danger stripe, Escape returning focus to the opener, a
  scrolling long body, typed confirmation, full screen below 40rem) and their no-JS hiding;
  tables inside closed dialogs are left out of the row-height check.
- `scripts/verify-browser.mjs`: pagination checks (sunk current keys, key size, seams and spaced
  gaps, disabled arrows out of the tab order, silent gap cells, the narrow collapse at 1360 and
  360px, the jump field's range) and screenshots.
- `scripts/verify-browser.mjs`: utilities checks (token values, truncation inside the table wrapper
  at 1360 and 360px, hidden text that still names its table and key, the skip link on the first
  Tab of a fresh page, code and key surfaces), text-tone contrast pairs and screenshots.
- `scripts/verify-browser.mjs`: `--browser chromium|firefox|webkit`; engine limits (Firefox's
  missing meter ruler, WebKit's unreadable clipboard) are reported as labelled skips; WebKit is
  driven with Option+Tab and Firefox with full keyboard access, as their keyboard users would.
  AGENTS.md §9 requires the minified build to pass in all three engines.
- `scripts/contrast-pairs.mjs`: the palette contrast pairs with their purpose, shared by
  `verify-browser.mjs` and the catalogue's generated contrast table.
- `scripts/verify-browser.mjs`: a keyboard audit that tabs through the whole page at 1360 and
  360px (a ring on every stop, no trap, no clipped ring; controls partly scrolled out of a
  container or the viewport are listed, as WCAG 2.4.11 allows), and a check that the catalogue
  contrast table matches the live ratios.
- `scripts/verify-browser.mjs`: density checks (field, segment, small key and row heights per
  mode, small keys inside their rows); table-row checks read the row height from the density tokens
  in force, and the segmented check clicks an unchecked key.
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
- Catalogue "Meters & progress" section: gauges in every state with ticks and threshold marks,
  determinate and indeterminate progress, compact meters in a table, accessibility notes and a
  reference table.
- Catalogue "Segmented controls" section: a range picker and a panel-head toolbar, a full-width
  form field, log-level checkboxes with counts, a status filter with lamps, disabled keys and a
  disabled fieldset, keyboard and reference tables.
- Catalogue "Details & disclosure" section: framed blocks with meta, an exclusive accordion,
  nested and compact blocks, inline advanced settings in a form, and a reference table.
- Catalogue "Modals & dialogs" section: a popover dialog, a modal revoke confirmation, a typed
  delete confirmation, a long form with a scrolling body, notes and a reference table; demo blocks
  no longer reset a dialog's auto margins.
- Catalogue "Pagination" section: full pagination under a table in a panel footer, separate keys
  on the first page, cursor paging, the narrow collapse, notes and a reference table.
- Catalogue "Utilities" section (own navigation group): text and numbers, wrapping and
  truncation, inline code and keys, visually hidden captions and labels, and a reference table.
- Catalogue "Density" subsection under Tokens: the per-mode size table and one panel shown in
  compact, default and comfortable density.
- Catalogue "Accessibility" section (own navigation group): a contrast table generated from the
  measured palette pairs, the focus ring and its placements with an inset-ring demo, a keyboard map
  of every component, motion and meaning rules, and the verified engines with their differences.

### Changed

- AGENTS.md no longer mentions a `reference/` directory; the project keeps no frozen design inputs.
- `.claude/hooks/guard-git.sh` blocks only a real `git push`, `git tag` or `git reset --hard`
  subcommand at a command start (after optional global options); the words inside commit
  messages or quoted strings no longer trip it.
- The catalogue uses its own utilities: `.cb-skip-link`, `.cb-nowrap` and `.cb-kbd` replace the
  docs-only skip link, nowrap cells and bare `<kbd>` (the base typography demo keeps a bare `<kbd>`).
- Collapsible panels, navigation and tree rows, and details share one disclosure chevron rule
  (§5.3); the panel chevron now uses the same 0.25rem margin as the others.
- Catalogue reference tables use `.cb-table` (row headers as `<th scope="row">`); the temporary
  `.docs-table` styles are removed from `docs/docs.css`.

### Fixed

- The `hidden` attribute now hides elements whose Cubicle class sets a display (a tab panel that is
  also a `.cb-stack` showed every panel); without the script ARIA tab panels still all show.
- `.cb-app__top` wraps its items, so a full top bar no longer overflows at 360px.
- Table cells use the tight line height, so one line of text fits the 20px row of a compact
  table in compact density (it measured 24.5px in a 24px row).
- Focus rings on scroll containers (`.cb-app__main`, `.cb-app__side`, `.cb-table-wrap`,
  `.cb-secret__value`, `.cb-panel--inset`, dialog bodies) and on keys of a scrolling tab list are
  drawn inside, so the scroll edge no longer clips them. AGENTS.md §2.2 and §13 list the permitted
  placements of the one focus indicator.
- Side and bottom edges of `.cb-input`, `.cb-select` and `.cb-check` mix 60% of the strong border
  into the main one, reaching 3:1 on canvas, surface and raised (were ≈2.4:1); the strong top
  edge and the inset shadow are unchanged.
- Focusing a control by keyboard keeps its whole focus ring in view: the ring rule adds a
  `scroll-margin`, so the browser no longer stops scrolling at the control's own edge.
