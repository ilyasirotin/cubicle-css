# Contributing to Cubicle

[AGENTS.md](AGENTS.md) is the specification: design language, tokens, naming and the definition of
done. This guide is the practical summary for making a change.

## Setup

Using Cubicle needs nothing. Working on it needs Node.js and the pinned dev tools:

```sh
cd scripts
npm install
npx playwright install chromium firefox webkit
```

## Workflow

- One concern per commit, with [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- Everything in the repository is English: code, comments, docs, commit messages.
- Pushes, tags and releases are the maintainer's.

## Writing CSS

`dist/cubicle.css` is edited by hand and reads top to bottom, starting with its table of contents.
Keep the TOC in step with the sections.

- **Layers.** Rules belong to `reset`, `tokens`, `base`, `layout`, `components` or `utilities`.
  Host overrides are unlayered, so nothing needs `!important`.
- **Tokens only.** Colours, radii, durations and shadows come from `--cb-*` tokens in
  `@layer tokens`. Derive states with `color-mix(in srgb, …)` instead of adding tokens. A new token
  is documented in AGENTS.md section 8 and in the catalogue's token tables.
- **Naming.** Use `cb-` classes in BEM-lite (`cb-panel__head`, `cb-btn--sm`) and `--_` private
  properties on the component root, never self-referencing. Native nesting goes at most two levels
  deep.
- **States** use standard attributes first (`disabled`, `readonly`, `aria-pressed`,
  `aria-selected`, `aria-current`, `aria-invalid`, `aria-busy`, `open`). Script hooks are
  `data-cb-*` attributes.
- **Never use** ID selectors, `!important`, vendor-prefixed properties, inline styles in docs, or
  remote resources. Engine-specific pseudo-elements are allowed only where AGENTS.md section 6
  lists them, each with a comment.
- **Focus.** One indicator, `--cb-focus-ring`. It is drawn outside by default, inside scroll
  containers and scrolling tab lists, and on the row label of a tree item.
- **Motion.** Transitions last at most `--cb-duration`. The stepped busy spinner is the only loop,
  and it stops under reduced motion.

`dist/cubicle.js` is optional progressive enhancement. It needs no dependencies and uses delegated
listeners on the document for `data-cb-*` hooks. Markup must keep working, or degrade visibly, without
it.

## Documenting

The catalogue is the test. For every component, `docs/index.html` has:

1. one sentence on what it is for;
2. a live demo of every state it supports;
3. a `<pre class="docs-snippet"><code>` snippet byte-identical to the demo — generate it from the
   demo markup with a small script rather than escaping by hand (the catalogue highlights, numbers,
   collapses and copies it by itself, so add no classes or buttons);
4. a reference table of classes and attributes.

`docs/docs.css` styles the catalogue only and never reaches into demos. Show the change in
`docs/example.html` where it belongs on a real console screen.

## Checking

Run these before every commit:

```sh
node scripts/check-snippets.mjs
node scripts/check-tokens.mjs
node scripts/verify-browser.mjs --browser chromium
node scripts/verify-browser.mjs docs/example.html --browser chromium
```

Before a release, and after any change to rendering or `cubicle.js`, run the suite in all three
engines, on the source and on the minified build:

```sh
bash scripts/build-min.sh
for page in docs/index.html docs/example.html; do
  for engine in chromium firefox webkit; do
    node scripts/verify-browser.mjs "$page" --browser "$engine"
    node scripts/verify-browser.mjs "$page" --browser "$engine" --css dist/cubicle.min.css --js dist/cubicle.min.js
  done
done
```

`verify-browser` writes screenshots to `tmp/shots/`; look at them. A line marked `skip` is a known
engine limit listed in the script's `ENGINE_LIMITS`, with its reason. It is never a silent pass, so
add one only for a real engine difference.

## Definition of done

- Colours, radii, durations, bevels and shadows come from tokens; no `!important`; no new `outline`
  rule beyond the focus placements above.
- The tactile model holds: keys are raised and travel 1px, fields and wells are recessed, numbers
  line up.
- No remote resource, runtime dependency or build requirement is added.
- The catalogue shows every state with a matching snippet, verified at 360, 800 and 1360px.
- Keyboard paths and the focus ring work; contrast is measured, not assumed.
- `check-snippets`, `check-tokens` and `verify-browser` pass.
- Naming follows AGENTS.md section 7; the stylesheet still reads top to bottom and its TOC is current.
- `CHANGELOG.md` has an entry under `[Unreleased]`.
