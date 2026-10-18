#!/usr/bin/env bash
# Local minified build. Development tool only; the kit never requires it.
#
# Usage:  bash scripts/build-min.sh
# Setup:  cd scripts && npm install        (installs the pinned lightningcss-cli and terser)
# Output: dist/cubicle.min.css, and dist/cubicle.min.js once dist/cubicle.js exists.
#         Output is git-ignored. Never edit it, never commit it.
#
# No browser targets are passed on purpose: the minifiers must not add vendor
# prefixes or rewrite modern syntax (@layer, nesting, color-mix, ES2020) that
# AGENTS.md requires to stay as written. Check the result with:
#   node scripts/verify-browser.mjs --css dist/cubicle.min.css --js dist/cubicle.min.js

set -euo pipefail
cd "$(dirname "$0")/.."

need() {
  if [ ! -x "scripts/node_modules/.bin/$1" ]; then
    echo "build-min: $1 is missing. Run: cd scripts && npm install" >&2
    exit 1
  fi
}

need lightningcss
scripts/node_modules/.bin/lightningcss --minify dist/cubicle.css -o dist/cubicle.min.css
printf 'dist/cubicle.min.css  %s -> %s bytes\n' "$(wc -c < dist/cubicle.css)" "$(wc -c < dist/cubicle.min.css)"

if [ -f dist/cubicle.js ]; then
  need terser
  # Keeps the /*! licence header; --ecma 2020 lets terser keep modern syntax as written.
  scripts/node_modules/.bin/terser dist/cubicle.js --ecma 2020 --compress --mangle \
    --comments '/^!/' --output dist/cubicle.min.js
  printf 'dist/cubicle.min.js   %s -> %s bytes\n' "$(wc -c < dist/cubicle.js)" "$(wc -c < dist/cubicle.min.js)"
fi
