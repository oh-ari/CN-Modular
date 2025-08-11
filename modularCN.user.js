// ==UserScript==
// @name         Modular CN
// @version      1.0 (technically beta)
// @description  Imagine if you could drag everything around.
// @author       Ari / Mochi
// @match        https://www.cybernations.net/nation_drill_display.asp?*
// @grant        none
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js
// ==/UserScript==

(function () {
  'use strict';

  const SECTION_ANCHOR_NAMES = ['info', 'messages', 'gov', 'mil', 'pop', 'fin'];

  const nationId = new URL(window.location.href).searchParams.get('Nation_ID') || 'global';
  const storageKey = `cnModular.rowsInline.v2.${nationId}`;

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'cn-modular-rows-styles';
    style.textContent = `
      .cn-row-fixed { background: #000080; color: #fff; }
      .cn-row-draggable:hover { outline:1px dashed #b5c7ff; }
      .cn-row-handle { cursor:move; color:#5c6ac4; font-weight:bold; margin-right:6px; user-select:none; display:inline-block; min-width:10px; }
      .cn-row-placeholder { outline:2px dashed #000080; background:#f5f8ff; height: 32px; }
    `;
    document.head.appendChild(style);
  }

  function findMainSectionTable() {
    const infoAnchor = document.querySelector('a[name="info"]');
    if (!infoAnchor) return null;
    let table = infoAnchor.closest('table');
    while (table) {
      const containsAll = SECTION_ANCHOR_NAMES.every((name) => table.querySelector(`a[name="${name}"]`));
      if (containsAll) return table;
      const parent = table.parentElement;
      table = parent ? parent.closest('table') : null;
    }
    return null;
  }

  function normalize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[\u0000-\u001F]/g, '')
      .trim();
  }

  function slugify(text, fallback) {
    const base = normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (base && base.length > 1 ? base.slice(0, 64) : fallback);
  }

  function computeRowKey(tr, index) {
    const headerAnchor = tr.querySelector && tr.querySelector('a[name]');
    if (headerAnchor && SECTION_ANCHOR_NAMES.includes(headerAnchor.name)) {
      return `header-${headerAnchor.name}`;
    }
    let labelText = '';
    const firstTd = tr.querySelector('td');
    if (firstTd) {
      labelText = firstTd.innerText || firstTd.textContent || '';
    } else {
      labelText = tr.innerText || tr.textContent || '';
    }
    const slug = slugify(labelText, `row-${index}`);
    return `row-${slug}-${index}`;
  }

  function addInlineButtons(mainTable, applyOriginalOrder, saveCurrentOrder) {
    const tbody = (mainTable.tBodies && mainTable.tBodies[0]) ? mainTable.tBodies[0] : mainTable;
    const rows = Array.from(tbody.rows);

    // Remove any legacy toolbar rows from prior versions
    Array.from(document.querySelectorAll('.cn-toolbar-inline')).forEach((el) => {
      const tr = el.closest('tr');
      if (tr && tr.parentElement) tr.parentElement.removeChild(tr);
    });

    const quickLinksRow = rows.find((tr) => tr.querySelector && tr.querySelector('a[href="#info"]'));
    if (!quickLinksRow) return; // fail silently

    const infoLink = quickLinksRow.querySelector('a[href="#info"]');
    const container = infoLink ? infoLink.parentElement : (quickLinksRow.cells[0] || quickLinksRow.querySelector('td'));
    if (!container) return;

    // Guard to avoid duplicates
    if (container.querySelector('.cn-inline-link-save')) return;

    function appendSeparator() {
      container.appendChild(document.createTextNode(' | '));
    }

    function appendLink(text, className, onClick) {
      const a = document.createElement('a');
      a.href = '#';
      a.className = className;
      a.textContent = text;
      a.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
      container.appendChild(a);
      return a;
    }

    appendSeparator();
    appendLink('Save Layout', 'cn-inline-link-save', () => saveCurrentOrder());
    appendSeparator();
    appendLink('Reset Layout', 'cn-inline-link-reset', () => {
      localStorage.removeItem(storageKey);
      applyOriginalOrder();
      saveCurrentOrder();
    });
  }

  function main() {
    injectStyles();

    const mainTable = findMainSectionTable();
    if (!mainTable) return;

    const tbody = (mainTable.tBodies && mainTable.tBodies[0]) ? mainTable.tBodies[0] : mainTable;

    const rows = Array.from(tbody.children).filter((el) => el && el.tagName === 'TR');

    // Find the Government header row index
    const govHeaderRow = rows.find((tr) => {
      const a = tr.querySelector && tr.querySelector('a[name]');
      return a && a.name === 'gov';
    });
    const govHeaderIndex = govHeaderRow ? rows.indexOf(govHeaderRow) : -1;

    const originalDraggableOrder = [];

    rows.forEach((tr, idx) => {
      const key = computeRowKey(tr, idx);
      tr.dataset.rowKey = key;

      const headerAnchor = tr.querySelector && tr.querySelector('a[name]');
      const isHeader = !!(headerAnchor && SECTION_ANCHOR_NAMES.includes(headerAnchor.name));

      const isAfterGov = govHeaderIndex >= 0 ? idx > govHeaderIndex : true;
      if (!isHeader && isAfterGov) {
        tr.classList.add('cn-row-draggable');
        const td = tr.querySelector('td');
        if (td && !td.querySelector('.cn-row-handle')) {
          const handle = document.createElement('span');
          handle.className = 'cn-row-handle';
          handle.textContent = '⋮⋮';
          td.insertBefore(handle, td.firstChild);
        }
        originalDraggableOrder.push(key);
      } else {
        tr.classList.add('cn-row-fixed');
      }
    });

    function isDraggable(tr) {
      return tr.classList.contains('cn-row-draggable');
    }

    function applyOrder(order) {
      const originalRows = Array.from(tbody.children).filter((el) => el.tagName === 'TR');
      const currentDraggables = originalRows.filter(isDraggable);
      const map = new Map(currentDraggables.map((tr) => [tr.dataset.rowKey, tr]));

      const ordered = [];
      for (const key of order || []) {
        const tr = map.get(key);
        if (tr) {
          ordered.push(tr);
          map.delete(key);
        }
      }
      for (const tr of map.values()) ordered.push(tr);

      const newRows = [];
      let di = 0;
      for (const tr of originalRows) {
        if (isDraggable(tr)) {
          newRows.push(ordered[di++] || tr);
        } else {
          newRows.push(tr);
        }
      }
      newRows.forEach((tr) => tbody.appendChild(tr));
    }

    function currentDraggableOrder() {
      return Array.from(tbody.children)
        .filter((el) => el.tagName === 'TR' && isDraggable(el))
        .map((tr) => tr.dataset.rowKey)
        .filter(Boolean);
    }

    function saveCurrentOrder() {
      const order = currentDraggableOrder();
      try { localStorage.setItem(storageKey, JSON.stringify(order)); } catch (_) {}
    }

    function applyOriginalOrder() {
      applyOrder(originalDraggableOrder);
    }

    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) { return null; }
    })();

    if (saved && Array.isArray(saved)) {
      applyOrder(saved);
    } else {
      saveCurrentOrder();
    }

    addInlineButtons(mainTable, applyOriginalOrder, saveCurrentOrder);

    if (typeof Sortable !== 'undefined') {
      Sortable.create(tbody, {
        animation: 150,
        handle: '.cn-row-handle',
        ghostClass: 'cn-row-placeholder',
        draggable: 'tr.cn-row-draggable',
        filter: '.cn-row-fixed',
        preventOnFilter: true,
        onMove: (evt) => {
          // Prevent dropping before the Government header row
          if (!govHeaderRow) return true;
          const children = Array.from(tbody.children).filter((el) => el.tagName === 'TR');
          const govIdx = children.indexOf(govHeaderRow);
          const relatedIdx = children.indexOf(evt.related);
          const candidateIdx = relatedIdx + (evt.willInsertAfter ? 1 : 0);
          return candidateIdx > govIdx; // must be strictly after gov header
        },
        onEnd: () => saveCurrentOrder(),
        onSort: () => saveCurrentOrder()
      });
    }
  }

  if (!window.__CN_MODULAR_ROWS_INLINE_INIT__) {
    window.__CN_MODULAR_ROWS_INLINE_INIT__ = true;
    main();
  }
})();
