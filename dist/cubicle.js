/*!
 * Cubicle v1.0.0-rc.1 — optional progressive enhancement for dist/cubicle.css.
 * MIT License. No dependencies. Load with: <script src="cubicle.js" defer></script>
 */

/*
 * Behaviour hooks are data-cb-* attributes on controls; each value is the id of
 * the target element. Delegated click, keydown, input, paste and reset listeners
 * on the document serve them, so markup inserted later (HTMX swaps, frameworks) works
 * without re-initialisation.
 *
 *   data-cb-copy="id"                          copy the target's text
 *   data-cb-reveal="id" aria-pressed="false"   toggle a password field
 *     data-cb-reveal-timeout="30"              optional: re-mask after N seconds
 *   data-cb-download="id" data-cb-filename=""  save the target's text as a file
 *   data-cb-select-all="id"                    header checkbox: (un)check every row
 *                                              checkbox of the table; it shows the
 *                                              rows' state, indeterminate when mixed,
 *                                              and follows rows swapped in or disabled
 *   data-cb-dismiss="id"                       hide the target (an alert); focus
 *                                              moves to the next focusable element
 *   data-cb-toggle="id"                        flip the key's aria-expanded (the shell's
 *                                              Menu key folds the sidebar); closing with
 *                                              focus inside the target returns it to the key
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
 *   data-cb-output (no value, on <output for>) show the current value of the control
 *                                              named in for (a range, a number)
 *   data-cb-menu (no value, on a .cb-menu      place the popover menu at its popovertarget
 *     popover with role="menu")                key; focus its first item; arrow keys, Home
 *                                              and End move, Tab closes; it closes on an
 *                                              item click, a scroll that moves its key, or
 *                                              a resize
 *   data-cb-tokens="<separators>" (on a        token field: Enter, a separator character
 *     .cb-tokens well)                         or a pasted list adds values as chips copied
 *                                              from the field's <template>; a chip's key, or
 *                                              Delete and Backspace on it, removes it;
 *                                              Backspace in an empty entry reaches the last key;
 *                                              a form reset restores the served chips
 *
 * Until this script runs, the stylesheet hides those controls (html[data-cb-js]).
 */
(() => {
  'use strict';

  // --- Configuration ---------------------------------------------------------

  const COPIED_MS = 1500;
  const ACTIONS = '[data-cb-copy], [data-cb-reveal], [data-cb-download], [data-cb-dismiss], [data-cb-modal], [data-cb-toggle]';
  const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled, [type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';
  const SELECT_ALL = 'input[type="checkbox"][data-cb-select-all]';
  const MARKS = 'meter[data-cb-marks]';
  const TAB = '[data-cb-tabs] [role="tab"]';
  const TREE_ITEM = '[data-cb-tree] [role="treeitem"]';
  const OUTPUTS = 'output[data-cb-output]';
  const MENU = '.cb-menu[data-cb-menu]';
  const TOKENS = '[data-cb-tokens]';
  const ENTRY = `${TOKENS} .cb-tokens__entry`;
  const TOKEN_KEY = `${TOKENS} .cb-chip__remove`;
  const DISABLED = ':disabled, [aria-disabled="true"]';
  // Attributes the observer follows: meter marks, and row boxes turned disabled.
  const OBSERVED_ATTRIBUTES = ['low', 'high', 'min', 'max', 'data-cb-marks', 'disabled'];
  // A menu opens below its key when this much room is left below it (or more than above).
  const MENU_ROOM_REM = 15;

  // --- State -----------------------------------------------------------------

  const remaskTimers = new WeakMap(); // reveal key -> its re-mask timer
  const servedChips = new WeakMap(); // token field -> the chips it was served with
  const menusReturningFocus = new WeakSet(); // menus that held focus when they began to close
  const menuKeyPositions = new WeakMap(); // menu -> where its key was when it opened
  let liveRegion;

  // --- Shared helpers --------------------------------------------------------

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
    requestAnimationFrame(() => {
      liveRegion.textContent = message;
    });
  };

  const targetOf = (button, attribute) => document.getElementById(button.getAttribute(attribute));
  const isTextField = (element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  const textOf = (element) => (isTextField(element) ? element.value : element.textContent);
  const elementOf = (event) => (event.target instanceof Element ? event.target : null);

  // --- Copy, reveal, download ------------------------------------------------

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
    let copied;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    buffer.remove();
    if (focused instanceof HTMLElement) {
      focused.focus();
    }
    return copied;
  };

  // Last resort: select the value so the user can press Ctrl+C.
  const selectForUser = (element) => {
    if (isTextField(element)) {
      element.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  };

  const copy = async (button, target) => {
    const text = textOf(target);
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) {
      copied = legacyCopy(text);
    }
    if (!copied) {
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
      const timer = setTimeout(() => {
        setRevealed(button, target, false);
        announce('Hidden again');
      }, seconds * 1000);
      remaskTimers.set(button, timer);
    }
  };

  const download = (button, target) => {
    const blob = new Blob([textOf(target)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = button.getAttribute('data-cb-filename') || 'download.txt';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // --- Select-all ------------------------------------------------------------

  // Row checkboxes of the table a select-all box points at (enabled ones only).
  const rowBoxes = (master) => {
    const table = targetOf(master, 'data-cb-select-all');
    if (!table) {
      return [];
    }
    return [...table.querySelectorAll('tbody input[type="checkbox"]:not(:disabled)')];
  };

  const syncSelectAll = (master) => {
    const boxes = rowBoxes(master);
    const checkedCount = boxes.filter((box) => box.checked).length;
    master.checked = checkedCount > 0 && checkedCount === boxes.length;
    master.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
  };

  const syncAllSelectAlls = () => {
    for (const master of document.querySelectorAll(SELECT_ALL)) {
      syncSelectAll(master);
    }
  };

  // A click has already toggled the box. Changed rows fire a bubbling change
  // event, so forms, HTMX triggers and frameworks see the new selection.
  const selectAll = (master) => {
    for (const box of rowBoxes(master)) {
      if (box.checked === master.checked) {
        continue;
      }
      box.checked = master.checked;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    master.indeterminate = false;
  };

  const syncFromRow = (box) => {
    const table = box.closest('table[id]');
    if (!table) {
      return;
    }
    for (const master of document.querySelectorAll(SELECT_ALL)) {
      if (master.getAttribute('data-cb-select-all') === table.id) {
        syncSelectAll(master);
      }
    }
  };

  // --- Meter marks -----------------------------------------------------------

  // CSS cannot read low and high, so they are copied into --_low / --_high as
  // fractions of the range. A click listener cannot see markup arrive, so one
  // observer (below) follows swapped-in meters and changed attributes; hosts
  // never call anything.
  const placeMarks = (meter) => {
    const span = meter.max - meter.min;
    for (const edge of ['low', 'high']) {
      if (meter.hasAttribute(edge) && span > 0) {
        const fraction = (meter[edge] - meter.min) / span;
        meter.style.setProperty(`--_${edge}`, String(fraction));
      } else {
        meter.style.removeProperty(`--_${edge}`);
      }
    }
  };

  const placeAllMarks = (root) => {
    for (const meter of root.querySelectorAll(MARKS)) {
      placeMarks(meter);
    }
  };

  // --- Toggle and dismiss ----------------------------------------------------

  // Expand or collapse what the key controls; CSS decides what that shows.
  const toggle = (key) => {
    const open = key.getAttribute('aria-expanded') !== 'true';
    key.setAttribute('aria-expanded', String(open));
    const target = targetOf(key, 'data-cb-toggle');
    if (!open && target?.contains(document.activeElement)) {
      key.focus();
    }
  };

  // Hiding the target would drop focus to <body>: move it to the next
  // focusable element outside the target, or the previous one at the end.
  const dismiss = (target) => {
    const hadFocus = target.contains(document.activeElement);
    target.hidden = true;
    if (!hadFocus) {
      return;
    }
    const candidates = [...document.querySelectorAll(FOCUSABLE)].filter((element) => {
      return !target.contains(element) && element.getClientRects().length;
    });
    const follows = (element) => target.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING;
    const precedes = (element) => target.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING;
    const next = candidates.find(follows) ?? candidates.findLast(precedes);
    if (next) {
      next.focus();
    }
  };

  // --- Tabs ------------------------------------------------------------------

  // ARIA tabs: the selected tab is the only one in the tab order, and only its
  // panel is shown. The state is written by the server; this keeps it in step.
  const tabsOf = (tab) => [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  const isEnabled = (tab) => !tab.matches(DISABLED);

  const selectTab = (tab) => {
    for (const other of tabsOf(tab)) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) {
        panel.hidden = !selected;
      }
    }
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // Arrow keys follow the list's orientation (and reading direction); they
  // skip disabled tabs and wrap. Home and End jump to the ends.
  const handleTabKey = (event, tab) => {
    const list = tab.closest('[role="tablist"]');
    const enabledTabs = tabsOf(tab).filter(isEnabled);
    const vertical = list.getAttribute('aria-orientation') === 'vertical';
    const forward = getComputedStyle(list).direction === 'rtl' ? -1 : 1;
    const steps = vertical ? { ArrowDown: 1, ArrowUp: -1 } : { ArrowRight: forward, ArrowLeft: -forward };
    let next;
    if (event.key === 'Home') {
      next = enabledTabs[0];
    } else if (event.key === 'End') {
      next = enabledTabs.at(-1);
    } else if (steps[event.key]) {
      const index = enabledTabs.indexOf(tab);
      const nextIndex = (index + steps[event.key] + enabledTabs.length) % enabledTabs.length;
      next = enabledTabs[nextIndex];
    }
    if (!next) {
      return;
    }
    event.preventDefault();
    next.focus();
    selectTab(next);
  };

  // --- Tree ------------------------------------------------------------------

  // ARIA tree: one row is in the tab order. Collapsed groups are not
  // rendered, so the rendered items are the visible rows, in order.
  const treeOf = (item) => item.closest('[role="tree"]');
  const visibleRows = (tree) => [...tree.querySelectorAll('[role="treeitem"]')].filter((item) => item.getClientRects().length);
  const rowLabel = (item) => item.querySelector(':scope > .cb-nav__link');
  const isBranch = (item) => item.hasAttribute('aria-expanded');
  const isOpen = (item) => item.getAttribute('aria-expanded') === 'true';

  const focusItem = (item) => {
    for (const other of treeOf(item).querySelectorAll('[role="treeitem"]')) {
      other.tabIndex = other === item ? 0 : -1;
    }
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
  const handleTreeKey = (event, item) => {
    const rows = visibleRows(treeOf(item));
    const index = rows.indexOf(item);
    const parent = item.parentElement.closest('[role="treeitem"]');
    let next;
    switch (event.key) {
      case 'ArrowDown':
        next = rows[index + 1];
        break;
      case 'ArrowUp':
        next = rows[index - 1];
        break;
      case 'Home':
        next = rows[0];
        break;
      case 'End':
        next = rows.at(-1);
        break;
      case 'ArrowRight':
        if (isBranch(item) && !isOpen(item)) {
          setExpanded(item, true);
        } else if (isOpen(item) && item.contains(rows[index + 1])) {
          next = rows[index + 1];
        }
        break;
      case 'ArrowLeft':
        if (isOpen(item)) {
          setExpanded(item, false);
        } else {
          next = parent;
        }
        break;
      case 'Enter':
      case ' ':
        rowLabel(item)?.click();
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next) {
      focusItem(next);
    }
  };

  // --- Menus -----------------------------------------------------------------

  // Menus (role="menu" popovers): the browser opens and closes them
  // (popovertarget, Escape, a click outside); this places a menu at its key,
  // mirrors aria-expanded and moves focus through the items.
  const keyOf = (menu) => document.querySelector(`[popovertarget="${CSS.escape(menu.id)}"]`);
  const itemsOf = (menu) => [...menu.querySelectorAll('[role="menuitem"]')].filter((item) => !item.matches(DISABLED));
  const positionOf = (box) => `${Math.round(box.left)},${Math.round(box.top)}`;
  const toPixels = (length) => `${Math.round(length)}px`;

  // A hidden popover has no size yet, so the side comes from the key alone:
  // below it when there is 15rem of room below (or more than above), else
  // above, scrolling within the free height; flush with the key's right edge
  // when the key is in the right half of the viewport, else with its left
  // edge, so the menu stays on screen.
  const placeMenu = (menu, key) => {
    const keyBox = key.getBoundingClientRect();
    menuKeyPositions.set(menu, positionOf(keyBox));
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const roomBelow = viewportHeight - keyBox.bottom;
    const opensDown = roomBelow >= Math.min(keyBox.top, MENU_ROOM_REM * rootFontSize);
    const alignsRight = keyBox.left + keyBox.width / 2 > viewportWidth / 2;
    menu.style.setProperty('--_top', opensDown ? toPixels(keyBox.bottom + 2) : 'auto');
    menu.style.setProperty('--_bottom', opensDown ? 'auto' : toPixels(viewportHeight - keyBox.top + 2));
    menu.style.setProperty('--_right', alignsRight ? toPixels(viewportWidth - keyBox.right) : 'auto');
    menu.style.setProperty('--_left', alignsRight ? 'auto' : toPixels(keyBox.left));
    menu.style.setProperty('--_max', toPixels((opensDown ? roomBelow : keyBox.top) - 10));
  };

  const closeMenu = (menu) => {
    if (!menu.matches(':popover-open')) {
      return;
    }
    keyOf(menu)?.focus();
    menu.hidePopover();
  };

  // A scroll closes a menu only when it moved its key; a scroll event can
  // arrive a frame after the wrapper was scrolled to the key and the menu
  // opened. A resize always closes it.
  const keyMoved = (menu) => {
    const keyBox = keyOf(menu)?.getBoundingClientRect();
    return !keyBox || positionOf(keyBox) !== menuKeyPositions.get(menu);
  };

  // With no argument every open menu closes; with the scrolled node, only menus
  // outside it whose key moved.
  const closeMenus = (scrolled) => {
    for (const menu of document.querySelectorAll(`${MENU}:popover-open`)) {
      if (scrolled === undefined) {
        menu.hidePopover();
        continue;
      }
      const scrolledInside = scrolled instanceof Node && menu.contains(scrolled);
      if (!scrolledInside && keyMoved(menu)) {
        menu.hidePopover();
      }
    }
  };

  // On the key, the arrows open the menu on its first or last item. In the
  // menu they move and wrap, Home and End jump, and Tab closes it first so
  // focus moves on from the key.
  const handleMenuOpenerKey = (event, menu) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    if (!menu.matches(':popover-open')) {
      menu.showPopover();
    }
    const items = itemsOf(menu);
    const first = event.key === 'ArrowUp' ? items.at(-1) : items[0];
    first?.focus();
  };

  const handleMenuItemKey = (event, menu) => {
    const items = itemsOf(menu);
    const index = items.indexOf(document.activeElement);
    let next;
    switch (event.key) {
      case 'ArrowDown':
        next = items[(index + 1) % items.length];
        break;
      case 'ArrowUp':
        next = items[(index - 1 + items.length) % items.length];
        break;
      case 'Home':
        next = items[0];
        break;
      case 'End':
        next = items.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  };

  // --- Token fields ----------------------------------------------------------

  // Each chip carries its value in a checked box, so the form sends the list
  // as it stands, and the entry shares the boxes' name. Values are added from a
  // copy of the field's <template>; the key of a chip removes it. The entry's
  // own constraints (pattern, type) decide what is valid.
  const entryOf = (field) => field.querySelector('.cb-tokens__entry');
  const keysOf = (field) => [...field.querySelectorAll('.cb-chip__remove')].filter((key) => !key.disabled);

  // The chips a field was served with, kept at its first change so a form
  // reset can put them back (a removed chip is only detached).
  const keepServed = (field) => {
    if (!servedChips.has(field)) {
      servedChips.set(field, [...field.querySelector('.cb-chips').children]);
    }
  };

  // Newlines always separate values; the attribute names more characters.
  const splitTokens = (field, text) => {
    const separators = field.getAttribute('data-cb-tokens') ?? '';
    const parts = [''];
    for (const character of text) {
      if (character === '\n' || character === '\r' || separators.includes(character)) {
        parts.push('');
      } else {
        parts[parts.length - 1] += character;
      }
    }
    return parts;
  };

  // What an add says: the values added and a value that was already listed.
  const additionMessage = (added, repeated) => {
    const messages = [];
    if (added.length === 1) {
      messages.push(`Added ${added[0]}`);
    } else if (added.length) {
      messages.push(`Added ${added.length} values`);
    }
    if (repeated) {
      messages.push(`${repeated} is already in the list`);
    }
    return messages.join('; ');
  };

  // Add the parts as chips. A part that breaks the entry's constraints or is
  // already listed stays in the entry, with the reason shown or announced.
  const addTokens = (entry, parts) => {
    const field = entry.closest(TOKENS);
    const list = field.querySelector('.cb-chips');
    const template = field.querySelector('template');
    const added = [];
    const kept = [];
    let repeated = '';
    let invalid = false;
    keepServed(field);
    const values = parts.map((part) => part.trim()).filter(Boolean);
    for (const value of values) {
      entry.value = value;
      const listedBoxes = [...list.querySelectorAll('.cb-chip > .cb-check')];
      const listed = listedBoxes.some((box) => box.value === value);
      if (listed || !entry.checkValidity()) {
        if (listed) {
          repeated ||= value;
        } else {
          invalid = true;
        }
        kept.push(value);
        continue;
      }
      const chip = template.content.firstElementChild.cloneNode(true);
      const box = chip.querySelector('.cb-check');
      box.value = value;
      box.checked = true;
      box.after(value);
      for (const labelled of chip.querySelectorAll('[aria-label]')) {
        labelled.setAttribute('aria-label', `${labelled.getAttribute('aria-label')} ${value}`);
      }
      list.append(chip);
      added.push(value);
    }
    entry.value = kept.join(' ');
    const message = additionMessage(added, repeated);
    if (message) {
      announce(message);
    }
    if (invalid) {
      entry.reportValidity();
    }
    if (added.length) {
      entry.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  // Focus moves to the next key, or to the entry after the last one.
  const removeToken = (chip) => {
    const field = chip.closest(TOKENS);
    const entry = entryOf(field);
    const keys = keysOf(field);
    const keyIndex = keys.indexOf(chip.querySelector('.cb-chip__remove'));
    const next = keys[keyIndex + 1] ?? entry;
    const value = chip.querySelector('.cb-check')?.value ?? chip.textContent.trim();
    keepServed(field);
    next?.focus();
    chip.remove();
    announce(`Removed ${value}`);
    entry?.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const handleTokenKey = (event, element) => {
    if (element.matches(TOKEN_KEY)) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeToken(element.closest('.cb-chip'));
      }
      return;
    }
    if (element.readOnly || element.disabled) {
      return;
    }
    if (event.key === 'Enter' && element.value.trim()) {
      event.preventDefault();
      addTokens(element, [element.value]);
    } else if (event.key === 'Backspace' && !element.value) {
      const lastKey = keysOf(element.closest(TOKENS)).at(-1);
      if (lastKey) {
        event.preventDefault();
        lastKey.focus();
      }
    }
  };

  // --- Event handlers --------------------------------------------------------

  // The observer keeps meter marks and select-all boxes true to the markup when
  // the server swaps rows, meters or a whole table in, or disables a row box.
  // Syncing sets properties only, so it never wakes the observer.
  const handleMutations = (records) => {
    let resync = false;
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches(MARKS)) {
          placeMarks(record.target);
        }
        if (record.attributeName === 'disabled' && record.target.closest('table')) {
          resync = true;
        }
        continue;
      }
      if (record.target.closest('table')) {
        resync = true;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }
        if (node.matches(MARKS)) {
          placeMarks(node);
        }
        placeAllMarks(node);
        const selectAllOrTable = `${SELECT_ALL}, table`;
        if (node.matches(selectAllOrTable) || node.querySelector(selectAllOrTable)) {
          resync = true;
        }
      }
    }
    if (resync) {
      syncAllSelectAlls();
    }
  };

  // Toggle events do not bubble; capture listeners on the document still
  // reach menus swapped in later.
  const handleBeforeToggle = (event) => {
    const menu = event.target;
    if (!(menu instanceof Element) || !menu.matches(MENU)) {
      return;
    }
    const key = keyOf(menu);
    if (event.newState === 'open') {
      if (key) {
        placeMenu(menu, key);
      }
    } else if (menu.contains(document.activeElement)) {
      menusReturningFocus.add(menu);
    }
    key?.setAttribute('aria-expanded', String(event.newState === 'open'));
  };

  const handleToggle = (event) => {
    const menu = event.target;
    if (!(menu instanceof Element) || !menu.matches(MENU)) {
      return;
    }
    // Opened by its key (a click, Enter or Space): start on the first item,
    // unless the arrow keys have already placed focus.
    if (event.newState === 'open') {
      if (!menu.contains(document.activeElement)) {
        itemsOf(menu)[0]?.focus();
      }
    } else if (menusReturningFocus.has(menu)) {
      // Focus left with the menu: give it back to the key, unless the user
      // has already moved it somewhere else.
      menusReturningFocus.delete(menu);
      const focusLost = document.activeElement === document.body || menu.contains(document.activeElement);
      if (focusLost) {
        keyOf(menu)?.focus();
      }
    }
  };

  // A pasted list is split into values; a single value pastes as usual.
  const handlePaste = (event) => {
    const entry = event.target;
    if (!(entry instanceof HTMLInputElement) || !entry.matches(ENTRY) || entry.readOnly || entry.disabled) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const parts = splitTokens(entry.closest(TOKENS), text);
    if (parts.length < 2) {
      return;
    }
    event.preventDefault();
    const { value, selectionStart, selectionEnd } = entry;
    parts[0] = value.slice(0, selectionStart ?? value.length) + parts[0];
    parts[parts.length - 1] += value.slice(selectionEnd ?? value.length);
    addTokens(entry, parts);
  };

  // A form reset puts the served chips back before the form resets its
  // controls, so their boxes return to their defaults with the rest; the
  // entry empties natively. A field tied to the form by form="" counts too.
  const handleReset = (event) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) {
      return;
    }
    for (const field of document.querySelectorAll(TOKENS)) {
      const chips = servedChips.get(field);
      if (!chips || entryOf(field)?.form !== event.target) {
        continue;
      }
      field.querySelector('.cb-chips').replaceChildren(...chips);
      servedChips.delete(field);
    }
  };

  const handleKeydown = (event) => {
    const element = elementOf(event);
    // Tab with any modifier: Option+Tab is Safari's keyboard navigation.
    const openMenu = event.key === 'Tab' && element ? element.closest(`${MENU}:popover-open`) : null;
    if (openMenu) {
      closeMenu(openMenu);
      return;
    }
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (!element) {
      return;
    }
    const tab = element.closest(TAB);
    if (tab) {
      handleTabKey(event, tab);
      return;
    }
    if (element.matches(TREE_ITEM)) {
      handleTreeKey(event, element);
      return;
    }
    if (element.matches(`${ENTRY}, ${TOKEN_KEY}`)) {
      handleTokenKey(event, element);
      return;
    }
    const menu = element.closest(MENU);
    if (menu) {
      handleMenuItemKey(event, menu);
      return;
    }
    const menuId = element.getAttribute('popovertarget');
    const ownedMenu = menuId ? document.getElementById(menuId) : null;
    if (ownedMenu?.matches(MENU)) {
      handleMenuOpenerKey(event, ownedMenu);
    }
  };

  // Readouts: the server renders the first value, and a form reset restores
  // the control and its output natively; this keeps them in step in between.
  const handleInput = (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement)) {
      return;
    }
    // A typed separator adds the values before it; the rest stays.
    if (control.matches(ENTRY)) {
      const parts = splitTokens(control.closest(TOKENS), control.value);
      if (parts.length > 1) {
        const rest = parts.pop();
        addTokens(control, parts);
        control.value = [control.value, rest].filter(Boolean).join(' ');
      }
    }
    if (!control.id) {
      return;
    }
    for (const output of document.querySelectorAll(OUTPUTS)) {
      if (output.htmlFor.contains(control.id)) {
        output.value = control.value;
      }
    }
  };

  const runAction = (button) => {
    if (button.hasAttribute('data-cb-copy')) {
      const target = targetOf(button, 'data-cb-copy');
      if (target) {
        copy(button, target);
      }
    } else if (button.hasAttribute('data-cb-reveal')) {
      const target = targetOf(button, 'data-cb-reveal');
      if (target instanceof HTMLInputElement) {
        reveal(button, target);
      }
    } else if (button.hasAttribute('data-cb-download')) {
      const target = targetOf(button, 'data-cb-download');
      if (target) {
        download(button, target);
      }
    } else if (button.hasAttribute('data-cb-dismiss')) {
      const target = targetOf(button, 'data-cb-dismiss');
      if (target) {
        dismiss(target);
      }
    } else if (button.hasAttribute('data-cb-toggle')) {
      toggle(button);
    } else {
      const target = targetOf(button, 'data-cb-modal');
      if (target instanceof HTMLDialogElement && !target.open) {
        target.showModal();
      }
    }
  };

  const handleClick = (event) => {
    // A click cancelled by the host (or a cancelled box toggle) means: do nothing.
    if (event.defaultPrevented) {
      return;
    }
    const element = elementOf(event);

    // A chosen item closes its menu (its own action still runs below).
    const choice = element ? element.closest(`${MENU} [role="menuitem"]`) : null;
    if (choice) {
      closeMenu(choice.closest(MENU));
    }

    // A token's key removes it; a click on the well's free space goes to the entry.
    const tokenKey = element ? element.closest(TOKEN_KEY) : null;
    if (tokenKey) {
      if (!tokenKey.matches(DISABLED)) {
        removeToken(tokenKey.closest('.cb-chip'));
      }
      return;
    }
    if (element && element.matches(`${TOKENS}, ${TOKENS} > .cb-chips`)) {
      entryOf(element.closest(TOKENS))?.focus();
      return;
    }

    const tab = element ? element.closest(TAB) : null;
    if (tab) {
      if (isEnabled(tab)) {
        selectTab(tab);
      }
      return;
    }

    const row = element ? element.closest('.cb-nav__link') : null;
    const item = row?.parentElement.matches(TREE_ITEM) ? row.parentElement : null;
    if (item) {
      focusItem(item);
      selectItem(item);
      if (isBranch(item)) {
        setExpanded(item, !isOpen(item));
      }
      return;
    }

    const box = event.target;
    if (box instanceof HTMLInputElement && box.type === 'checkbox') {
      if (box.matches(SELECT_ALL)) {
        selectAll(box);
      } else {
        syncFromRow(box);
      }
      return;
    }

    const button = element ? element.closest(ACTIONS) : null;
    if (!button || button.matches(DISABLED)) {
      return;
    }
    runAction(button);
  };

  // --- Wiring ----------------------------------------------------------------

  document.documentElement.setAttribute('data-cb-js', '');
  syncAllSelectAlls();
  placeAllMarks(document);

  const observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: OBSERVED_ATTRIBUTES,
  });

  document.addEventListener('beforetoggle', handleBeforeToggle, true);
  document.addEventListener('toggle', handleToggle, true);
  document.addEventListener('paste', handlePaste);
  document.addEventListener('reset', handleReset);
  document.addEventListener('scroll', (event) => closeMenus(event.target), true);
  addEventListener('resize', () => closeMenus());
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('input', handleInput);
  document.addEventListener('click', handleClick);
})();
