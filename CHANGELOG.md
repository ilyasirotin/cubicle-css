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
- `dist/cubicle.css` fieldsets and panels: `.cb-fieldset` group box (legend on the border, native
  `disabled` cascade); `.cb-panel` with `__head`, `__title`, `__body`, `__foot`; flush body whose
  children lose their own frame; recessed `--inset` well for logs and config previews; `--ok`,
  `--warn`, `--danger`, `--info` status stripes; collapsible `<details>` panels with a CSS chevron.
- Catalogue "Buttons" section: variants, states, sizes and icon buttons in a dense row, button
  groups, with snippets and a reference table of modifiers and state attributes.
- Catalogue "Inputs & fields" section: text field states, select and textarea, checkbox and radio,
  horizontal settings layout, input groups, small size, file and range, with a reference table.
- Catalogue "Fieldsets & panels" section: group boxes (one disabled), panel anatomy, flush body
  with a log well, status stripes and collapsible panels, with a reference table.
