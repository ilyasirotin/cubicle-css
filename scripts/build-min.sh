#!/usr/bin/env bash
# Local minified build. Development tool only; the kit never requires it.
#
# Usage:  bash scripts/build-min.sh
# Setup:  cd scripts && npm install        (installs the pinned lightningcss-cli)
# Output: dist/cubicle.min.css, and dist/cubicle.min.js once dist/cubicle.js exists.
#         Output is git-ignored. Never edit it, never commit it.
#
# No browser targets are passed on purpose: the minifier must not add vendor
# prefixes or rewrite modern syntax (@layer, nesting, color-mix) that AGENTS.md
# requires to stay as written. Check the result with:
#   node scripts/verify-browser.mjs --css dist/cubicle.min.css

set -euo pipefail
cd "$(dirname "$0")/.."

bin=scripts/node_modules/.bin/lightningcss
if [ ! -x "$bin" ]; then
  echo "build-min: lightningcss is missing. Run: cd scripts && npm install" >&2
  exit 1
fi

"$bin" --minify dist/cubicle.css -o dist/cubicle.min.css
printf 'dist/cubicle.min.css  %s -> %s bytes\n' "$(wc -c < dist/cubicle.css)" "$(wc -c < dist/cubicle.min.css)"

if [ -f dist/cubicle.js ]; then
  echo "build-min: dist/cubicle.js exists but no JS minifier is chosen yet. Ask the maintainer." >&2
  exit 1
fi
