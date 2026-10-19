/*!
 * Cubicle — optional progressive enhancement for dist/cubicle.css.
 * MIT License. No dependencies. Load with: <script src="cubicle.js" defer></script>
 */

/*
 * Behaviour hooks are data-cb-* attributes on controls; each value is the id of
 * the target element. One delegated click listener serves them, so markup
 * inserted later (HTMX swaps, frameworks) works without re-initialisation.
 *
 *   data-cb-copy="id"                          copy the target's text
 *   data-cb-reveal="id" aria-pressed="false"   toggle a password field
 *     data-cb-reveal-timeout="30"              optional: re-mask after N seconds
 *   data-cb-download="id" data-cb-filename=""  save the target's text as a file
 *   data-cb-select-all="id"                    header checkbox: (un)check every row
 *                                              checkbox of the table; it shows the
 *                                              rows' state, indeterminate when mixed
 *
 * Until this script runs, the stylesheet hides those controls (html[data-cb-js]).
 */
(() => {
  'use strict';

  const COPIED_MS = 1500;
  const ACTIONS = '[data-cb-copy], [data-cb-reveal], [data-cb-download]';
  const SELECT_ALL = 'input[type="checkbox"][data-cb-select-all]';
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

  document.addEventListener('click', (event) => {
    const box = event.target;
    if (box instanceof HTMLInputElement && box.type === 'checkbox') {
      // A cancelled click puts the box back, so there is nothing to follow.
      if (event.defaultPrevented) return;
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
    } else {
      const target = targetOf(button, 'data-cb-download');
      if (target) download(button, target);
    }
  });
})();
