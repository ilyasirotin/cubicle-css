#!/usr/bin/env bash
# Local minified build. Development tool only; the kit never requires it.
#
# Usage:  bash scripts/build-min.sh
# Setup:  cd scripts && npm install        (installs the pinned lightningcss-cli and terser)
# Output: dist/cubicle.min.css, and dist/cubicle.min.js once dist/cubicle.js exists.
#         The output is committed, because a CDN serves a tag's repository files. Never edit it by
#         hand: rebuild it and commit it with every change to dist/cubicle.css or dist/cubicle.js.
#         CI fails when the committed files differ from a fresh build.
#
# No browser targets are passed on purpose: the minifiers must not add vendor
# prefixes or rewrite modern syntax (@layer, nesting, color-mix, ES2020) that
# AGENTS.md requires to stay as written. Check the result with:
#   node scripts/verify-browser.mjs --css dist/cubicle.min.css --js dist/cubicle.min.js

set -euo pipefail
cd "$(dirname "$0")/.."

TOOLS_DIR="scripts/node_modules/.bin"
CSS_SOURCE="dist/cubicle.css"
CSS_OUTPUT="dist/cubicle.min.css"
JS_SOURCE="dist/cubicle.js"
JS_OUTPUT="dist/cubicle.min.js"

# Stops the build when a pinned dev dependency is not installed.
require_tool() {
  local tool_name="$1"
  if [ ! -x "$TOOLS_DIR/$tool_name" ]; then
    echo "build-min: $tool_name is missing. Run: cd scripts && npm install" >&2
    exit 1
  fi
}

byte_count() {
  wc -c < "$1"
}

require_tool lightningcss
"$TOOLS_DIR/lightningcss" --minify "$CSS_SOURCE" -o "$CSS_OUTPUT"
css_source_bytes="$(byte_count "$CSS_SOURCE")"
css_output_bytes="$(byte_count "$CSS_OUTPUT")"
printf 'dist/cubicle.min.css  %s -> %s bytes\n' "$css_source_bytes" "$css_output_bytes"

if [ -f "$JS_SOURCE" ]; then
  require_tool terser
  # Keeps the /*! licence header; --ecma 2020 lets terser keep modern syntax as written.
  "$TOOLS_DIR/terser" "$JS_SOURCE" --ecma 2020 --compress --mangle \
    --comments '/^!/' --output "$JS_OUTPUT"
  js_source_bytes="$(byte_count "$JS_SOURCE")"
  js_output_bytes="$(byte_count "$JS_OUTPUT")"
  printf 'dist/cubicle.min.js   %s -> %s bytes\n' "$js_source_bytes" "$js_output_bytes"
fi
