---
name: cubicle-review
description: Review a Cubicle change against AGENTS.md before committing. Use when a component or token change is finished, or when asked to review, check or audit the stylesheet or docs page.
---

Review the current uncommitted change (`git diff`) against the Cubicle brief in `AGENTS.md`. Do not edit files in this skill; report only.

1. **Browser checks.** Run `node scripts/verify-browser.mjs`. If it cannot run (dependencies missing), say so and give the setup command from the top of that file. Do not skip silently.
2. **Look at it.** Read the screenshots in `tmp/shots/` (at least the 360 px and 1360 px pages and any dialog shot). Judge against the brief: Cool Industrial Steel palette discipline, tactile button separation (`--cb-bg-btn`, asymmetric bevel borders, `0 1px` press travel), recessed inputs, high information density, and proper distinction between inline tinted `.cb-btn--danger` and modal `.cb-btn--danger-solid`. Name concrete problems, not general impressions.
3. **State coverage and snippets.** For every component touched, confirm the catalogue `docs/index.html` shows it in default, hover, focus, active/pressed, disabled, readonly, invalid, and selected states where they apply. List what is missing, and confirm each snippet matches its live example (`node scripts/check-snippets.mjs`).
4. **Tokens.** Run `node scripts/check-tokens.mjs` (catalogue values match `@layer tokens`, every `var(--cb-*)` is declared). Confirm no new colour, radius, duration or shadow was introduced outside the `--cb-*` namespace in `@layer tokens`.
5. **Changelog.** Confirm `CHANGELOG.md` has an entry for the change under `[Unreleased]`.

Report in this shape, in the maintainer's language except for code and file names:

- **Verdict:** ready to commit, or not, in one line.
- **Must fix:** numbered, each with file, line and the rule from `AGENTS.md`.
- **Should consider:** numbered, lower priority.
- **Checked and fine:** one line.

Never claim a check passed without having run it in this session.