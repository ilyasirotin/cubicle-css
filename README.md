# Cubicle

A dense, tactile, accessible CSS framework for critical enterprise tools: identity and access
management portals, VPN admin panels, infrastructure consoles and back-office dashboards.

[![CI](https://github.com/ilyasirotin/cubicle-css/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/ilyasirotin/cubicle-css/actions/workflows/ci.yml)
[![Release workflow](https://github.com/ilyasirotin/cubicle-css/actions/workflows/release.yml/badge.svg)](https://github.com/ilyasirotin/cubicle-css/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/ilyasirotin/cubicle-css?include_prereleases&sort=semver)](https://github.com/ilyasirotin/cubicle-css/releases)
[![License: MIT](https://img.shields.io/github/license/ilyasirotin/cubicle-css)](LICENSE)
[![Tested in Chromium, Firefox and WebKit](https://img.shields.io/badge/tested-Chromium%20%7C%20Firefox%20%7C%20WebKit-informational)](https://github.com/ilyasirotin/cubicle-css/actions/workflows/ci.yml)

![The example VPN console built with Cubicle: a sidebar with navigation and a filterable directory tree, a gateway panel with tabs, a filter bar with an active-filter chip, a peers table with selection, status badges and pagination, and an inspector for the selected peer.](docs/img/example-console.png)

- **Made for operators.** Twenty to thirty table rows on a 1080p screen, monospace for every IP, key
  and hash, and tabular figures that line up.
- **Controls look like what they do.** Raised keys travel 1px when pressed, fields are recessed, and
  every state (current, selected, busy, invalid, disabled) is unambiguous.
- **One hand-written file.** `cubicle.css` has no build step and no runtime dependencies;
  `cubicle.js` is optional progressive enhancement.

**[Catalogue](https://cubicle.threadnull.dev/)** of every component in every state, with copy-paste
snippets · **[Example console](https://cubicle.threadnull.dev/example.html)** · [Changelog](CHANGELOG.md)

## Install

From the CDN, pinned to a release and checked by Subresource Integrity:

```html
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/ilyasirotin/cubicle-css@v1.0.0/dist/cubicle.min.css"
      integrity="sha384-7RV/49mx6TTlcuKA9zK2Jfi+PYsI3q4RJIeEp8PEJ0tzQBAyVgdKIoopWniMhc3F"
      crossorigin="anonymous">
<script src="https://cdn.jsdelivr.net/gh/ilyasirotin/cubicle-css@v1.0.0/dist/cubicle.min.js"
        integrity="sha384-2qvZb9d/l3Xp2zrAyFO7aSiRHlNokRUHbqPv8xQhXO++v8CHny/FFmxGl1SUgJdx"
        crossorigin="anonymous" defer></script>
```

Or take the files: download the zip from the [latest release](https://github.com/ilyasirotin/cubicle-css/releases/latest)
(with `checksums.txt`), or copy `dist/cubicle.css` and optionally `dist/cubicle.js` into your
project. The minified files are 57 KB (10.6 KB gzip) and 12.8 KB (4.6 KB gzip).

## Use

Everything is opt-in: Cubicle styles only elements with a `cb-*` class, plus the document's body
text, links, monospace elements and the focus ring.

```html
<div class="cb-app">
  <header class="cb-app__top"><strong>VPN Console</strong></header>
  <nav class="cb-app__side cb-nav" aria-label="Console">
    <ul class="cb-nav__list">
      <li><a class="cb-nav__link" href="/gateways" aria-current="page">Gateways</a></li>
    </ul>
  </nav>
  <main class="cb-app__main">
    <button class="cb-btn cb-btn--primary" type="button">Add gateway</button>
  </main>
  <footer class="cb-app__status"><span class="cb-led cb-led--ok">Connected</span></footer>
</div>
```

The script works through `data-cb-*` attributes with delegated listeners on the document, so markup
swapped in later (HTMX, frameworks) needs no initialisation. State lives in standard attributes
(`aria-current`, `aria-selected`, `aria-invalid`, `aria-busy`, `disabled`, `open`), not in classes.

## Customise

- **Tokens.** Every colour, radius, shadow, duration, size and spacing step is a `--cb-*` custom
  property. Override any of them in your own CSS: `:root { --cb-accent: #24527a; }`.
- **Layers.** The stylesheet is split into cascade layers (`reset, tokens, base, layout,
  components, utilities`), so any unlayered rule of yours wins without `!important`.
- **Density.** `data-cb-density="compact"` or `"comfortable"` on `<html>` or any subtree changes
  control and row heights; type sizes stay.
- **Themes.** `data-cb-theme` on `<html>` or any subtree picks the palette: `glacier` (the
  default), `steel` (the 1.0 look), `industrial` or `monochrome`. All four are light and pass the
  same contrast checks.

## Accessibility and browsers

Text meets WCAG AA contrast, and boundaries and the focus ring meet 3:1, measured in a real browser
for every palette pair; every control has a visible focus ring and a keyboard path. Forced colours,
right to left and print are covered. Details and measurements: the
[Accessibility](https://cubicle.threadnull.dev/#accessibility) section.

Cubicle targets Baseline "widely available" features in evergreen browsers, and the whole
verification suite passes in Chromium, Firefox and WebKit. The few engine differences are listed
under [Engines](https://cubicle.threadnull.dev/#a11y-engines).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the checks and the definition of done;
[AGENTS.md](AGENTS.md) is the full specification.

## License

[MIT](LICENSE)
