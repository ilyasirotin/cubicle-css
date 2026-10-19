/*!
 * Cubicle — optional progressive enhancement for dist/cubicle.css.
 * MIT License. No dependencies. Load with: <script src="cubicle.js" defer></script>
 */

/*
 * Behaviour hooks are data-cb-* attributes on controls; each value is the id of
 * the target element. Delegated click and keydown listeners on the document
 * serve them, so markup inserted later (HTMX swaps, frameworks) works without
 * re-initialisation.
 *
 *   data-cb-copy="id"                          copy the target's text
 *   data-cb-reveal="id" aria-pressed="false"   toggle a password field
 *     data-cb-reveal-timeout="30"              optional: re-mask after N seconds
 *   data-cb-download="id" data-cb-filename=""  save the target's text as a file
 *   data-cb-select-all="id"                    header checkbox: (un)check every row
 *                                              checkbox of the table; it shows the
 *                                              rows' state, indeterminate when mixed
 *   data-cb-dismiss="id"                       hide the target (an alert); focus
 *                                              moves to the next focusable element
 *   data-cb-tabs (no value)                    container of ARIA tabs: click,
 *                                              arrow keys, Home and End select a
 *                                              role="tab"; state lives in the markup
 *   data-cb-tree (no value)                    container of an ARIA tree: arrow keys,
 *                                              Home, End; click, Enter and Space
 *                                              select a row and toggle a branch,
 *                                              which fires "cb-toggle" (detail.expanded)
 *   data-cb-marks (no value, on <meter>)       marks low and high on the ruler strip;
 *                                              follows attribute changes and new meters
 *   data-cb-modal="id"                         open the <dialog> as a modal (showModal);
 *                                              closing stays native: method="dialog", Escape
 *
 * Until this script runs, the stylesheet hides those controls (html[data-cb-js]).
 */
(() => {
  'use strict';

  const COPIED_MS = 1500;
  const ACTIONS = '[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-dismiss], [data-cb-modal]';
  const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled, [type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';
  const SELECT_ALL = 'input[type="checkbox"][data-cb-select-all]';
  const TAB = '[data-cb-tabs] [role="tab"]';
  const TREE_ITEM = '[data-cb-tree] [role="treeitem"]';
  const remaskTimers = new WeakMap();
  let liveRegion;

  document.documentElement.setAttribute('data-cb-js', '');

  // Polite announcement through one shared, visually hidden live region.
  // The text is cleared first so a repeated message is announced again.
  const announce = (message) => {
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('data-cb-sr', '');
      document.body.append(liveRegion);
    }
    liveRegion.textContent = '';
    requestAnimationFrame(() => { liveRegion.textContent = message; });
  };

  const targetOf = (button, attribute) => document.getElementById(button.getAttribute(attribute));
  const textOf = (el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent);

  // Insecure contexts (plain-HTTP admin panels) have no async clipboard API:
  // copy through an off-screen textarea, which also works for password fields.
  const legacyCopy = (text) => {
    const focused = document.activeElement;
    const buffer = document.createElement('textarea');
    buffer.value = text;
    buffer.setAttribute('data-cb-sr', '');
    buffer.setAttribute('aria-hidden', 'true');
    buffer.setAttribute('readonly', '');
    document.body.append(buffer);
    buffer.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    buffer.remove();
    if (focused instanceof HTMLElement) focused.focus();
    return ok;
  };

  // Last resort: select the value so the user can press Ctrl+C.
  const selectForUser = (el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  };

  const copy = async (button, target) => {
    const text = textOf(target);
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    }
    if (!ok) ok = legacyCopy(text);
    if (!ok) {
      selectForUser(target);
      announce('Selected. Press Ctrl+C to copy.');
      return;
    }
    button.setAttribute('data-cb-copied', '');
    setTimeout(() => button.removeAttribute('data-cb-copied'), COPIED_MS);
    announce('Copied to clipboard');
  };

  const setRevealed = (button, target, revealed) => {
    target.type = revealed ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(revealed));
  };

  const reveal = (button, target) => {
    clearTimeout(remaskTimers.get(button));
    const revealed = button.getAttribute('aria-pressed') !== 'true';
    setRevealed(button, target, revealed);
    const seconds = Number(button.getAttribute('data-cb-reveal-timeout'));
    if (revealed && seconds > 0) {
      remaskTimers.set(button, setTimeout(() => {
        setRevealed(button, target, false);
        announce('Hidden again');
      }, seconds * 1000));
    }
  };

  const download = (button, target) => {
    const url = URL.createObjectURL(new Blob([textOf(target)], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = button.getAttribute('data-cb-filename') || 'download.txt';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // Row checkboxes of the table a select-all box points at (enabled ones only).
  const rowBoxes = (master) => {
    const table = targetOf(master, 'data-cb-select-all');
    return table ? [...table.querySelectorAll('tbody input[type="checkbox"]:not(:disabled)')] : [];
  };

  const syncSelectAll = (master) => {
    const boxes = rowBoxes(master);
    const checked = boxes.filter((box) => box.checked).length;
    master.checked = checked > 0 && checked === boxes.length;
    master.indeterminate = checked > 0 && checked < boxes.length;
  };

  // A click has already toggled the box. Changed rows fire a bubbling change
  // event, so forms, HTMX triggers and frameworks see the new selection.
  const selectAll = (master) => {
    for (const box of rowBoxes(master)) {
      if (box.checked === master.checked) continue;
      box.checked = master.checked;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    master.indeterminate = false;
  };

  const syncFromRow = (box) => {
    const table = box.closest('table[id]');
    if (!table) return;
    for (const master of document.querySelectorAll(SELECT_ALL)) {
      if (master.getAttribute('data-cb-select-all') === table.id) syncSelectAll(master);
    }
  };

  document.querySelectorAll(SELECT_ALL).forEach(syncSelectAll);

  // Meter marks: CSS cannot read low and high, so they are copied into
  // --_low / --_high as fractions of the range. A click listener cannot see
  // markup arrive, so one observer follows swapped-in meters and changed
  // attributes; hosts never call anything.
  const MARKS = 'meter[data-cb-marks]';
  const placeMarks = (meter) => {
    const span = meter.max - meter.min;
    for (const edge of ['low', 'high']) {
      if (meter.hasAttribute(edge) && span > 0) meter.style.setProperty(`--_${edge}`, String((meter[edge] - meter.min) / span));
      else meter.style.removeProperty(`--_${edge}`);
    }
  };

  document.querySelectorAll(MARKS).forEach(placeMarks);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches(MARKS)) placeMarks(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(MARKS)) placeMarks(node);
        node.querySelectorAll(MARKS).forEach(placeMarks);
      }
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['low', 'high', 'min', 'max', 'data-cb-marks'],
  });

  // Hiding the target would drop focus to <body>: move it to the next
  // focusable element outside the target, or the previous one at the end.
  const dismiss = (target) => {
    const hadFocus = target.contains(document.activeElement);
    target.hidden = true;
    if (!hadFocus) return;
    const candidates = [...document.querySelectorAll(FOCUSABLE)]
      .filter((el) => !target.contains(el) && el.getClientRects().length);
    const next = candidates.find((el) => target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      ?? candidates.findLast((el) => target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
    if (next) next.focus();
  };

  // ARIA tabs: the selected tab is the only one in the tab order, and only its
  // panel is shown. The state is written by the server; this keeps it in step.
  const tabsOf = (tab) => [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  const isEnabled = (tab) => tab.getAttribute('aria-disabled') !== 'true';

  const selectTab = (tab) => {
    for (const other of tabsOf(tab)) {
      const on = other === tab;
      other.setAttribute('aria-selected', String(on));
      other.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    }
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // Arrow keys follow the list's orientation (and reading direction); they
  // skip disabled tabs and wrap. Home and End jump to the ends.
  const tabKey = (event, tab) => {
    const list = tab.closest('[role="tablist"]');
    const enabled = tabsOf(tab).filter(isEnabled);
    const vertical = list.getAttribute('aria-orientation') === 'vertical';
    const forward = getComputedStyle(list).direction === 'rtl' ? -1 : 1;
    const steps = vertical ? { ArrowDown: 1, ArrowUp: -1 } : { ArrowRight: forward, ArrowLeft: -forward };
    let next;
    if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    else if (steps[event.key]) {
      const index = enabled.indexOf(tab);
      next = enabled[(index + steps[event.key] + enabled.length) % enabled.length];
    }
    if (!next) return;
    event.preventDefault();
    next.focus();
    selectTab(next);
  };

  // ARIA tree: one row is in the tab order. Collapsed groups are not
  // rendered, so the rendered items are the visible rows, in order.
  const treeOf = (item) => item.closest('[role="tree"]');
  const rows = (tree) => [...tree.querySelectorAll('[role="treeitem"]')].filter((item) => item.getClientRects().length);
  const rowLabel = (item) => item.querySelector(':scope > .cb-nav__link');
  const isBranch = (item) => item.hasAttribute('aria-expanded');
  const isOpen = (item) => item.getAttribute('aria-expanded') === 'true';

  const focusItem = (item) => {
    for (const other of treeOf(item).querySelectorAll('[role="treeitem"]')) other.tabIndex = other === item ? 0 : -1;
    item.focus();
    item.scrollIntoView({ block: 'nearest' });
  };

  const setExpanded = (item, open) => {
    item.setAttribute('aria-expanded', String(open));
    item.dispatchEvent(new CustomEvent('cb-toggle', { bubbles: true, detail: { expanded: open } }));
  };

  const selectItem = (item) => {
    for (const other of treeOf(item).querySelectorAll('[role="treeitem"][aria-selected="true"]')) {
      other.setAttribute('aria-selected', 'false');
    }
    item.setAttribute('aria-selected', 'true');
  };

  // Enter and Space click the row, so host click handlers run for keyboard users.
  const treeKey = (event, item) => {
    const list = rows(treeOf(item));
    const index = list.indexOf(item);
    const parent = item.parentElement.closest('[role="treeitem"]');
    let next;
    switch (event.key) {
      case 'ArrowDown': next = list[index + 1]; break;
      case 'ArrowUp': next = list[index - 1]; break;
      case 'Home': next = list[0]; break;
      case 'End': next = list.at(-1); break;
      case 'ArrowRight':
        if (isBranch(item) && !isOpen(item)) setExpanded(item, true);
        else if (isOpen(item) && item.contains(list[index + 1])) next = list[index + 1];
        break;
      case 'ArrowLeft':
        if (isOpen(item)) setExpanded(item, false);
        else next = parent;
        break;
      case 'Enter':
      case ' ':
        rowLabel(item)?.click();
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next) focusItem(next);
  };

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!(event.target instanceof Element)) return;
    const tab = event.target.closest(TAB);
    if (tab) return tabKey(event, tab);
    if (event.target.matches(TREE_ITEM)) treeKey(event, event.target);
  });

  document.addEventListener('click', (event) => {
    // A click cancelled by the host (or a cancelled box toggle) means: do nothing.
    if (event.defaultPrevented) return;

    const tab = event.target instanceof Element ? event.target.closest(TAB) : null;
    if (tab) {
      if (isEnabled(tab)) selectTab(tab);
      return;
    }

    const row = event.target instanceof Element ? event.target.closest('.cb-nav__link') : null;
    const item = row?.parentElement.matches(TREE_ITEM) ? row.parentElement : null;
    if (item) {
      focusItem(item);
      selectItem(item);
      if (isBranch(item)) setExpanded(item, !isOpen(item));
      return;
    }

    const box = event.target;
    if (box instanceof HTMLInputElement && box.type === 'checkbox') {
      if (box.matches(SELECT_ALL)) selectAll(box);
      else syncFromRow(box);
      return;
    }

    const button = event.target instanceof Element ? event.target.closest(ACTIONS) : null;
    if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;

    if (button.hasAttribute('data-cb-copy')) {
      const target = targetOf(button, 'data-cb-copy');
      if (target) copy(button, target);
    } else if (button.hasAttribute('data-cb-reveal')) {
      const target = targetOf(button, 'data-cb-reveal');
      if (target instanceof HTMLInputElement) reveal(button, target);
    } else if (button.hasAttribute('data-cb-download')) {
      const target = targetOf(button, 'data-cb-download');
      if (target) download(button, target);
    } else if (button.hasAttribute('data-cb-dismiss')) {
      const target = targetOf(button, 'data-cb-dismiss');
      if (target) dismiss(target);
    } else {
      const target = targetOf(button, 'data-cb-modal');
      if (target instanceof HTMLDialogElement && !target.open) target.showModal();
    }
  });
})();
