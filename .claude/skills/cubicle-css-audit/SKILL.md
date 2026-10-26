---
name: cubicle-css-audit
description: Behaviour-preserving cleanup of dist/cubicle.css and the size of cubicle.min.css — merge duplicate rule blocks, cut bytes, replace raw colours, radii and durations with tokens, unify the --_ private property names, sort declarations, remove magic numbers — each step proven by a before/after computed-style snapshot. Make sure to use this skill whenever the user asks to clean up, tidy, simplify, deduplicate, shrink, slim down or refactor cubicle.css or its minified build, in English or Russian (почистить, убрать дубли, срезать байты, магические числа, один словарь переменных), even if they never mention snapshots or say "no visual change". Not for reviewing a finished change before a commit (cubicle-review), release readiness (cubicle-audit), new components or bug fixes, cubicle.js or scripts, or other projects' stylesheets.
---

A cleanup changes how `dist/cubicle.css` reads and how many bytes it ships, never what a browser draws. That one invariant shapes everything below: each concern is applied on its own, and a computed-style snapshot of both docs pages, taken before the first edit, must still match after it. Anything that would change rendering, however small or welcome, is a finding for the maintainer, not part of the cleanup, because a refactor commit that also restyles something hides that restyle from review.

## Ground rules

- **One concern per commit** (AGENTS.md §11): tokens, private properties, deduplication and declaration order are four commits, never one.
- **Commit only on the maintainer's word.** If they said in this conversation to commit as you go, commit each concern once its checks pass and carry on. Otherwise apply the first concern, verify it, and stop with a ready commit subject and the plan for the rest. Run `/cubicle-review` before any commit.
- **Start from a clean stylesheet.** If `git status --short dist/cubicle.css` shows changes, stop and ask: the snapshot would bake someone's unfinished work into the baseline.
- **Never `git stash`, `git checkout -- dist/cubicle.css` or `git restore` it.** When a step breaks the snapshot, find and undo the edit that did it (see "When the snapshot differs"). Throwing away the whole file needs the maintainer's say-so.
- **Measure, then claim.** Every finding cites `dist/cubicle.css:<line>` or a check's output line; every size is one you printed in this session.

## 1. Baseline (before any edit)

Run these from the repository root and keep their output for the report:

1. `bash scripts/build-min.sh` prints the source and minified bytes of `cubicle.css`; then `gzip -9c dist/cubicle.min.css | wc -c` gives the size that ships over the wire.
2. `node .claude/skills/cubicle-css-audit/scripts/style-snapshot.mjs capture tmp/css-audit/before.json` records the computed style of every element (and rendered `::before`, `::after`, `::marker`) of `docs/index.html` and `docs/example.html` at 360, 720, 800 and 1360px, in compact and comfortable density, in forced colours and in print. It takes about 35 seconds. Custom properties are left out on purpose, so a `--_` rename is no difference while every property it feeds still is.
3. If the plan touches engine-specific rules (`::-webkit-*`, `::-moz-*`, `<meter>`, `<progress>`, range, form controls), also capture `--browser firefox` and `--browser webkit` baselines now (`before-firefox.json`, `before-webkit.json`). A condition an engine cannot emulate prints as a labelled skip, not a match.
4. `node .claude/skills/cubicle-review/scripts/scan-diff.mjs --all` lists raw colours, shadows, radii and durations outside `@layer tokens`, plus naming and nesting leads across the whole file. `node scripts/check-tokens.mjs` confirms every `var(--cb-*)` exists.
5. `grep -oE -- '--_[a-z-]+' dist/cubicle.css | sort | uniq -c | sort -rn` inventories the private properties.

The same `before.json` stays the reference for the whole task, because no step is allowed to change what it records.

## 2. Audit, then apply one concern at a time

Read the stylesheet section by section, following its Table of Contents, and collect leads for all four concerns before editing anything. Then apply them in this order, from least to most churn, so that each diff stays small enough to review and the large reordering diff comes last instead of burying the others:

### 2.1 Token discipline

AGENTS.md §6 requires tokens for colour, radius, duration and shadow outside `@layer tokens`. Within that scope:

- Swap a raw value for the token or `color-mix(in srgb, …)` that **computes to the same value**. The snapshot proves it does.
- Raw lengths are not in the rule's scope. `0`, `100%`, `1px` borders, `rem` geometry of glyphs, LEDs and chevrons, and SVG data-URIs stay as written.
- Swapping a pixel value for a spacing or size token is **not** a cleanup: `data-cb-density` redefines `--cb-space-*`, `--cb-control-h` and `--cb-row-h`, so the value would start following density. The compact and comfortable snapshots catch this. Report it as a finding with the line and the token it could become.
- A value that needs a new token is a finding too: a new token also needs the catalogue's token tables and AGENTS.md §8, which is a feature, not a cleanup.

### 2.2 Private property vocabulary

Take the vocabulary from the file's majority (today `--_bg`, `--_ink`, `--_border`, `--_border-top`, `--_border-bot`, `--_shadow`, `--_grad`, `--_tone`, `--_h`), and rename only **synonyms**: two names for the same role in different components (`--_color` here and `--_text` there for the text colour). Names for different roles stay different, even when they look alike.

- **Names that `dist/cubicle.js` sets are a contract with the script**: `--_low` and `--_high` on meters, and `--_top`, `--_bottom`, `--_left`, `--_right` and `--_max` on menus (`grep -n -- '--_' dist/cubicle.js`). Leave them alone. If one truly must change, rename it in both files in the same commit and verify in all three engines.
- `--_line` in `docs/docs.css` belongs to the catalogue, not the kit.
- AGENTS.md §7 also wants each `--_` set on its component root and never self-referencing. A component that reads a parent component's `--_` is a finding, not a rename.

### 2.3 Deduplication

Merge only blocks that are truly identical, **inside one component's section** or in a shared rule its Table of Contents entry already names (for example 5.3's shared disclosure chevron). A rule shared across components that the ToC does not name would belong to no section, so the file would stop reading top to bottom: report such candidates instead of creating them.

Specificity is where merges go wrong:

- **A plain selector list keeps each selector's own specificity.** `.cb-a[disabled], .cb-b:disabled { … }` matches exactly what the two rules matched. Prefer it.
- **`:is(x, y)` takes the specificity of its most specific argument**, and so does a nested `&` under a selector-list parent: `.cb-a, .cb-b > li { &:hover { … } }` gives every hover the specificity of `.cb-b > li:hover`. Use `:is()` only to factor out a shared part when all of its arguments have equal specificity, as `.cb-btn:is([disabled], [aria-disabled="true"])` does.
- **`:where()` drops its part to zero.** Use it only where the original selector already used `:where()`.
- **Moving a rule can change source order.** A merged block lands in one place. If a rule between the old positions sets the same property at equal specificity, the winner changes. Never merge across `@layer` blocks or across `@media` and `@container` boundaries.

Merge for readability or for bytes, and measure the bytes: lightningcss already merges some identical rules when it minifies, so a source merge can shrink `cubicle.css` and leave `cubicle.min.css` unchanged.

### 2.4 Declaration order

Inside each rule, declarations follow this order:

1. Private custom properties (`--_*`)
2. `content`, in pseudo-element rules
3. Position and layout: `display`, `grid-*`, `flex-*`, `gap`, alignment, `position`, `inset-*`, `z-index`
4. Box model: sizes, `margin`, `padding`, `box-sizing`, `overflow`
5. Typography: `font-*`, `line-height`, `text-*`, `white-space`, `color`
6. Visuals: `background`, `border*`, `border-radius`, `box-shadow`, `opacity`, `translate` and transforms, then `cursor`, `pointer-events`, `user-select`
7. `transition-*` and `animation-*`
8. Nested rules

The file already mostly follows this order (`.cb-btn` is the model), so fix the rules that deviate and leave the others alone. Three rules keep the reordering behaviour-neutral:

- **A shorthand stays before its own longhands**: `border` before `border-color`, `margin` before `margin-inline`, `inset` before `inset-block-start`. Swapping them lets the shorthand reset the longhand.
- **Never reorder nested rules among themselves.** Their order is cascade order at equal specificity: `.cb-btn` puts the pressed state "before :hover so hover still tints it". Only declarations move.
- **A comment travels with the declaration it explains.**

The minified size should stay the same; gzip may move by a few bytes either way.

## 3. Prove each concern

After each concern, before showing or committing it:

1. Capture `tmp/css-audit/after.json` and run `node .claude/skills/cubicle-css-audit/scripts/style-snapshot.mjs compare tmp/css-audit/before.json tmp/css-audit/after.json`. It must print `snapshots match`. Repeat in Firefox and WebKit against their own baselines when you captured them.
2. Run `bash scripts/build-min.sh` and gzip again. The minified bytes must be equal to or smaller than after the previous concern.
3. Run `node scripts/check-tokens.mjs`, and `node .claude/skills/cubicle-review/scripts/scan-diff.mjs` on the lines this concern added.
4. Run `node scripts/verify-matrix.mjs --browsers chromium` (both pages). Use `--browsers chromium,firefox,webkit` when the concern touched engine-specific rules, form controls or names `dist/cubicle.js` sets.
5. The snapshot cannot see engine pseudo-elements: a meter's `::-webkit-progress-bar` and `::-moz-meter-bar`, a range track and thumb, spin buttons. When a concern touched a rule that paints one, run `node .claude/skills/cubicle-css-audit/scripts/pixel-probe.mjs --browser <engine> --css tmp/css-audit/head.css > tmp/css-audit/px-before.txt` on the original (`git show HEAD:dist/cubicle.css > tmp/css-audit/head.css`), then once without `--css` for the new file, and `diff` the two: one hash line per element screenshot, so equal files mean equal pixels. Break a value on purpose in a copy once to see the probe notice it; Firefox paints a meter's hatch on the element itself, so there the snapshot is the check and the probe may stay silent.
6. The snapshot cannot see `:hover`, `:focus` and `:active`. When a concern moved or merged rules for those states, open `tmp/shots/index-chromium/state-<element>-<hover|focus|active>.png` for the touched components and check them against the brief.

Capture once per concern, not once per edit; batch the edits. Without the maintainer's word to commit, still apply the concerns one after another, each proven against the same `before.json`, and keep `git diff dist/cubicle.css > tmp/css-audit/concern-<n>.patch` after each so the report can show them apart. Once at the end of the task, run `node scripts/verify-matrix.mjs --min`: three engines, source and minified build.

### When the snapshot differs

The compare prints, per condition, how many boxes each property changed and then the first differences, with the box and both values. One cause usually shows up as its own property plus the widths it moved: `font-weight` on 235 boxes, then `inline-size` on 225. Find the edit that sets the leading property (`git diff -U0 dist/cubicle.css | grep <property>`), then fix it or undo just that edit, and compare again. If only a handful of boxes differ, none of them touched by the diff, capture once more before hunting. The script finishes CSS transitions before it reads styles, because the docs page ticks a checkbox after load and a capture that caught that transition half way recorded the start colours; a recapture that matches the baseline is a flake, not your edit, and still worth a line in the report. If the difference is an improvement you want to keep, it is still a finding: undo it here and report it.

## 4. Housekeeping

- If deduplication created or moved a shared rule, update the Table of Contents entry that names it.
- If the rounded figures change, update the size sentence in the README's Install section ("The minified files are … KB (… KB gzip) and …"). Rebuilding changes the minified files, so also rerun `bash scripts/build-min.sh` and commit them.
- A change that renders nothing differently gets no `CHANGELOG.md` entry, because `[Unreleased]` reads as release notes. Say in the report that you skipped it, so the maintainer can overrule you.

## 5. Report

Write in the maintainer's chat language; code, selectors and file names stay as written. Use this shape:

- **Applied:** the concern, and the commit subject (`refactor(css): one name per private property role`), committed or ready to commit.
- **Proof:** the `snapshots match` line for each engine; one line per check with its result (`verify-matrix chromium: index <passed>/<total>, example <passed>/<total>`). Mark anything not run and why.
- **Bytes:** a table of source, minified and gzip bytes, before and after this concern, and since the baseline.
- **Changes:** renamed properties as `old → new` with their line count, merged selectors with `dist/cubicle.css:<line>`, the number of rules reordered.
- **Findings, not applied:** each with its line, what it would change (density, specificity, a new token, a cross-component rule) and the smallest way to do it as its own feature or fix.
- **Next:** the remaining concerns in order, with how many leads each has.
