---
name: cubicle-audit
description: Conduct a comprehensive Completeness, Enterprise Readiness, and WCAG Semantic Audit of the Cubicle framework. Use to evaluate form coverage, component gaps, and accessibility architecture for B2B/IAM consoles.
---

Conduct a complete Enterprise & WCAG Audit of the Cubicle codebase (`dist/cubicle.css`, `docs/index.html`). Do NOT edit files. Run the verification suite first (`node scripts/check-tokens.mjs`, `check-snippets.mjs`, `verify-browser.mjs`). Report findings in Russian.

1. **Enterprise Form & Input Coverage:**
   - Audit `dist/cubicle.css` and `docs/index.html` for complete native `<form>` element support.
   - Specifically check edge-case inputs critical for enterprise: `type="number"` (spin-button normalization, tabular-nums), `type="file"` (`::file-selector-button` styling), `type="date`/`datetime-local`, `type="search"`, `<textarea>` (resize logic, monospace support), and `<select multiple>`.
   - Verify that `:user-invalid` and `aria-invalid="true"` states are styled correctly for all the above.

2. **WCAG & Semantic Architecture (Non-Automated Checks):**
   - **Form Association:** Are input errors and hint texts structurally associated with inputs (e.g., ready for `aria-describedby` or implicitly grouped in `.cb-field`)?
   - **ARIA State Parity:** Do components rely on semantic attributes (`aria-expanded`, `aria-pressed`, `aria-current`, `aria-selected`) instead of utility classes for their state?
   - **Interactive Semantics:** Are structural elements like `<fieldset>` and `<legend>` used correctly for grouped controls (e.g., radio groups)? Are `<th>` scopes clear in `.cb-table`?
   - **Motion Restraint:** Ensure `prefers-reduced-motion` is respected for the busy spinner (`--cb-duration-spin`).

3. **Enterprise UI Gap Analysis:**
   - Identify missing UI primitives required for dense infra dashboards: Key-Value lists (`<dl>`, `<dt>`, `<dd>`), log viewer blocks, multi-action dropdowns, or split-pane master-detail layouts.

**Report Format:**
- **Executive Summary:** Brief assessment of SSR/HTMX readiness and WCAG structural compliance.
- **Form Matrix:** Table of all native inputs/form elements vs. their current CSS/Docs coverage.
- **WCAG Semantic Violations:** List of missing ARIA mappings, poor HTML structures, or accessibility antipatterns.
- **Enterprise Gap Analysis:** Missing console patterns prioritized as P0 (Must fix), P1 (High value), P2 (Composition only).