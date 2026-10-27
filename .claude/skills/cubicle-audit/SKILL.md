---
name: cubicle-audit
description: Whole-framework audit of Cubicle — component and state completeness, native form coverage, WCAG 2.2 AA, enterprise console gaps — ending in a scored release-readiness verdict saved to .claude/plans/audit-<date>.md. Use after significant component work (a new or reworked component, changed states, tokens or cubicle.js behaviour, the end of a roadmap phase), before declaring a release, or whenever asked whether Cubicle is complete, accessible, production-ready, "ready for v1", or what it still lacks. For one change about to be committed, use cubicle-review instead.
---

Audit the whole of Cubicle (`dist/`, `docs/`, `README.md`, `CHANGELOG.md`) against `AGENTS.md` and decide whether it is ready to release. `cubicle-review` judges one diff before a commit; this audit judges the framework as it stands after many commits, so it looks for what a sequence of individually fine changes left behind: states styled but never shown, components missing from the example or the README, accessibility criteria no check covers, console patterns the kit still cannot express.

The report is the only file you write. Do not edit, stage or commit project files: the maintainer turns findings into a roadmap. Probes and throwaway pages go in the scratchpad; suite output goes to `tmp/` as usual, and `--min` rebuilds the git-ignored `dist/*.min.*`. If you run as a subagent and cannot write the report, return its full text to the caller instead of a summary.

Two habits keep the audit honest:

- **Inventory before judging.** The kit grows between audits. A gap taken from memory, from the previous report or from the pattern list is a claim to check, not a finding: grep the stylesheet and open the catalogue before calling anything missing. (The first version of this skill hunted for key-value lists, log viewers, menus and split panes months after they shipped.)
- **Measure, do not assume** (AGENTS.md §11). Every finding cites a check name, a probe line or `file:line`. "Probably fine" is not a result; neither is "looks heavy".

## 1. Baseline

1. `ls .claude/plans/audit-*.md` and read the latest report: its score, verdict, open P0 / P1 / P2 lists. Read the status section of the roadmap that followed it (`roadmap-*.md`), including "Not done, by decision" — those items are out of scope unless the maintainer reopens them.
2. `git log --oneline <start>..HEAD` for what changed since. `.claude/plans/` is git-ignored, so a report has no commit of its own: take `<start>` from the previous report's Scope line (it records the HEAD it audited), else from the roadmap's status section, else `git log --since=<report date>`. `git status --short`: if the tree is dirty, the audit covers the working tree; say so in the report.
3. `node .claude/skills/cubicle-audit/scripts/inventory.mjs` lists, against the catalogue and the example, every `cb-*` class, every state the stylesheet styles on a class, and every `data-cb-*` hook. `--full` prints every row, not only leads. Its leads feed steps 3 and 6; confirm each before reporting it (a state may be set on an ancestor, by script, or be unreachable by design).

## 2. Run the full suite

Start the matrix first, in the background: it takes several minutes, and steps 3–6 do not need it.

- `node scripts/verify-matrix.mjs --min` — both pages, three engines, source and minified (12 runs). This is the verdict run; never substitute `--only` or a single engine.
- `node scripts/check-tokens.mjs` and `node scripts/check-snippets.mjs`.
- After the matrix built the minified files: `grep -oE '@layer [a-z]+' dist/cubicle.min.css | awk '!s[$0]++'` lists first appearances as `reset → tokens → base → layout → components → utilities` (lightningcss drops the order statement, so first appearances are the order); `grep -rn htmx dist/` is empty.
- Sizes: `wc -c dist/cubicle*.{css,js}` and `gzip -c <file> | wc -c` for each.

Record every count and every `FAIL`. Compare with the previous report: a check count that went down means coverage was removed. Every skip must match `ENGINE_LIMITS` in `scripts/verify-browser.mjs` and the catalogue's Engines table (`#a11y-engines`); an unexplained skip counts as a failure. If the suite cannot run, give the setup line from the top of `scripts/verify-browser.mjs` and mark the verdict provisional — never report a check that did not run in this session.

## 3. Component completeness

Take the component list from the stylesheet's Table of Contents (§4 layout, §5 components, §6 utilities), not from memory. For each component, one row:

- **Catalogue** (`docs/index.html#<section>`): purpose sentence, live demo, matching snippet, reference table listing every modifier and state attribute the CSS styles.
- **States** demonstrated, from default, hover, focus, active, disabled, readonly, invalid, selected / current, busy, empty — only those that apply; write n/a for the rest. Inventory section 2 lists styled states no demo carries.
- **Suite:** the `verify-browser.mjs` group that guards it (`GROUPS` near the top of the script). A shipped component with no group is a should-fix.
- **Example:** used in `docs/example.html` where a real console would use it.
- **Reach:** density tokens, forced colours, RTL, print, where the component is affected.

Then look at the screenshots of the matrix run: `tmp/shots/index-<engine>/<section>-{360,1360}.png` (plus `state-*`, `dialog-*`, `forced-*`, `forms-matrix.png`) and `tmp/shots/example-<engine>/page-{360,800,1360}.png`; the header of `scripts/verify-browser.mjs` names them all. `tmp/shots/` also keeps directories from older work, so open only what this run wrote (`ls -lt tmp/shots | head`). Check that each shot shows the section it is named after (its heading is in the picture): a shot of the wrong section means the suite never looked at that section, which is a suite finding, and you take that section's shots yourself from the scratchpad. Judge the brief, not taste: steel palette with colour only for status and primary actions, raised keys with asymmetric bevel, recessed fields and wells, corners ≤ 3px, nothing taller than its control or row height, no clipping at 360px.

## 4. Native form coverage

Rebuild the form matrix: rows for `text`, `password`, `search`, `email`, `url`, `tel`, `number`, `date`, `time`, `datetime-local`, `month`, `week`, `color`, `file`, `range` (+ `<output>`), `checkbox`, `radio`, `<textarea>`, `<select>`, `<optgroup>`, `select[multiple]`, `<datalist>`, submit / reset, `<fieldset disabled>`, required marker, hint and error in stacked and horizontal fields. Columns: CSS, catalogue, states shown, engine quirks.

The suite's `forms` group (native form-control fixture) measures heights per density, tabular numerals, the file key and list-box selection. For anything outside it, probe in all three engines before writing a quirk down. The previous audit's Appendix C has the probe method (Playwright from `scripts/package.json` via `createRequire`, a scratchpad page linking `dist/cubicle.css` by `file://` URL).

## 5. WCAG 2.2 AA

Read `references/wcag.md`: the criteria that apply to a CSS kit, what each means for Cubicle, and where the evidence comes from. Most rows are answered by the suite. For the four the suite does not measure, run the probe on both pages, in Chromium and at least once in WebKit (its Tab model differs):

```
node .claude/skills/cubicle-audit/scripts/wcag-probe.mjs docs/index.html
node .claude/skills/cubicle-audit/scripts/wcag-probe.mjs docs/example.html --browser webkit
```

It reports 2.5.8 target size per density, 1.4.10 reflow at 320px, 1.4.4 text at 200%, 1.4.12 text spacing and 2.4.11 focus not obscured (after focus scrolling settles; "entirely covered" and "out of view" are separate lists, and only the first is a 2.4.11 failure by another box), each grouped with the `#id` where it occurs. It opens closed `<details>` and shows hidden tab panels first, so the example's Peers, Config and Log tabs count. `--verbose` lists every finding instead of one per group; `--aria "<selector>"` prints the accessibility tree of a widget for 4.1.2, instead of inferring roles from markup. Run it on both pages in both engines; differences between engines are findings too.

Classify every row as Pass, Fail, Host or n/a, with evidence. Density is a deliberate feature, so a target-size failure is reported with the density that causes it and a concrete remedy or a documented trade-off; do not wave it through, and do not treat opt-in compact density like the default.

## 6. Enterprise gap analysis

Work through `references/console-patterns.md`. Classify each pattern Present, Recipe or Missing, citing the class or catalogue anchor for the first two. Only Missing and absent recipes become gaps. Add patterns you notice that the list lacks.

Priorities, used across the whole report:

- **P0 — blocks release:** any failing check or unexplained skip; a WCAG AA failure in a shipped component at default density, or in a catalogue snippet hosts will copy; a state that looks applied but does not work (a disabled look on a control that still accepts input); a styled state or modifier with neither a catalogue demo nor a reference row; a breach of an AGENTS.md rule (§6 tokens, §7 naming and nesting, §13); README, CHANGELOG or the CSS ToC contradicting what ships.
- **P1 — next phase:** a styled state with a reference row but no demo; a pattern the target consoles need often; a component absent from the example; missing suite coverage of a shipped component; WCAG issues limited to compact density or with a documented workaround.
- **P2 — docs only:** recipes and compositions of existing parts.

## 7. Release readiness

Score each dimension, then add them up. Show the deductions so the next audit can compare like with like. If the previous report has no such table, say the change in score is indicative only.

| Dimension | Max | Full marks when |
|---|---|---|
| Suite health | 2 | Every run green, source and minified, three engines; skips all labelled; no coverage lost since the last audit |
| Component completeness | 2 | Every component catalogued in every applicable state, with reference rows and suite coverage |
| Native forms | 1.5 | Every type in the matrix styled, documented, measured; quirks documented |
| WCAG 2.2 AA | 2.5 | No kit Fail at default density; Host rows guided in the catalogue |
| Console coverage | 1 | No Missing pattern the target consoles need often |
| Release hygiene | 1 | CHANGELOG `[Unreleased]` reads as release notes for everything since the last release; the README's install snippet (pin and SRI), the ToC, the catalogue header and the banners agree with the latest tag (`node scripts/check-release.mjs <tag>`); LICENSE present; the pipeline matches AGENTS.md §14 |

Verdict:

- **Ready for release:** no P0, score ≥ 9.
- **Ready after P0 fixes:** P0 items are few and local (each a commit or two), nothing structural.
- **Not ready:** failing suite, structural accessibility failures, or P0s that need design decisions.

The audit informs the maintainer's release decision (AGENTS.md §14); it never tags, configures a release or proposes workflow files.

## 8. Report

Save it as `.claude/plans/audit-<YYYY-MM-DD>.md` (add `-2` if that name exists), in English (AGENTS.md §12), following the shape of the previous report:

```
# Audit — Completeness, WCAG & Release Readiness (<date>)
**Scope:** files; commit range `<start>..<HEAD hash>` since the last audit (the next audit starts from this hash); dirty tree or not.
## 0. Baseline — table of every check run, its counts, skips; sizes; deltas from the last audit
## 1. Verdict and score — verdict, score table with deductions, the 3–5 reasons that decide it
## 2. Since the last audit — each previous P0/P1: closed (commit), still open, or regressed
## 3. Components and states — gaps only, then one line listing components fully verified
## 4. Native form matrix
## 5. WCAG 2.2 AA — one row per criterion: result, evidence, remedy
## 6. Console gaps — Present / Recipe / Missing table, then P0 / P1 / P2 lists
## 7. Proposed commits — Conventional Commits subjects, one concern each
## Appendix — measurements and probe output worth keeping
```

Each finding gives `file:line` or the check / probe line, what is wrong, the AGENTS.md section or WCAG criterion, and the smallest fix.

Then answer in chat in the maintainer's language (the language they write in): verdict, score and its change since the last audit, the P0 list, the report path. Offer to turn the findings into a roadmap; do not write one unasked.
