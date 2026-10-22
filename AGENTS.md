# AGENTS.md — Cubicle Design System & UI/UX Guidelines

## 1. Project Overview & Core Philosophy
**Cubicle** is a minimalist, high-density, functional CSS framework designed specifically for critical enterprise tools: Identity & Access Management (IAM) portals, VPN admin panels, infrastructure management consoles, and back-office dashboards.

### Design Manifesto: Neo-Enterprise Utilitarianism
* **Inspiration, Not Imitation:** Cubicle draws from the functional design code of classic late-90s and early-2000s enterprise software (clear affordances, tactile depth, high information density, unambiguous states). However, **it is NOT a retro/nostalgia parody theme** (like 98.css). Do not use pixel fonts, outdated system icons, or gimmicky retro artifacts.
* **Clarity Over Decoration:** Zero visual fluff. Every border, shadow, and background shift must serve a structural or functional purpose (grouping data, indicating interactivity, or showing system state).
* **Tactile & Realistic:** Controls must look like what they do. Buttons look pressable (raised/beveled with distinct top/left and bottom/right edge luminance), text inputs look recessed (inset/carved into the surface), and containers have distinct physical boundaries.

---

## 2. Visual Language & Aesthetics

### 2.1. Tactility, Depth, and Borders
Modern flat design often blurs the line between static text and interactive controls. Cubicle solves this through subtle, realistic physical depth:
* **Buttons & Triggers:** Must have a subtle raised appearance using a dedicated surface token (`--cb-bg-btn`), dual-tone borders (lighter top/left edge `--cb-border-main`, darker bottom/right edge `--cb-border-strong`), and crisp multi-layered box-shadows (`--cb-shadow-outset`) coupled with a micro-gradient (`--cb-grad-btn`).
* **Active/Pressed States:** Physically shift (`translate: 0 1px`) and invert the lighting model (`--cb-shadow-pressed`, no gradient) so the user feels the mechanical click.
* **Inputs & Wells:** Text fields, selects, code blocks, and log viewers must appear slightly recessed into the page (`--cb-shadow-inset` and darker top border `--cb-border-strong`) with a crisp `1px` border.
* **Corners:** Strictly utilitarian. Use sharp corners (`0px`) or micro-radii (`2px` to `3px` max) to maintain a serious, engineered feel. Never use pill-shaped buttons or large rounded cards (`8px+`). The only exceptions are round status indicators (LED dots, the busy spinner) and radio buttons, which use `--cb-radius-round`; no other control or container may be round.

### 2.2. Color Palette & Contrast
* **Cool Industrial Steel Foundation:** The UI relies on structured layers of cool slate and steel grays (`#e4e7ec` canvas, `#f4f6f8` surfaces, `#eaedf2` buttons, `#d5dae2` headers) to separate panels, toolbars, and workspaces without relying on heavy drop shadows.
* **High Contrast:** Text and borders must meet strict readability standards (WCAG AA/AAA). Borders between table cells, form groups, and panels must always be visible (`1px solid`), never implied solely by whitespace.
* **Desaturated Semantic Status & Actions:** Color is reserved for communication and primary affordances, using muted, high-trust enterprise tones rather than neon web colors:
  * **Primary Accent (`--cb-accent`):** Muted Steel Navy (`#1e4b85`).
  * **Success / Online (`--cb-ok`):** Deep forest green (`#166534`).
  * **Warning / Degraded (`--cb-warn`):** Industrial ochre/amber (`#9a4a06`).
  * **Danger / Revoked (`--cb-danger`):** Deep crimson (`#991b1b`). Inline destructive actions in dense tables use tinted steel (`.cb-btn--danger`), while critical modal confirmations use solid crimson fill (`.cb-btn--danger-solid`).
  * **Info / Neutral (`--cb-info`):** Technical slate-blue (`#075985`).
* **Focus Indicators:** Keyboard navigation is paramount for sysadmins. Focus states must feature a high-contrast, unmistakable outline (`2px solid var(--cb-accent)` with `1px` offset); where an outer ring would be clipped (scroll containers) it is drawn inside instead, except on a sticky table's wrapper, whose pinned cells would cover an inner ring.

### 2.3. Typography
* **UI Text:** Clean, highly legible modern system sans-serif stack (`Inter`, `system-ui`, `-apple-system`, `Segoe UI`, `Roboto`, sans-serif).
* **Technical Data (Crucial):** First-class support for monospace typography. IP addresses, CIDR blocks, UUIDs, SHA hashes, SSH keys, port numbers, timestamps, and log outputs must default to or easily utilize a crisp monospace stack (`JetBrains Mono`, `Fira Code`, `SFMono-Regular`, `Consolas`, monospace).
* **Tabular Numerals:** All numeric data in tables, metrics, and counters must enforce `font-variant-numeric: tabular-nums` so columns align vertically to the pixel.
* **Scale:** Compact and grounded. Base font size optimizes for screen real estate (`13px` / `0.8125rem` default) with tight, scannable line heights.

---

## 3. Layout, Density & Responsiveness

### 3.1. High Information Density
Sysadmins and security engineers hate excessive scrolling and empty whitespace.
* **Compact Spacing:** Padding and margins should be tight and purposeful. A standard 1080p screen should comfortably display 20–30 rows of a data table or a complex multi-section configuration form without scrolling.
* **Density Modes:** `data-cb-density="compact"` or `"comfortable"` on `<html>` or any subtree redefines the control and row heights (`--cb-control-h`, `--cb-row-h` and their `-sm` steps) and the small spacing steps; type sizes never change. The default needs no attribute.
* **Explicit Grouping:** Use classic structural primitives like `<fieldset>` with `<legend>`, bordered panels, and distinct header bars to group related settings (e.g., "TLS Configuration", "RBAC Rules", "Tunnel Routing").

### 3.2. Adaptive & Responsive Engineering
While classic enterprise apps had fixed widths, Cubicle is strictly responsive:
* **Desktop-First Ergonomics, Mobile-Ready:** Optimized for multi-monitor desktop setups, but gracefully adapts to tablets and mobile phones (`360px`, `800px`, `1360px` verification targets).
* **Responsive Data Tables:** Wide tables with 10+ columns must support clean horizontal scrolling (`.cb-table-wrap`) without breaking the page layout.
* **Collapsible Chrome:** Sidebars, tree views, and multi-column grids collapse cleanly on narrow viewports.

---

## 4. Core Component Specifications (IAM / Infra Focus)

When designing or modifying components, adhere to these domain-specific UX patterns:

1. **Data Grids & Tables (`.cb-table`):**
   * Visible cell borders (`1px`), alternating row backgrounds (`--cb-bg-zebra`) for horizontal scanning, and instant hover/selected highlighting.
   * Compact inline action buttons (`.cb-btn--sm`) that fit within the row height without bloating it.
2. **Forms & Configuration Panels (`.cb-field`, `.cb-input`, `.cb-select`):**
   * Support both stacked and horizontal (label left, input right) layouts for dense settings pages.
   * Clear visual distinction between `readonly` (recessed monospace), `disabled`, `aria-invalid="true"`, and editable states.
3. **Status Badges & LEDs (`.cb-badge`):**
   * Compact, bordered tags with semantic LED status dots (`::before`) and subtle inset top highlight.
4. **Copy-to-Clipboard & Secret Fields (`.cb-secret`):**
   * Built-in visual patterns for pre-formatted strings (API tokens, WireGuard keys, certificates) with recessed monospace boxes and attached tactile action buttons.
5. **Navigation & Tree Views (`.cb-nav`):**
   * Essential for LDAP/Active Directory hierarchies, organizational units, and console navigation.
6. **Modals, Confirmations & Alerts (`.cb-alert`, `<dialog>`):**
   * Unambiguous alert banners with thick left semantic accent borders (`4px solid`) and stark dialog boxes.
7. **Key-Value Lists (`.cb-props`):**
   * A `<dl>` for inspector facts (certificate metadata, sessions, hardware), framed like a table, with the key column on the left; it stacks key over value when its own width is narrow.

**Out of scope, by decision:** diff views and code viewers (added / removed lines, syntax highlighting, editor behaviour). `.cb-log` and `.cb-code` show plain text; a host that needs a read-only code or diff view embeds a third-party editor.

---

## 5. UI/UX Anti-Patterns (Strictly Forbidden)
* **NO Glassmorphism / Neomorphism:** No blurry translucent backgrounds (`backdrop-filter: blur`), glowing neon borders, or soft, low-contrast extruded plastic shadows.
* **NO Bouncy or Slow Animations:** Transitions must be instantaneous (`50ms` max). Enterprise tools must feel snappy and immediate. Continuous busy indicators are the only looping motion: they rotate in discrete steps over `--cb-duration-spin` and stop under `prefers-reduced-motion: reduce`.
* **NO Ambiguous "Ghost" Inputs:** Never use borderless inputs that only show an underline on hover/focus.
* **NO Marketing/Consumer Bloat:** Do not build hero banners, pricing cards, testimonial carousels, or oversized promotional typography.

---

## 6. Technical Constraints & Code Minimalism

- **Zero Build / Zero Dependencies:** No build tooling is required to use or edit the kit, and no runtime dependencies exist. The CSS footprint must remain strictly minimal — every rule must earn its bytes through functional utility.
- **Strict Token Discipline:** No hardcoded colour, border-radius, transition duration, or box-shadow outside of `:root` tokens. Derived states (e.g., semantic badge backgrounds or hover tints) must use native `color-mix(in srgb, ...)` referencing base tokens rather than ballooning the token list. CSS system colour keywords (`Canvas`, `CanvasText`, `Highlight`, `HighlightText`, `GrayText`, …) are the user's theme in forced colours: they are allowed only inside `@media (forced-colors: active)`, and `scripts/check-tokens.mjs` enforces it.
- **Selector Hygiene:** No ID selectors, no `!important`, and no inline styles in documentation examples.
- **Self-Contained Assets:** No third-party icons, external images, CDNs, or remote `@import` rules. Indicators (arrows, status dots, tree lines, checkmarks) use pure CSS geometry, inline SVG data-URIs where strictly necessary, or standard Unicode primitives.
- **Standards-First CSS:** No vendor-prefixed properties. Engine-specific pseudo-elements are allowed only where no W3C standard way exists (currently `<meter>` and `<progress>` bars and values, including Firefox's meter state pseudo-classes, the `<details>` marker, `<input type="range">` track/thumb, and the number spin buttons and search clear key, which are hidden) and must carry an explanatory comment.
- **Semantic Transparency:** No component may be constructed that cannot be understood from its HTML markup alone.
- **HTMX & Framework Interoperability:** Components must rely on semantic HTML attributes (`disabled`, `readonly`, `open`, `aria-current`, `aria-selected`, `aria-invalid`, `aria-busy`, `aria-pressed`) so server-driven updates (HTMX swaps) and frontend frameworks work out of the box without requiring JS class-toggling wrappers. Optional behaviour in `dist/cubicle.js` hooks onto `data-cb-*` attributes through delegated listeners on the document (click, keydown, input, paste, reset, and capture listeners for popover `beforetoggle` / `toggle`, which do not bubble; scroll and resize close open menus), so swapped markup needs no re-initialisation; until the script runs, script-only controls stay hidden.

---

## 7. Naming, Specificity & Modularity

- **Namespace Prefix (`cb-`):** Prefix everything to prevent collisions in host applications:
  - Classes: `cb-` (e.g., `cb-btn`, `cb-table`, `cb-fieldset`)
  - Custom properties: `--cb-` (e.g., `--cb-bg-surface`, `--cb-shadow-outset`)
  - Data attributes: `data-cb-` (e.g., `data-cb-density="compact"`)
- **BEM-Lite Structure:** Block, element, modifier: `cb-btn`, `cb-btn--primary`, `cb-panel__head`. Keep class names concise and predictable.
- **Attribute-First States:** State hooks use standard HTML/ARIA attributes first (`[disabled]`, `[readonly]`, `[aria-busy="true"]`, `[aria-invalid="true"]`, `[aria-selected="true"]`, `[aria-pressed="true"]`). State classes are used only where no standard attribute exists.
- **Cascade Layers (`@layer`):** `dist/cubicle.css` is modularized internally via top-level cascade layers:
  `@layer reset, tokens, base, layout, components, utilities;`
  This guarantees predictable specificity and allows host apps to override styles effortlessly without `!important`.
- **CSS Nesting:** Native CSS nesting is allowed at most **two levels deep**, strictly for pseudo-states, attribute states, and direct children of a single component.
- **Component-Private Custom Properties:** Internal component variables start with `--_` (e.g., `--_bg`, `--_ink`, `--_border-top`, `--_border-bot`) and are scoped to the component root (see `cb-btn`). Never reference a custom property from itself (avoid circular variable fallback bugs).
- **Human-First Code (`dist/cubicle.js`, `scripts/`, `.claude/**/scripts/`, shell):** Code is written for the next human maintainer, not for brevity:
  - **One statement per line.** No `a; b;` on one line, no chained assignments (`x = y = 1`), no single-line `if (...) return;` or `try { ... } catch { ... }`: every block gets braces and its own lines. Dense chains (`.flat().filter().map()`) become loops or named intermediate values.
  - **Descriptive names.** No single-letter names except the loop index `i` (not `e`, `m`, `r`, `k`, `n`, `cv`, `g`, `sw`, `px`, `vw`); abbreviations only where universal (`id`, `url`, `rgb`). Callback parameters say what they hold (`(row) =>`, not `(r) =>`).
  - **Top-to-bottom structure.** Imports; configuration and constants (option defaults, selectors, viewports, fixture data, regular expressions) at the top; helper functions; then the main block, a single `async function runChecks() { ... }` (or a name that says what it runs) called once at the bottom with `await runChecks();`. `dist/cubicle.js` keeps the same order inside its IIFE: constants, state, helpers per behaviour, named event handlers, then one wiring section that registers everything.
  - **Named units.** Each check group, probe or behaviour is its own named function; code that runs inside a page (`page.evaluate`) is a named, self-contained function written to the same rules.
  - **Behaviour first.** A readability change must not alter checks, report lines, artifacts or exit codes; prove it by comparing outputs before and after.

---

## 8. Base Design Tokens Reference

All visual rules in `dist/cubicle.css` must build upon this core token table inside `@layer tokens`:

```css
@layer tokens {
  :root {
    /* 1. Surfaces & Backgrounds (Cool Industrial Steel / Slate Gray) */
    --cb-bg-canvas: #e4e7ec;       /* Main workspace background (cool steel) */
    --cb-bg-surface: #f4f6f8;      /* Panels, cards, table bodies */
    --cb-bg-raised: #ffffff;       /* Inputs, active tabs, modals */
    --cb-bg-btn: #eaedf2;          /* Dedicated tactile button surface */
    --cb-bg-recessed: #dce1e8;     /* Wells, code blocks, readonly/disabled fields */
    --cb-bg-header: #d5dae2;       /* Panel headers, table heads, topbars */
    --cb-bg-zebra: #edf0f4;        /* Alternating table row tint */
    --cb-bg-hover: #e2e8f0;        /* Crisp row/item hover highlight */
    --cb-bg-selected: #cfe0f5;     /* Selected table row / active tree node */
    --cb-bg-backdrop: rgba(15, 23, 42, 0.45); /* Dimmed page under modal dialogs */

    /* 2. Typography & Ink (Cool Deep Slate) */
    --cb-text-main: #11161d;       /* Primary high-contrast ink */
    --cb-text-muted: #4b5563;      /* Secondary labels, metadata, hints */
    --cb-text-disabled: #8892a0;   /* Disabled control text */
    --cb-text-inverse: #f8fafc;    /* Text on dark/semantic buttons */

    /* 3. Structural Borders (Crisp Metallic Edges) */
    --cb-border-subtle: #cbd2dc;   /* Table cell dividers, internal lines */
    --cb-border-main: #9aa3b2;     /* Standard panel, input, and button borders */
    --cb-border-strong: #646f80;   /* Active control frames, bottom bevel edge */

    /* 4. Semantic Status & Actions (Desaturated Enterprise Tones) */
    --cb-accent: #1e4b85;          /* Muted Steel Navy for primary actions & focus */
    --cb-ok: #166534;              /* Deep forest green (Online, Active, Valid) */
    --cb-warn: #9a4a06;            /* Industrial ochre/amber (Pending, Degraded) */
    --cb-danger: #991b1b;          /* Deep crimson (Revoked, Offline, Destructive) */
    --cb-info: #075985;            /* Technical slate-blue (System notice) */

    /* 5. Tactile Depth & Lighting (Crisp micro-bevel, subtle 3D volume) */
    --cb-shadow-outset:
      inset 0 1px 0 0 rgba(255, 255, 255, 0.9),
      inset 1px 0 0 0 rgba(255, 255, 255, 0.45),
      inset 0 -1px 0 0 rgba(15, 23, 42, 0.16),
      0 1px 1px 0 rgba(15, 23, 42, 0.08);
    --cb-shadow-outset-dark:
      inset 0 1px 0 0 rgba(255, 255, 255, 0.28),
      inset 0 -1px 0 0 rgba(0, 0, 0, 0.35),
      0 1px 1px 0 rgba(15, 23, 42, 0.12);
    --cb-shadow-inset:
      inset 0 1px 2px 0 rgba(15, 23, 42, 0.14),
      0 1px 0 0 rgba(255, 255, 255, 0.8);
    --cb-shadow-pressed:
      inset 0 1px 3px 0 rgba(15, 23, 42, 0.26),
      inset 0 0 0 1px rgba(15, 23, 42, 0.08);
    --cb-shadow-float:
      0 4px 12px -2px rgba(15, 23, 42, 0.18),
      0 0 0 1px var(--cb-border-strong);
    --cb-shadow-highlight: inset 0 1px 0 0 rgba(255, 255, 255, 0.6); /* Top-edge light on static chips: badges, LED lamps */

    --cb-grad-surface: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, rgba(15, 23, 42, 0.03) 100%);
    --cb-grad-btn: linear-gradient(180deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0) 55%, rgba(15, 23, 42, 0.05) 100%);
    --cb-grad-btn-dark: linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, rgba(0, 0, 0, 0.12) 100%);

    /* 6. Geometry, Spacing & Density */
    --cb-radius-none: 0px;
    --cb-radius-sm: 2px;           /* Default for buttons, inputs, badges */
    --cb-radius-md: 3px;           /* Maximum allowed radius (panels, modals) */
    --cb-radius-round: 50%;        /* LED dots, spinner, radio buttons only */

    --cb-space-1: 0.25rem;         /* 4px  - tight inline gap */
    --cb-space-2: 0.5rem;          /* 8px  - standard cell/input padding */
    --cb-space-3: 0.75rem;         /* 12px - panel padding */
    --cb-space-4: 1rem;            /* 16px - section separation */
    --cb-space-5: 1.5rem;          /* 24px - major layout gap */

    --cb-control-h: 1.625rem;      /* 26px - buttons, fields, tabs */
    --cb-control-h-sm: 1.25rem;    /* 20px - small keys, table actions */
    --cb-row-h: 1.75rem;           /* 28px - table rows, details summaries */
    --cb-row-h-sm: 1.5rem;         /* 24px - navigation rows, compact tables */

    /* 7. Typography Scale & Stacks */
    --cb-font-sans: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --cb-font-mono: "JetBrains Mono", "Fira Code", "SFMono-Regular", Consolas, monospace;

    --cb-text-xs: 0.75rem;         /* 12px - badges, table headers, micro-labels */
    --cb-text-sm: 0.8125rem;       /* 13px - base dense UI text */
    --cb-text-md: 0.875rem;        /* 14px - comfortable reading / primary inputs */
    --cb-text-lg: 1rem;            /* 16px - panel titles, modal headers */
    --cb-line-tight: 1.25;
    --cb-line-base: 1.4;

    /* 8. Motion & Focus */
    --cb-duration: 50ms;           /* Instantaneous mechanical feedback */
    --cb-duration-spin: 800ms;     /* One stepped revolution of the busy spinner */
    --cb-focus-ring: 2px solid var(--cb-accent);
    --cb-focus-offset: 1px;
  }
}
```

---

## 9. Repository Layout & Build Pipeline

- `dist/cubicle.css` — the shipped stylesheet, hand-written, layered, single file.
- `dist/cubicle.js` — optional progressive-enhancement behaviour (minimal, dependency-free).
- `dist/*.min.*` — local minified build output (git-ignored, never edited by hand).
- `docs/index.html` — the component catalogue and style guide; static HTML.
- `docs/example.html` — sample IAM/infra console screen; serves as in-context showcase and integration test.
- `docs/docs.css` — documentation-only layout styles; never shipped.
- `scripts/` — dev tools: `verify-browser.mjs`, `verify-matrix.mjs` (runs it for several pages and engines side by side), `build-min.sh`, `check-snippets.mjs`, `check-tokens.mjs`, and `contrast-pairs.mjs` (the palette contrast pairs shared by `verify-browser.mjs` and the catalogue's contrast table); never shipped.
- `.claude/` — Claude Code setup: settings, hooks, skills.
- `.claude/plans/` — Claude's implementation plans. Store every plan in this directory.
- `README.md`, `LICENSE` (MIT), `CHANGELOG.md` (Keep a Changelog, SemVer), `CONTRIBUTING.md`, `AGENTS.md`.
- `.github/workflows/` — not used yet; release and Pages automation is deferred (Section 14).

`dist/cubicle.css` is edited directly by hand and reads top-to-bottom as a clean technical document, starting with a Table of Contents comment block. Distribution is the file itself: copy and link it.

### Local Build
Using Cubicle never requires a build step. For development and release verification, there is a single command:
`bash scripts/build-min.sh`
This outputs `dist/cubicle.min.css` (and `dist/cubicle.min.js` once `dist/cubicle.js` exists) using `lightningcss` (CSS) and `terser` (JS), pinned dev dependencies in `scripts/package.json`.
- Run it **without browser downgrade targets**: no vendor prefixes may be injected, and modern syntax (`@layer`, native nesting, `color-mix()`) must remain intact as written.
- Minified outputs are git-ignored and never committed to the repository.
- A minified file is trusted only after `node scripts/verify-browser.mjs --css dist/cubicle.min.css --js dist/cubicle.min.js` passes against it in every engine (`--browser chromium`, `firefox` and `webkit`); known engine limits are reported as labelled skips, never as passes.
- Do not introduce bundlers, Sass/PostCSS preprocessors, or file-watcher daemons.

### Documentation & Catalogue (`docs/`)
`docs/index.html` is an interactive engineering reference catalogue (similar in utility to Bootstrap's docs, rendered entirely in Cubicle's own utilitarian aesthetic):
- **Left Navigation:** Sticky anchor sidebar organized into: *Principles*, *Tokens* (colour, depth/shadow, radius, motion, spacing, typography), *Layout & Grids*, followed by one section per *Component* (buttons, inputs/fields, secret/copy boxes, fieldsets/panels, tabs, data tables, property lists, empty states, status badges, chips and LEDs, alerts, toasts, tree views, meters, segmented controls, details, modals/dialogs, pagination, menus, logs), *Recipes* (compositions of components for whole tasks: filter bar, inspector, sign-in, print), *Utilities*, and *Accessibility*.
- **Component Anatomy:** Each section contains:
  1. One concise sentence stating what the component is for.
  2. A live rendered example demonstrating **every supported state** (default, hover, focus, active/pressed, disabled, readonly, invalid, current/selected, busy).
  3. An escaped copy-paste HTML snippet inside `<pre><code>` that is byte-for-byte identical to the live markup above it.
  4. A compact reference table of accepted modifiers and state attributes.
- **Snippet Integrity:** `scripts/check-snippets.mjs` parses `docs/index.html`, compares every live demo against its `<pre><code>` block, and fails on any mismatch. Documentation snippets stay plain `<pre><code>` blocks in the source, with no copy buttons and no extra markup in the source. The catalogue alone adds, from an inline script in `docs/index.html`: syntax highlighting and line numbers (Prism with its line-numbers plugin, inlined unmodified with the MIT notice, styled in `docs/docs.css` with `--cb-*` tokens), a collapsed-by-default `<details class="cb-details">` frame around each block, a scroll past 20 lines, and copy-the-whole-block on click or Enter/Space (a mouse selection inside the block is left for Ctrl+C). Blocks have no hover effect. None of this reaches `dist/`.
- **Token Integrity:** `scripts/check-tokens.mjs` fails when a token in `@layer tokens` is missing from the catalogue, a documented token or value differs from the stylesheet, or a `var(--cb-*)` reference names an undeclared token.

---

## 10. Platform Features Policy

Target **Baseline "Widely Available"** in modern evergreen browsers. Approved and actively used platform features:
- `@layer` (Cascade Layers for modularity and specificity control)
- Native CSS Nesting (`&`, max 2 levels)
- `color-mix(in srgb, ...)` for deriving tactile bevel edges, hover states, and semantic tints from core tokens
- `:is()`, `:where()`, and `:has()` (used judiciously for parent state styling, e.g., input groups or checked row highlighting in tables)
- `font-variant-numeric: tabular-nums` for all numeric readouts, tables, IP addresses, and metrics
- Logical properties (`inline-size`, `padding-inline`, `margin-block`) where beneficial for clean layout math
- Container queries and container query length units (`cqb`) where a component must size itself to its container rather than the viewport (e.g., the `.cb-app` fixed frame, which falls back to the small viewport height when no size container exists)
- `:user-invalid` alongside `aria-invalid="true"`, so native constraint validation (`required`, `pattern`, `type="email"`) is shown only after the user has interacted with a field
- `<details name>` for exclusive accordions, as progressive enhancement (Baseline newly available; older engines open the blocks independently)
- Popover API (`popover`, `popovertarget`) for non-blocking dialogs, and `<dialog>` with `showModal()` (via `dist/cubicle.js`) for modal ones
- `align-content` on block containers, to centre the content of rows that are not table cells (`.cb-props`). Newly available 2024-04-16, so widely available from 2026-10-16 by the 30-month rule; older engines top-align the content

---

## 11. Workflow & Quality Assurance

- **Small, Atomic Steps:** One component or architectural concern per commit. Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`).
- **The Docs Are the Test:** A feature or change is complete only when:
  1. `docs/index.html` renders the component across every state with an identical `<pre><code>` snippet.
  2. Layout and responsiveness are verified at **360px**, **800px**, and **1360px** viewport widths (checking table overflow, sticky columns, and form adaptation).
  3. `docs/example.html` reflects realistic IAM/infrastructure usage where applicable.
  4. Full keyboard navigation (`Tab`, `Shift+Tab`, `Space`, `Enter`, `Escape`) has been verified.
- **Run the Verification Suite:** After every change, run `node scripts/verify-browser.mjs` and inspect the captured screenshots in `tmp/shots/`. Before committing, run `/cubicle-review` (if configured in `.claude/`).
- **Verify, Do Not Assume:** Measure WCAG contrast ratios, focus visibility, and text overflow in a real headless browser and record the findings. Dev-only scripts are welcome locally but never become runtime requirements.
- **Git Authority:** Do not push to remote or create Git tags without the maintainer's explicit instruction.

---

## 12. Language Policy

All source code, CSS comments, documentation, HTML examples, commit messages, `README.md`, and `CHANGELOG.md` are **strictly English only**.
Communicate with the maintainer in chat using the maintainer's preferred language.

---

## 13. Definition of Done (Checklist for Every Change)

- [ ] All colours, radii, durations, bevels, and shadows reference `--cb-*` tokens; zero `!important`; zero `outline` rules outside the standard focus indicator (drawn outside by default, inside scroll containers other than a sticky table's wrapper and the keys of a scrolling tab list, on the row label of a tree item, and on the well of a token field while its entry has focus).
- [ ] Tactile physical model respected: interactive triggers use `--cb-bg-btn` with asymmetric bevel borders and physical press travel (`translate: 0 1px`), inputs/wells look recessed, tabular numbers align vertically.
- [ ] Zero remote resources, runtime dependencies, or build requirements introduced; any optional JS in `dist/cubicle.js` is strictly progressive enhancement.
- [ ] Component demonstrated in all states in `docs/index.html` with a matching `<pre><code>` snippet (`scripts/check-snippets.mjs` passes), verified at `360px`, `800px`, and `1360px`.
- [ ] Keyboard navigation path checked, high-contrast focus ring visible, WCAG contrast verified.
- [ ] `node scripts/verify-browser.mjs` passes with clean screenshots.
- [ ] Naming adheres to Section 7 (`cb-` prefix, `--_` private vars, max 2-level nesting).
- [ ] JavaScript and scripts follow Human-First Code (Section 7): one statement per line, no single-letter names but `i`, constants at the top, one entry point at the bottom.
- [ ] `dist/cubicle.css` reads cleanly top-to-bottom as a single document; Table of Contents updated.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.

---

## 14. Delivery & Distribution (Decided, Deferred)

These architectural decisions are locked so they are not re-debated. **Do not implement any of them** (no `.github/workflows`, no release or GitHub Pages configurations, no Git tags, no `CNAME` file) until the maintainer explicitly declares the framework ready for release. Until then, only the local build in Section 9 exists.

- **Repository:** Public on GitHub.
- **Source of Truth:** A SemVer Git tag and its corresponding GitHub Release. Release assets: `cubicle.css`, `cubicle.min.css` (plus `.js` counterparts if present), a `checksums.txt` file containing SHA-256 and Subresource Integrity (SRI) hashes, and a distribution `.zip`.
- **CDN:** jsDelivr serving the GitHub tag directly (`cdn.jsdelivr.net/gh/<owner>/cubicle@<version>/dist/...`). Documentation must always pin exact versions, never a branch name. CDN behaviour must be verified live before documenting it in `README.md`.
- **Demo & Docs Hosting:** GitHub Pages deployed from the release tag on the maintainer's custom domain, planned at `cubicle.threadnull.dev` (subdomain to be confirmed). The deployed artifact combines `docs/` and `dist/` into a single static tree so the documentation site loads the exact stylesheet being released.
- **Automation (Future):** A single GitHub Actions workflow triggered by a manual `v*` tag push: runs `verify-browser.mjs`, builds minified assets, generates SHA-256/SRI hashes, creates the GitHub Release, and deploys GitHub Pages. Job permissions must be strictly least-privilege and action versions pinned by commit SHA. Tagging remains a manual maintainer action.
- **Out of Scope:** Publishing an npm package or maintaining a self-hosted nginx distribution server.
