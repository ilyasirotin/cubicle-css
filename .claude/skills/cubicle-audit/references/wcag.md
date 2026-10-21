# WCAG 2.2 AA for a CSS kit: what applies and how to check it here

Cubicle is a stylesheet, a small script and a catalogue of copy-paste markup. A host application
owns its pages, so judge each criterion on what the kit controls: the look it paints, the
behaviour `cubicle.js` adds, and the markup its snippets teach. A snippet that teaches broken
semantics is a kit defect, because hosts copy it.

Classify every row as **Pass**, **Fail** (kit defect), **Host** (the host's job; say what the
catalogue should tell them, if anything) or **n/a**. Cite the evidence: a suite check name, a
probe line, or `file:line`.

`probe` below means `node .claude/skills/cubicle-audit/scripts/wcag-probe.mjs`. Suite means the
`verify-matrix.mjs` run of step 2.

## Perceivable

| SC | What to check in Cubicle | Evidence |
|---|---|---|
| 1.3.1 Info and Relationships | Snippets: every field has a `<label for>` or wraps its control; hints and errors are tied with `aria-describedby`; radio and checkbox groups sit in `<fieldset>` + `<legend>`; tables use `<th scope>` and a caption or `aria-label`; `.cb-props` is a `<dl>`; nav, logs and toasts are lists or landmarks. | Read the snippets; `probe --aria "#<section>"` for the computed tree |
| 1.3.2 Meaningful Sequence | No CSS reordering that departs from DOM order (`order:`, `*-reverse`, grid placement against source order, `.cb-split` panes). | `grep -nE 'order:|reverse' dist/cubicle.css` |
| 1.3.5 Identify Input Purpose | Sign-in and profile recipes carry `autocomplete` tokens (`username`, `current-password`, `one-time-code`). | Read the recipes |
| 1.4.1 Use of Color | Status never by colour alone: badges and LEDs have text, log levels have a level word, invalid fields have a message, selected rows have a checked box or `aria-selected` plus tint, links in running text are underlined. | Shots, snippets |
| 1.4.3 Contrast (Minimum) | Text pairs ≥ 4.5 in every state. Disabled text is exempt, but say so. | Suite checks 6, 7, 10, 11, 12 and `scripts/contrast-pairs.mjs` |
| 1.4.4 Resize Text | Sizes in `rem`, control heights in tokens: text at 200% must not clip in fixed-height controls. | `probe --only resize` |
| 1.4.10 Reflow | 320 CSS px wide: no page-level sideways scroll. Data tables, logs and code may scroll inside their own box (two-dimensional content is exempt). Note the kit's own targets are 360 / 800 / 1360; 320 is the WCAG bar. | `probe --only reflow` |
| 1.4.11 Non-text Contrast | ≥ 3:1 for what identifies a control or its state: field borders against their background, checkbox and radio frames, the focus ring, LED lamps, the selected tint where it is the only cue, meter fills against their track. Field and checkbox edges are a measured pair (a mix of `--cb-border-strong` and `--cb-border-main`); confirm every control frame actually paints that edge and not plain `--cb-border-main`, which is lighter. | Suite check 6 (non-text pairs in `scripts/contrast-pairs.mjs`), computed border colours of each control |
| 1.4.12 Text Spacing | With the WCAG override, no text clipped by its own box. | `probe --only spacing` |
| 1.4.13 Content on Hover or Focus | Menus and popovers dismiss with Escape, stay while hovered, close only on user action. Tooltips via `title` are UA-owned. | Suite menu and dialog checks |

## Operable

| SC | What to check in Cubicle | Evidence |
|---|---|---|
| 2.1.1 Keyboard | Every demo control reachable and operable; tabs, trees, menus, segmented keys follow the APG keys. | Suite `keyboard`, `tabs`, `nav`, `menu`, `segmented` groups |
| 2.1.2 No Keyboard Trap | Dialogs and menus release focus on Escape and return it to the opener. | Suite dialog and menu checks |
| 2.2.2 Pause, Stop, Hide | The spinner is the only looping motion and stops under `prefers-reduced-motion`; toasts have no timers. | Suite reduced-motion checks; `grep -n setTimeout dist/cubicle.js` |
| 2.4.1 Bypass Blocks | `.cb-skip-link` in the shell and the example. | `docs/example.html` |
| 2.4.3 Focus Order | DOM order; focus returns to the opener after a dialog or menu; a dismissed alert moves focus on. | Suite checks 5, 9 |
| 2.4.7 Focus Visible | A 2px ring on every focusable demo; drawn inside in scroll containers. | Suite checks 3, 7 |
| 2.4.11 Focus Not Obscured (Minimum) | Sticky table heads and columns, fixed toasts and the app frame never cover the focused element entirely. | `probe --only obscured` on both pages |
| 2.5.3 Label in Name | An `aria-label` on a key with visible text contains that text. | Snippets |
| 2.5.7 Dragging Movements | Range has arrow keys; textarea resize is a UA affordance. Usually n/a. | — |
| 2.5.8 Target Size (Minimum) | Targets ≥ 24×24 or spaced so 24px circles do not meet. The kit is dense on purpose: report per density and per component, and separate what the default density fails from what only `compact` fails. Table action keys (`--cb-control-h-sm`, 20px) inside a 28px row and stacked checkbox lists are the usual suspects; links in running text are exempt. Recommend either a fix (taller hit area via padding or `::after`, larger list gap) or a documented trade-off, never silence. | `probe --only target` on both pages |

## Understandable

| SC | What to check in Cubicle | Evidence |
|---|---|---|
| 3.2.1 / 3.2.2 On Focus / On Input | `cubicle.js` never submits, navigates or moves focus on focus or change alone. | Read `dist/cubicle.js` listeners |
| 3.3.1 Error Identification | Invalid fields and fieldset-level errors have text, linked to the control. | Snippets of the invalid demos |
| 3.3.2 Labels or Instructions | Every demo field is labelled; the required `*` is decorative (`content: "*" / ""`) and `required` carries the meaning. | Snippets, CSS |
| 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication | Sign-in / MFA recipe: no paste blocking, password-manager friendly `autocomplete`, one-time code field accepts paste. | Recipe markup |

## Robust

| SC | What to check in Cubicle | Evidence |
|---|---|---|
| 4.1.2 Name, Role, Value | Each ARIA pattern matches the APG: tabs (`tablist` / `tab` / `tabpanel`, `aria-selected`, `aria-controls`, roving `tabindex`), tree (`tree` / `treeitem` / `group`, `aria-expanded`), menu (`menu` / `menuitem`, `aria-haspopup` and `aria-expanded` on the key), dialog (name via `aria-labelledby`), toggle and reveal keys (`aria-pressed`), sort (`aria-sort` on `th`), pagination and breadcrumb (`nav` with a name, `aria-current`). Every button has a name. | Suite check 8; `probe --aria` per widget |
| 4.1.3 Status Messages | Toasts in a polite live region; copy feedback announced; busy containers: `aria-busy` alone announces nothing, so the catalogue should tell hosts to pair it with a status message. | Suite toast and copy checks; catalogue text |

## Beyond the AA list, still audited

- **Forced colours:** states, marks, lamps and arrows survive `forced-colors: active` (suite `forced` group and its shots).
- **Reduced motion, RTL, print:** suite `rtl` and `print` groups; reduced-motion checks.
- **Density modes:** every finding that depends on density names the density.
