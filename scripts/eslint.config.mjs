// ESLint for dist/cubicle.js. Error-catching rules only (the recommended set); the
// style rules of AGENTS.md Section 7 are reviewed by hand, not by a formatter.
// Run with: bash scripts/lint.sh
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    files: ["dist/cubicle.js"],
    languageOptions: {
      // A classic script in an IIFE, as consumers load it. ES2021 because the file uses
      // logical assignment (||=), which is Baseline widely available.
      ecmaVersion: 2021,
      sourceType: "script",
      globals: globals.browser,
    },
    ...js.configs.recommended,
  },
];
