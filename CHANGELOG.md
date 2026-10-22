# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The first release of Cubicle.

### Added

- **Foundation.** `dist/cubicle.css` with the cascade layers `reset, tokens, base, layout,
  components, utilities` and a minimal zero-specificity reset. The `--cb-*` design tokens cover
  colour, depth, radius, spacing, size, type, motion and focus. An opt-in base layer styles body
  text, links and monospace without ligatures, plus one `:focus-visible` ring that is drawn inside
  scroll containers and kept in view while focus scrolls. Light only.
- **Layout.** The `.cb-app` shell (top bar, banner strip, sidebar, main, status bar) is a fixed
  frame that stacks below 800px; there the sidebar folds away behind a Menu key in the top bar
  (`.cb-app__toggle`, script) and stays open without the script. `.cb-stack`, `.cb-cluster` and
  container-relative `.cb-grid` lay pages out; `.cb-split` puts a list and its detail side by side
  and stacks them by its own width; `.cb-center` puts one panel in the middle of the frame for
  sign-in, error and maintenance pages. Density modes `data-cb-density="compact"` and
  `"comfortable"` work on any subtree, panel heads included.
- **Buttons.** `.cb-btn` raised keys with 1px press travel come in primary, tinted-danger and
  solid-danger variants, small and icon sizes, and attached groups. Toggle (`aria-pressed`), busy
  (stepped spinner) and disabled states.
- **Fields.** Recessed `.cb-input` and `.cb-select` with tabular figures and readonly, invalid
  (`aria-invalid`, `:user-invalid`), disabled, focusable disabled inputs (`aria-disabled` with
  `readonly`) and busy states.
  Also check boxes and radios on 24px rows, so stacked lists meet the WCAG 2.5.8 target size,
  horizontal and stacked `.cb-field` layouts with hints, errors and required marks, input groups,
  file and range inputs, and list boxes whose checked options take the selected tint. Number and search fields drop the engines' spin and clear keys, and colour
  fields are a swatch key two control heights wide. A `.cb-tokens` token field holds several
  values (address blocks, scopes, groups) as chips in one well; each chip sends its value through a
  checked box, so without the script unticking a box drops the value.
- **Catalogue snippets.** Syntax-highlighted with line numbers (Prism, inlined in `docs/index.html`,
  nothing shipped in `dist/`), collapsed by default, scrolling past 20 lines, and copied whole by a
  click or Enter, with a "Copied" note in the header and a live-region message.
- **Secret boxes.** `.cb-secret` wells and single-line secrets with copy, reveal and save actions.
- **Fieldsets and panels.** `.cb-fieldset` group boxes with a group error. `.cb-panel` with head,
  title, body (also flush) and foot, status stripes, recessed wells and collapsible `<details>`
  panels.
- **Tabs.** `.cb-tabs` folder tabs for links and for ARIA tabs, with counts, lamps, disabled tabs
  (native or `aria-disabled`), tabs in a panel head and vertical tabs.
- **Data tables.** `.cb-table` styled by element, in a scrolling `.cb-table-wrap`. Zebra rows,
  instant hover, row selection, disabled rows, sortable headers, a sticky header and first
  column, compact and wrapping modes, totals, captions and an empty state.
- **Property lists.** `.cb-props` key-value lists on `<dl>` for inspector views, framed like a
  table: bare `dt` / `dd` pairs or a `<div>` per row, extra values under the first, 28px rows that
  follow the density, and key above value when the list is narrower than 28rem.
- **Busy containers.** `aria-busy="true"` on a table body (or a whole table, head excluded), a
  panel body or a property list mutes its text over a still hatch fixed to the viewport and shows
  a progress cursor, with no layout shift and nothing blocked. Tables and lists inside a busy
  panel body are hatched too.
- **Empty states.** `.cb-empty` for panels, lists and trees with nothing to show: muted, centred
  text with an optional title and keys, framed by its container. It replaces a tree whose filter
  matched nothing, and shares its look with the table's empty row.
- **Menus.** `.cb-menu` action menus for rows and panels: a popover list that no scrolling wrapper
  clips, opened by a key with `popovertarget` and `aria-haspopup="menu"` (with a down chevron, sunk
  while open), 24px items with danger and disabled looks, separators, and the focus ring inside the
  list. Escape and an outside click close it natively.
- **Logs.** `.cb-log` on `<ol>`: a recessed, scrolling monospace well with line numbers that honour
  `start` and are left out of a copy, aligned time, level and message columns (subgrid),
  `data-cb-level` tones with a 2px edge on warnings and errors, a highlighted `:target` line, wrapping
  messages and a `--nowrap` mode that scrolls sideways.
- **Badges, chips and LEDs.** `.cb-badge` tags, status badges with lamps, solid and count badges, a
  busy badge, and frameless `.cb-led`. Removable chips: `.cb-chips` lists of `.cb-chip` values with a
  24px remove key (`.cb-chip__remove`, a native button), for active filters and lists of values; no
  script.
- **Alerts.** `.cb-alert` with a 4px tone edge and glyph, titles, actions, error summaries with
  24px link spacing, a dismiss key, a compact size and page-wide banners. A `.cb-toasts` stack in
  the bottom-end corner holds compact alerts the server sends: a polite live region that reads each
  new message alone, lets clicks pass around its messages and keeps them until they are closed or
  replaced.
- **Navigation and trees.** `.cb-nav` link navigation with `<details>` branches and disabled
  links. ARIA directory trees with RDN kind chips, loading branches and connector lines.
  `.cb-breadcrumb`.
- **Meters and progress.** `.cb-meter` on `<meter>` and `<progress>` coloured by `low`, `high` and
  `optimum`, a still indeterminate state, ticks and threshold marks, a compact size, and
  `.cb-gauge`.
- **Segmented controls.** `.cb-segmented` turns native radios or check boxes into attached keys,
  with a full-width option.
- **Details.** `.cb-details` framed and inline disclosure, stacked accordions (exclusive with
  `<details name>`) and a compact size.
- **Dialogs.** `.cb-dialog` built from the panel parts, as non-blocking popovers or modals over a
  dimmed backdrop. Small, large and danger variants, typed confirmation, and a full-screen layout
  on narrow screens.
- **Pagination.** `.cb-pagination` with a range summary, attached or spaced page keys, a gap cell,
  rows-per-page keys, a jump form, a cursor variant and a narrow collapse.
- **Inline code, keys and utilities.** `.cb-code` and `.cb-kbd`. Utilities for monospace, tabular
  figures, muted and tone text, small text, truncation, no-wrap, breaking long tokens,
  visually hidden text and skip links. The `hidden` attribute always hides.
- **Print.** The application frame unrolls into one column without the sidebar, actions, the
  Menu key and toasts are hidden, scrolling wrappers and logs print in full, and rows and lines
  stay whole across pages.
- **Forced colours and right to left.** In forced palettes (Windows High Contrast) selected,
  pressed, current and checked items take `Highlight`, unavailable controls `GrayText`, and marks,
  lit lamps, sort arrows and the spinner stay visible; system colour keywords live only in
  `@media (forced-colors: active)`. Under `dir="rtl"` the select chevron, accent bars, the vertical
  tab line, disclosure and menu chevrons and meter marks mirror. Autofill keeps the engine's tint.
- **`dist/cubicle.js`.** Optional progressive enhancement through `data-cb-*` attributes and
  delegated listeners: copy (with a plain-HTTP fallback), reveal, download, toggle, select-all (which
  follows rows swapped in or disabled), dismiss, ARIA tabs, ARIA trees, meter marks, modal dialogs,
  output readouts, menus (placed at their key, arrow keys, Home, End and Tab; closed by an item
  click, a scroll that moves the key, or a resize) and token fields (Enter, separators and a pasted
  list add values, checked against the entry's pattern and the list; keys, Delete and Backspace
  remove them). Script-only controls stay hidden without it.
- **Catalogue.** `docs/index.html` shows every token and component in every state, with a
  copy-paste snippet identical to the live markup and a reference table. It also has a generated
  contrast table, a measured target-size table (compact density trades 2.5.8 for density), a
  keyboard map, notes on forced colours, autofill and right to left (with a
  `dir="rtl"` demo), framework-neutral recipes for server updates (htmx attributes, an htmx page
  listener, plain `fetch`) and server-pushed toasts (htmx out of band, a DOM helper, optional
  auto-hide), and a Recipes section (filter bar with active-filter chips, inspector, sign-in with
  MFA, masked secret, tag colour, wizard steps, tooltips, print). Demo tables are named, row keys name their row, and scroll
  boxes without controls take focus.
- **Example.** `docs/example.html` is a complete VPN console screen: the shell with a folding
  sidebar and a directory tree, and a gateway panel with Overview (alert, gauges, property list),
  Peers (an inspector with row action menus, select-all, pagination, and a Refresh that shows a busy
  table and then a toast), Config (a horizontal form with secrets and advanced settings) and Log
  tabs, plus revoke and delete confirmations.
- **Development tools.**
  - `scripts/check-snippets.mjs` and `scripts/check-tokens.mjs` (which also keeps system colours
    inside forced-colours blocks).
  - `scripts/verify-browser.mjs`: contrast, focus, keyboard audit, layout, state, behaviour,
    forced-colours, right-to-left, print and target-size checks, and names of tables, row keys
    and scroll boxes, in Chromium, Firefox and WebKit, with labelled engine limits;
    `scripts/verify-matrix.mjs` runs both pages in all three engines side by side (`--min` adds the
    minified build); `scripts/contrast-pairs.mjs` holds the palette pairs.
  - `scripts/build-min.sh` builds the minified files (lightningcss, terser).
  - A Claude Code hook that blocks pushes, tags and releases.
