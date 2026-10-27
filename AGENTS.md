# AGENTS.md — Cubicle Design System & UI/UX Guidelines

## 1. Project Overview

**Cubicle** is a minimalist, high-density, functional CSS framework for critical enterprise tools: IAM portals, VPN admin panels, infrastructure consoles and back-office dashboards.

**Neo-Enterprise Utilitarianism.** Cubicle takes the functional design code of late-90s and early-2000s enterprise software (clear affordances, tactile depth, high density, unambiguous states) but is **not** a retro parody theme like 98.css: no pixel fonts, dated system icons or nostalgic gimmicks. Every border, shadow and background shift serves structure, interactivity or system state. Controls look like what they do.

---

## 2. Visual Language

### 2.1. Tactility, Depth and Corners
- **Buttons and triggers** look raised: `--cb-bg-btn` surface, `--cb-grad-btn` micro-gradient, `--cb-shadow-outset`, and dual-tone borders (lighter top/left `--cb-border-main`, darker bottom/right `--cb-border-strong`).
- **Pressed** controls move `translate: 0 1px` and invert the lighting (`--cb-shadow-pressed`, no gradient).
- **Inputs and wells** (fields, selects, code blocks, logs) look recessed: `--cb-shadow-inset`, a darker top border `--cb-border-strong`, a crisp `1px` border.
- **Corners** are `0` or `2px`–`3px`; never pills or `8px+` cards. Only LED dots, the busy spinner and radio buttons are round (`--cb-radius-round`).

### 2.2. Colour, Contrast and Focus
- Layered cool neutrals (canvas, surface, button, header) separate panels, toolbars and workspaces instead of heavy shadows.
- **Themes** swap the palette: `data-cb-theme="glacier"` (the default), `"steel"` (the 1.0 palette), `"industrial"` or `"monochrome"` on `<html>` or any subtree. A theme is one `[data-cb-theme="name"]` block in `@layer tokens` that declares exactly the 21 palette tokens (surfaces but the backdrop, ink, borders, status); shades, the focus ring and the backdrop derive from it (section 2.9 of the stylesheet). Every theme passes every pair of `scripts/contrast-pairs.mjs`, the `themes` check group and a full `verify-browser --theme <name>` run. All themes are light; there is no dark theme.
- Text and borders meet WCAG AA/AAA. Borders between table cells, form groups and panels are always a visible `1px solid`, never whitespace alone.
- Colour is reserved for communication and primary affordances, in restrained enterprise tones: `--cb-accent` blue (steel navy in steel, teal in industrial, black in monochrome), `--cb-ok` green, `--cb-warn` amber, `--cb-danger` red, `--cb-info` a blue apart from the accent; status tones stay distinct hues in every theme. Inline destructive actions in dense tables use a danger tint (`.cb-btn--danger`); critical modal confirmations use the solid danger tone (`.cb-btn--danger-solid`).
- **Focus** is unmistakable: `--cb-focus-ring` (`2px solid var(--cb-accent)`) at a `1px` offset, drawn outside by default. It is drawn inside on scroll containers, where an outer ring would be clipped (except a sticky table's wrapper, whose pinned cells would cover it), and on the keys of a scrolling tab list; it sits on the row label of a tree item, and on the well of a token field while its entry has focus.

### 2.3. Typography
- UI text uses `--cb-font-sans`. Technical data (IPs, CIDRs, UUIDs, hashes, SSH keys, ports, timestamps, logs) defaults to or easily takes `--cb-font-mono`.
- Numbers in tables, metrics and counters use `font-variant-numeric: tabular-nums`.
- Compact scale: base `13px` (`--cb-text-sm`) with tight line heights.

---

## 3. Layout, Density & Responsiveness

### 3.1. High Information Density
- Tight, purposeful spacing: a 1080p screen shows 20–30 table rows or a complex multi-section form without scrolling.
- `data-cb-density="compact"` or `"comfortable"` on `<html>` or any subtree redefines control and row heights (`--cb-control-h`, `--cb-row-h` and their `-sm` steps) and the small spacing steps; type sizes never change. The default needs no attribute.
- Group explicitly with `<fieldset>` and `<legend>`, bordered panels and header bars.

### 3.2. Responsiveness
- Desktop-first, mobile-ready; verified at `360px`, `800px` and `1360px`.
- Wide tables scroll horizontally in `.cb-table-wrap` without breaking the page. Sidebars, trees and multi-column grids collapse on narrow viewports.

---

## 4. Core Component Patterns

1. **Tables (`.cb-table`):** `1px` cell borders, zebra rows (`--cb-bg-zebra`), instant hover and selected highlight; inline `.cb-btn--sm` actions fit the row height.
2. **Forms (`.cb-field`, `.cb-input`, `.cb-select`):** stacked and horizontal (label left) layouts; `readonly` (recessed monospace), `disabled`, `aria-invalid="true"` and editable states are clearly distinct.
3. **Badges (`.cb-badge`):** compact bordered tags with `::before` LED status dots and an inset top highlight.
4. **Secrets (`.cb-secret`):** recessed monospace boxes for tokens, keys and certificates, with attached tactile action buttons.
5. **Navigation and trees (`.cb-nav`):** LDAP / Active Directory hierarchies, organisational units, console navigation.
6. **Alerts and dialogs (`.cb-alert`, `<dialog>`):** a `4px solid` semantic left border; stark dialog boxes.
7. **Property lists (`.cb-props`):** a `<dl>` framed like a table, keys on the left; it stacks key over value when its own width is narrow.

**Out of scope, by decision:** diff views and code viewers (added / removed lines, syntax highlighting, editor behaviour). `.cb-log` and `.cb-code` show plain text; a host that needs them embeds a third-party editor.

---

## 5. Anti-Patterns (Forbidden)
- **Glassmorphism / neomorphism:** no `backdrop-filter: blur`, neon glows or soft low-contrast extruded shadows.
- **Slow or bouncy motion:** transitions last at most `50ms` (`--cb-duration`). The only loop is a busy indicator: it rotates in discrete steps over `--cb-duration-spin` and stops under `prefers-reduced-motion: reduce`.
- **Ghost inputs:** no borderless inputs that only show an underline on hover or focus.
- **Marketing bloat:** no hero banners, pricing cards, carousels or oversized promotional type.

---

## 6. Technical Constraints
- **Zero build, zero dependencies.** Every rule must earn its bytes.
- **Token discipline.** No hard-coded colour, radius, duration or shadow outside `:root` tokens. Derived states use `color-mix(in srgb, …)` on base tokens instead of new tokens. System colour keywords (`Canvas`, `CanvasText`, `Highlight`, `GrayText`, …) are allowed only inside `@media (forced-colors: active)`; `scripts/check-tokens.mjs` enforces it.
- **Selector hygiene.** No ID selectors, no `!important`, no inline styles in documentation examples.
- **Self-contained.** No third-party icons, external images, CDNs or remote `@import`. Indicators use CSS geometry, Unicode, or inline SVG data-URIs where strictly necessary.
- **Standards first.** No vendor-prefixed properties. Engine-specific pseudo-elements only where no standard way exists, each with an explanatory comment: `<meter>` and `<progress>` bars and values (including Firefox's meter state pseudo-classes), the `<details>` marker, range track and thumb, and the hidden number spin buttons and search clear key.
- **Semantic transparency.** Every component is understandable from its HTML alone.
- **HTMX and framework interoperability.** States are standard attributes (`disabled`, `readonly`, `open`, `aria-current`, `aria-selected`, `aria-invalid`, `aria-busy`, `aria-pressed`), so server swaps work without JS class toggling. `dist/cubicle.js` hooks `data-cb-*` attributes through delegated listeners on the document (capture for the non-bubbling popover `beforetoggle` / `toggle`; scroll and resize close open menus), so swapped markup needs no re-initialisation. Script-only controls stay hidden until the script runs.

---

## 7. Naming, Specificity & Code Style
- **Prefix:** classes `cb-`, custom properties `--cb-`, data attributes `data-cb-`.
- **BEM-lite:** `cb-btn`, `cb-btn--primary`, `cb-panel__head`.
- **Attribute-first states:** `[disabled]`, `[readonly]`, `[aria-busy]`, `[aria-invalid]`, `[aria-selected]`, `[aria-pressed]`; state classes only where no standard attribute exists.
- **Cascade layers:** `@layer reset, tokens, base, layout, components, utilities;` keeps specificity predictable and host overrides free of `!important`.
- **Nesting:** at most two levels, only for pseudo-states, attribute states and direct children of one component.
- **Private properties:** `--_name` (`--_bg`, `--_ink`, `--_border-top`), scoped to the component root; never self-referencing.
- **Human-First Code** (`dist/cubicle.js`, `scripts/`, `.claude/**/scripts/`, shell), written for the next maintainer:
  - **One statement per line.** No `a; b;`, chained assignments, single-line `if (...) return;` or `try { ... } catch { ... }`; every block has braces and its own lines. Dense chains (`.flat().filter().map()`) become loops or named intermediate values.
  - **Descriptive names.** No single letters except the loop index `i`; abbreviations only where universal (`id`, `url`, `rgb`, not `cv`, `sw`, `px`, `vw`). Callback parameters say what they hold (`(row) =>`).
  - **Top-to-bottom.** Imports; constants (defaults, selectors, viewports, fixtures, regular expressions); helpers; one entry function such as `async function runChecks()`, called once at the bottom with `await runChecks();`. `dist/cubicle.js` keeps the same order inside its IIFE: constants, state, helpers per behaviour, named event handlers, one wiring section.
  - **Named units.** Each check group, probe or behaviour is a named function; code run inside a page (`page.evaluate`) is a named, self-contained function under the same rules.
  - **Behaviour first.** A readability change must not alter checks, report lines, artifacts or exit codes; compare outputs before and after.

---

## 8. Design Tokens

Tokens live in `@layer tokens` at the top of `dist/cubicle.css`, the single source of their values; the catalogue documents each one. Every visual rule builds on these families (a leading `-` repeats the family prefix: `-surface` is `--cb-bg-surface`):

- **Surfaces:** `--cb-bg-canvas`, `-surface`, `-raised`, `-btn`, `-recessed`, `-header`, `-zebra`, `-hover`, `-selected`, `-backdrop`
- **Ink:** `--cb-text-main`, `-muted`, `-disabled`, `-inverse`
- **Borders:** `--cb-border-subtle`, `-main`, `-strong`
- **Status:** `--cb-accent`, `--cb-ok`, `--cb-warn`, `--cb-danger`, `--cb-info`
- **Depth:** `--cb-shadow-outset`, `-outset-dark`, `-inset`, `-pressed`, `-float`, `-highlight`; `--cb-grad-surface`, `-btn`, `-btn-dark`
- **Geometry:** `--cb-radius-none`, `-sm` (default), `-md` (maximum), `-round`; `--cb-space-1` … `-5`; `--cb-control-h`, `-sm`; `--cb-row-h`, `-sm`
- **Type:** `--cb-font-sans`, `--cb-font-mono`; `--cb-text-xs`, `-sm` (base), `-md`, `-lg`; `--cb-line-tight`, `--cb-line-base`
- **Motion and focus:** `--cb-duration`, `--cb-duration-spin`, `--cb-focus-ring`, `--cb-focus-offset`

A new token goes into `@layer tokens`, this list and the catalogue's token tables, and only when `color-mix()` cannot derive it. A palette token is declared in `:root` and in every theme block, and listed in the catalogue's theme table (`check-tokens.mjs` checks 7–9).

---

## 9. Repository Layout & Build

- `dist/cubicle.css` — the shipped stylesheet: hand-written, layered, one file that reads top to bottom from its Table of Contents. Distribution is the file itself.
- `dist/cubicle.js` — optional progressive enhancement, dependency-free.
- `dist/*.min.*` — build output, committed so a CDN can serve it, never edited by hand; rebuilt by `scripts/build-min.sh` and committed with every change to `dist/cubicle.css` or `dist/cubicle.js`. CI fails when they differ from a fresh build.
- `docs/index.html` — the component catalogue; `docs/example.html` — a sample IAM / infra console, both showcase and integration test; `docs/docs.css` — documentation-only styles, never shipped.
- `scripts/` — dev tools, never shipped: `verify-browser.mjs` (serves the repository over local HTTP; `--css`, `--js` and `--theme <name>` are applied by that server in every engine), `verify-matrix.mjs` (several pages and engines side by side), `build-min.sh`, `lint.sh` (stylelint and ESLint, error-catching rules only, configured in `stylelint.config.mjs` and `eslint.config.mjs`), `check-snippets.mjs`, `check-tokens.mjs`, `check-release.mjs` (tag, banners, CHANGELOG section and the catalogue header agree; for a stable tag also the README's CDN pin and SRI hashes; writes the release notes), `build-site.mjs` (the Pages tree in `tmp/site/`), `package-release.mjs` (assets, zip and `checksums.txt` in `tmp/release/`) with their shared `release-files.mjs`, `contrast-pairs.mjs` (palette contrast pairs shared by `verify-browser.mjs` and the catalogue's contrast table).
- `.github/` — `workflows/` (`verify.yml`, `ci.yml`, `release.yml`) and `dependabot.yml`; see Section 14.
- `.claude/` — Claude Code settings, hooks and skills. Store every plan in `.claude/plans/`.
- `README.md`, `LICENSE` (MIT), `CHANGELOG.md` (Keep a Changelog, SemVer), `CONTRIBUTING.md`.

### Minified Build
`bash scripts/build-min.sh` writes `dist/cubicle.min.css` and `dist/cubicle.min.js` with `lightningcss` and `terser`, pinned in `scripts/package.json`. It runs without browser downgrade targets: no vendor prefixes are injected, and `@layer`, nesting and `color-mix()` stay as written. A minified file is trusted only after `node scripts/verify-browser.mjs --css dist/cubicle.min.css --js dist/cubicle.min.js` passes in `chromium`, `firefox` and `webkit`; engine limits are labelled skips, never passes. No bundlers, preprocessors or file watchers.

### Catalogue (`docs/index.html`)
- **Sidebar:** Principles; Tokens (colour, themes, depth, radius, motion, spacing, typography); Layout & Grids; one section per component; Recipes (whole-task compositions: filter bar, inspector, sign-in, print); Utilities; Accessibility.
- **Each component section:** one sentence on its purpose; a live demo of every supported state (default, hover, focus, active, disabled, readonly, invalid, current / selected, busy); a `<pre><code>` snippet byte-identical to the demo; a reference table of modifiers and state attributes.
- **Themes:** Tokens › Themes holds a row of theme tiles (docs-only radios, each with a miniature window in its own `data-cb-theme`); the catalogue's inline scripts set the picked theme on `<html>`, name it in the top bar and remember it in `localStorage` (applied in `<head>` before the first paint). The tiles stay hidden without script.
- **Snippets:** `scripts/check-snippets.mjs` fails on any demo / snippet mismatch. Snippets stay plain `<pre><code>` in the source, with no copy buttons or extra markup. The catalogue's inline script alone adds Prism highlighting and line numbers (inlined unmodified with its MIT notice, styled in `docs/docs.css` with `--cb-*` tokens), a collapsed `<details class="cb-details">` frame, scrolling past 20 lines, and whole-block copy on click or Enter / Space (a mouse selection is left for Ctrl+C); blocks have no hover effect. Host-code examples that copy no demo are `<pre class="docs-snippet docs-snippet--host">` (`<code class="language-javascript">` for JavaScript), treated the same and skipped by the snippet check. None of this reaches `dist/`.
- **Tokens:** `scripts/check-tokens.mjs` fails when a token is missing from the catalogue, a documented value differs from the stylesheet, or a `var(--cb-*)` names an undeclared token.

---

## 10. Platform Features

Target Baseline "Widely Available" in evergreen browsers. Approved:
- `@layer`, native nesting (two levels), `color-mix(in srgb, …)`, `:is()` / `:where()` / `:has()` (judiciously, for parent state), `:dir()`, subgrid, logical properties, `tabular-nums`.
- Container queries and `cqb` units where a component sizes to its container (the `.cb-app` frame falls back to the small viewport height without a size container).
- `:user-invalid` alongside `aria-invalid="true"`, so native validation shows only after interaction.
- `<details name>` exclusive accordions (newly available; older engines open the blocks independently).
- Popover API for non-blocking dialogs and menus; `<dialog>` with `showModal()` (via `dist/cubicle.js`) for modal ones.
- `align-content` on block containers (`.cb-props` rows), widely available since 2026-10-16.

---

## 11. Workflow & Quality Assurance
- **Small, atomic steps:** one component or concern per commit, Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`).
- **The docs are the test:** a change is complete only when it meets the Definition of Done (Section 13).
- **Verification suite:** every change passes `node scripts/verify-browser.mjs` (`verify-matrix.mjs` for several pages and engines; `--themes` adds the non-default themes), with the screenshots in `tmp/shots/` inspected. Run `/cubicle-review` before committing.
- **Verify, do not assume:** measure contrast, focus visibility and text overflow in a real headless browser and record the findings. Dev-only scripts never become runtime requirements.
- **Git Authority:** Do not push to remote or create Git tags without the maintainer's explicit instruction.

---

## 12. Language Policy

Code, comments, documentation, examples, commit messages, `README.md` and `CHANGELOG.md` are English only. Talk to the maintainer in chat in the maintainer's preferred language.

---

## 13. Definition of Done

- [ ] Colours, radii, durations, bevels and shadows use `--cb-*` tokens; no `!important`; no `outline` outside the focus indicator (Section 2.2).
- [ ] Tactile model (Section 2.1): triggers are raised with press travel, inputs and wells are recessed; numbers are tabular.
- [ ] No remote resources, runtime dependencies or build requirements; JavaScript is progressive enhancement only.
- [ ] Every state is shown in `docs/index.html` with a matching snippet (`check-snippets.mjs` passes); `docs/example.html` shows realistic use where applicable.
- [ ] Checked at `360px`, `800px` and `1360px` (table overflow, sticky columns, form adaptation).
- [ ] Keyboard path (`Tab`, `Shift+Tab`, `Space`, `Enter`, `Escape`) works, focus ring visible, WCAG contrast measured.
- [ ] `node scripts/verify-browser.mjs` passes with clean screenshots.
- [ ] Naming, nesting and Human-First Code follow Section 7.
- [ ] `dist/cubicle.css` reads top to bottom; its Table of Contents is current.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.

---

## 14. Delivery & Distribution

Releases ship through the pipeline below. Tagging, pushing and publishing stay manual (Section 11).

- **Releases:** a SemVer tag `vX.Y.Z` or `vX.Y.Z-rc.N` on the public repository `ilyasirotin/cubicle-css`, and its GitHub Release with the assets `cubicle.css`, `cubicle.min.css`, their `.js` counterparts, `checksums.txt` (SHA-256 lines, SRI as comments) and `cubicle-<version>.zip`. The version sits in the `/*! */` banner of `dist/cubicle.css` and `dist/cubicle.js` (and in the minified files built from them) and in the catalogue's top bar, all committed before the tag. `scripts/check-release.mjs` fails on a mismatch with the tag or on a missing dated `CHANGELOG.md` section, whose body becomes the release notes.
- **CDN:** jsDelivr serving the tag's committed files (`cdn.jsdelivr.net/gh/ilyasirotin/cubicle-css@<version>/dist/...`), `dist/*.min.*` included: jsDelivr serves repository files, not release assets, and cannot minify this stylesheet itself (nesting, `@layer`), so the minified files stay committed and CI checks that they equal a fresh build. The README pins exact versions, never a branch, and quotes the SRI hashes of the minified files; `check-release.mjs` fails on a stale pin or hash for a stable tag.
- **Docs hosting:** GitHub Pages on `cubicle.threadnull.dev`, deployed from every `v*` tag, rc included, by Actions (so no `CNAME` file). `scripts/build-site.mjs` builds the tree: the catalogue at `/`, `/example.html` and `/dist/...`, with `../dist/` rewritten to `dist/` in the copies only.
- **Automation:** `.github/workflows/verify.yml` is the reusable gate (lint, snippets, tokens, the committed `dist/*.min.*` against a fresh build, `verify-matrix --min --themes --shots none` on `ubuntu-latest`); `ci.yml` runs it on pushes and pull requests to `master`, plus a packaging dry run; `release.yml` runs on a `v*` tag push: verify, package, deploy Pages, then a **draft** GitHub Release (a pre-release for `-rc` tags) that the maintainer publishes by hand. Top-level `permissions: {}`, least privilege per job, actions pinned by full commit SHA with a version comment, Dependabot weekly for actions and `scripts/`. No secrets: `GITHUB_TOKEN` and the Pages OIDC deploy only.
- **Repository settings (maintainer-owned):** Actions limited to GitHub-owned actions pinned by full SHA, with a read-only token; a ruleset on `refs/tags/v*` (no creation, update or deletion, owner bypass); a `master` ruleset that blocks deletion and force pushes and requires `Verify / Lint and browser checks` and `Package (dry run)`, with owner bypass; the `github-pages` environment limited to `v*` tags.
- **Release steps.** Claude prepares 1–3 and checks 6 read-only; the maintainer pushes, tags and publishes.
  1. Set the version in the two banners and the catalogue's top bar, run `bash scripts/build-min.sh`, and move the changes under `[Unreleased]` into a dated `## [X.Y.Z]` section of `CHANGELOG.md`, with the link references.
  2. For a stable release, pin the README's CDN links to the tag and paste the SRI hashes of the minified files (`openssl dgst -sha384 -binary dist/cubicle.min.css | openssl base64 -A`, prefixed `sha384-`), and refresh the sizes.
  3. `node scripts/check-release.mjs vX.Y.Z` and the full checks pass; commit `chore(release): X.Y.Z`.
  4. Push `master` and wait for green CI.
  5. Create the annotated tag on that commit and push it; `release.yml` runs.
  6. Verify the live result (the site over HTTPS, jsDelivr bytes and SRI against the release assets), then publish the draft.
- **Out of scope:** an npm package or a self-hosted nginx server.
