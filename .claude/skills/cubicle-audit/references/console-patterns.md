# Console patterns to check for the gap analysis

The work that IAM portals, VPN admin panels and infrastructure consoles actually do, grouped by
task. This list is a starting point, not a verdict. The kit grows between audits, so each line has
to be checked against the current stylesheet, catalogue and example before it is called a gap.
Classify each one:

- **Present:** a class or documented behaviour covers it. Cite the class and catalogue anchor.
- **Recipe:** existing parts compose it and the catalogue shows how (Recipes section), or could
  with a docs-only addition. A missing recipe is P2.
- **Missing:** needs new CSS or script. Priority by how often the target consoles need it.

Add patterns you meet that are not here, and drop ones the maintainer has ruled out of scope
(see the "Not done, by decision" lines in the roadmaps).

## Shell and navigation
- App shell with top bar, banner, sidebar, main, status bar; sidebar folding on narrow screens
- Environment banner (production / staging) and maintenance banner
- Breadcrumb, tabs (link and ARIA), tree (LDAP / AD / OU hierarchy) with lazy-loading branches
- Skip link; command palette or quick search (usually host-side, check only for the input look)
- User / session menu in the top bar (menu on a key)

## Data
- Data table: sorting, zebra, hover, selection, select-all, sticky head and columns, wide scroll, compact, wrapping cells, disabled rows, empty row, busy body
- Row actions inline and in a menu; **bulk action bar** shown when rows are selected
- **Filter bar** with fields and active-filter chips that can be removed
- **Permission matrix:** roles × permissions grid of checkboxes with both axes sticky
- Pagination with page size and jump
- Key-value inspector (certificate, session, device), master-detail split
- **Audit trail / activity timeline** (who did what, when)
- **Diff view** for configuration or policy changes (added / removed lines)
- Log viewer with levels, timestamps, line anchors
- Code / JSON / YAML / PEM block, inline code and keys
- Metrics: meters, quotas, gauges, progress of long jobs; node health grid of LEDs

## Forms and configuration
- Every native input type, select, multi-select, textarea (see the form matrix step)
- Stacked and horizontal fields, fieldsets with legends, input groups with addons
- Validation: field error, fieldset-level error, error summary linking to fields, async (busy) validation
- **Token / tag input** for multi-value fields (CIDRs, scopes, groups)
- **Dual list** (available ↔ assigned roles), or its `select[multiple]` substitute
- Wizard / stepper; segmented choices; toggles
- Secrets: API tokens, WireGuard and SSH keys, certificates — masked, revealed, copied, downloaded, multi-line
- Password strength / policy checklist; MFA enrolment (QR area, backup code grid)
- **Typed confirmation** for destructive actions ("type the gateway name to delete")

## Feedback and states
- Alerts in four tones, banner form, dismissible; toasts; dialogs (popover and modal) with danger confirmation
- Empty states, busy containers, loading tree branches, disabled and read-only everywhere
- **Session-timeout warning** dialog; error pages (403 / 404 / 500) via the centred layout
- Copied / saved confirmations announced to assistive technology

## Theming and reach
- Density modes (compact / default / comfortable)
- **Dark scheme** (`prefers-color-scheme`): check whether the maintainer has scoped it in or out before listing it
- Forced colours, reduced motion, RTL, print, long translated labels
