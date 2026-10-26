#!/usr/bin/env bash
# Lints the shipped sources. Development tool only; the kit never requires it.
#
# Usage:  bash scripts/lint.sh
# Setup:  cd scripts && npm install        (installs the pinned stylelint and eslint)
# Checks: dist/cubicle.css with stylelint, dist/cubicle.js with eslint.
#         Error-catching rules only; see scripts/stylelint.config.mjs and scripts/eslint.config.mjs.
# Exit:   0 when both are clean, 1 when either reports a problem or a tool is missing.

set -euo pipefail
cd "$(dirname "$0")/.."

TOOLS_DIR="scripts/node_modules/.bin"
CSS_SOURCE="dist/cubicle.css"
CSS_CONFIG="scripts/stylelint.config.mjs"
JS_SOURCE="dist/cubicle.js"
JS_CONFIG="scripts/eslint.config.mjs"

# Stops the run when a pinned dev dependency is not installed.
require_tool() {
  local tool_name="$1"
  if [ ! -x "$TOOLS_DIR/$tool_name" ]; then
    echo "lint: $tool_name is missing. Run: cd scripts && npm install" >&2
    exit 1
  fi
}

require_tool stylelint
require_tool eslint

# Runs both linters even when the first fails, so one run reports every problem.
failed=0

echo "lint: $CSS_SOURCE (stylelint)"
if ! "$TOOLS_DIR/stylelint" --config "$CSS_CONFIG" "$CSS_SOURCE"; then
  failed=1
fi

echo "lint: $JS_SOURCE (eslint)"
if ! "$TOOLS_DIR/eslint" --config "$JS_CONFIG" "$JS_SOURCE"; then
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "lint: problems found" >&2
  exit 1
fi
echo "lint: clean"
