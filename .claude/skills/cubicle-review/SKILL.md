---
name: cubicle-review
description: Review a Cubicle change against AGENTS.md before committing — runs the snippet, token and browser checks, scans the added CSS for rule breaks the scripts miss, and returns a ready / not-ready verdict with file:line findings. Use whenever a component, token, script or docs change is finished, before any commit, or when asked to review, check, audit or "look over" the stylesheet, cubicle.js, the catalogue or the example page.
---

Review the change that is about to be committed against the brief in `AGENTS.md`. Report only: do not edit, stage, restore or commit anything, because the maintainer decides what happens to the findings.

The scripts in `scripts/` catch broken snippets, undeclared tokens and rendering faults. They do not catch most of the brief's hand-written rules (raw values, outlines, vendor prefixes, missing docs), so a green suite is the start of the review, not the verdict.

## 1. Establish the change

Run `git status --short` and `git diff HEAD`. `git diff HEAD` shows staged and unstaged edits together; plain `git diff` hides whatever is already staged, which is often the CSS. Read every untracked file that belongs to the change. Note in the report if the change is split between staged and unstaged, since a commit of the index alone would ship only part of it.

List the components, tokens, scripts and pages it touches. Everything below is scoped by that list.

## 2. Run the checks

Run each one and keep its summary line (counts and every `FAIL`) for the report.

1. `node scripts/check-snippets.mjs`: every catalogue demo matches its `<pre><code>`.
2. `node scripts/check-tokens.mjs`: tokens and the catalogue agree; every `var(--cb-*)` exists.
3. `node .claude/skills/cubicle-review/scripts/scan-diff.mjs`: scans only the lines the change adds to `dist/cubicle.css` and `dist/cubicle.js` for raw colours, shadows, radii and durations outside `@layer tokens`, `!important`, ID selectors, vendor prefixes, `outline` outside focus rules, blur, nesting deeper than two levels, custom property naming, self-referencing variables, remote resources and class or style toggling in script. Its output is a list of leads: read each line and confirm it before reporting it.
4. `node scripts/verify-matrix.mjs --browsers chromium` runs the browser checks on the catalogue and on `docs/example.html` (the integration test) side by side. Use `--pages index` when the change touches neither `dist/` nor `docs/example.html`.
5. Use `--browsers chromium,firefox,webkit` instead when the change touches engine pseudo-elements (`::-webkit-*`, `::-moz-*`), form controls, `<meter>`, `<progress>`, range inputs, `dist/cubicle.js`, or a platform feature from AGENTS.md Section 10. Engine limits print as labelled skips; a skip is not a failure, but a new skip needs a reason.
6. The matrix prints one line per run and every `FAIL`; the full report of a run is `tmp/verify/<page>-<engine>.txt`. Do not trust a partial run (`--only`) as the verdict.

If a script cannot run (missing dependencies), say so and give the setup line from the top of `scripts/verify-browser.mjs`. Never skip silently, and never report a check as passed unless it ran in this session.

## 3. Look at the screenshots

Open the shots of what changed, not all of them; each run's directory `tmp/shots/<page>-<engine>/` (for example `tmp/shots/index-chromium/`) holds about two hundred. Names follow the catalogue sections: `badges-<width>.png`, `tables-<width>.png`, `tables-sticky-360.png`, `alerts-`, `tabs-`, `nav-`, `meters-`, `segmented-`, `details-`, `pagination-`, `utilities-<width>.png`, `dialog-<id>.png`, and `state-<element>-<rest|hover|focus|active>.png` for interactive controls. Look at least at 360 and 1360 for each touched section, and at the state shots of any control whose states changed. `ls tmp/shots/index-chromium | grep <section>` finds them.

Judge against the brief and name what you see, not an impression:

- Steel palette discipline; colour only for status and primary actions.
- Buttons raised (`--cb-bg-btn`, light top/left and dark bottom/right edges, `translate: 0 1px` on press); inputs and wells recessed.
- Density: nothing taller than its control or row height; text not clipped or overflowing at 360.
- Inline tinted `.cb-btn--danger` in tables versus solid `.cb-btn--danger-solid` in modal confirmations.
- Corners at 3px or less; round only for LEDs, the spinner and radios.

## 4. Read the diff against the brief

These rules need judgement, so no script checks them:

- **Tokens.** A new colour, radius, duration or shadow is a new `--cb-*` token in `@layer tokens`, documented in the catalogue, or a `color-mix(in srgb, …)` of existing tokens. Prefer the mix: the token list must not balloon.
- **States.** New states hook onto standard attributes (`disabled`, `aria-*`, `open`) before classes. Script behaviour hangs on `data-cb-*` through delegated document listeners, and script-only controls stay hidden until the script runs.
- **Private variables.** `--_*` variables are set on the component root, never read from a parent component.
- **Nesting.** Nested rules are pseudo-states, attribute states or direct children of one component.
- **Motion.** Transitions use `--cb-duration` (50ms). Transitioning a property that the cells never paint (for example a `--_bg` set on `tr`) is dead code.
- **Redundancy.** Each rule must earn its bytes. Point out a modifier that an existing utility or modifier already provides.
- **Stylesheet document.** The Table of Contents names every new section, modifier or behaviour, and the comments are English and explain why.

Then check the documentation for each touched component. Missing documentation is a must-fix, because the docs are the test (AGENTS.md Section 11):

- `docs/index.html` shows every state that applies (default, hover, focus, active, disabled, readonly, invalid, selected or current, busy). Every new modifier or attribute has a row in the section's reference table, and the section's text mentions it.
- `docs/example.html` uses the feature where an IAM or VPN console realistically would. Missing use is a should-consider unless the change is one the example already demonstrates.
- A new colour pairing (ink on a new tint) is measured: it has a pair in `scripts/contrast-pairs.mjs`, or you report its contrast from a check you ran.
- `CHANGELOG.md` has an entry under `[Unreleased]` that matches what the change actually does.

## 5. Report

Write in the maintainer's language (the language they use in chat). Code, file names and rule quotes stay as written. Use this shape:

- **Verdict:** `Ready to commit` or `Not ready`, plus a one-line reason. Any failing check or any must-fix means `Not ready`.
- **Scope:** files and components reviewed; whether part of the change is staged.
- **Checks run:** one line per check with its result (`check-snippets 142/142`, `verify-browser chromium 268/269 — FAIL alert … 27px`, `scan-diff 0 leads`). Mark checks that were not run and say why.
- **Must fix:** numbered. Each item gives `file:line`, what is wrong, the AGENTS.md rule (section number) it breaks, and the smallest fix.
- **Should consider:** numbered and lower priority, each with a reason.
- **Checked and fine:** one line.
- **Commit:** a suggested Conventional Commits subject. If the diff mixes unrelated concerns, say how to split it (one component or concern per commit, AGENTS.md Section 11).

Keep findings concrete. "The hover looks heavy" is not a finding. "`dist/cubicle.css:1491` hard-codes `#1e4b85` in a box-shadow (§6 token discipline); use `var(--cb-accent)` in a shadow token or drop the edge" is a finding.
