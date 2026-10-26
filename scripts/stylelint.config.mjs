// Stylelint for dist/cubicle.css. Error-catching rules only: no stylistic rules,
// because the stylesheet is hand-written and AGENTS.md Section 7 owns its style.
// Run with: bash scripts/lint.sh

export default {
  rules: {
    // Names that do not exist.
    "property-no-unknown": true,
    "declaration-property-value-no-unknown": true,
    "at-rule-no-unknown": true,
    "selector-pseudo-class-no-unknown": true,
    "selector-pseudo-element-no-unknown": true,
    "function-no-unknown": true,
    "unit-no-unknown": true,
    "media-feature-name-no-unknown": true,

    // Values and blocks that are broken or accidental.
    "color-no-invalid-hex": true,
    // A repeated property is allowed only as a fallback with a different value, such as
    // content: "*" before content: "*" / "" (alt text) for engines without the second form.
    "declaration-block-no-duplicate-properties": [
      true,
      { ignore: ["consecutive-duplicates-with-different-values"] },
    ],
    "declaration-block-no-shorthand-property-overrides": true,
    "keyframe-block-no-duplicate-selectors": true,
    "block-no-empty": true,

    // AGENTS.md Section 7: selector hygiene and nesting depth.
    "declaration-no-important": true,
    "selector-max-id": 0,
    "max-nesting-depth": 2,

    // AGENTS.md Section 6: no vendor prefixes. These rules flag only prefixes that have a
    // standard form, so the engine pseudo-elements that Section 6 allows (meter, progress,
    // range, details marker, spin and search keys) pass without an exception list.
    "property-no-vendor-prefix": true,
    "value-no-vendor-prefix": true,
    "at-rule-no-vendor-prefix": true,
    "selector-no-vendor-prefix": true,
  },
};
