// ==UserScript==
// @name         Modular CN
// @version      1.2
// @description  Imagine if you could drag everything around.
// @author       Ari / Mochi
// @match        https://www.cybernations.net/nation_drill_display.asp?*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/mochi-mochi/modularCN/raw/main/modularCN.user.js
// @downloadURL  https://github.com/mochi-mochi/modularCN/raw/main/modularCN.user.js
// @require      https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js
// ==/UserScript==

(function () {
  'use strict';

  const SECTION_ANCHOR_NAMES = ['info', 'messages', 'gov', 'mil', 'pop', 'fin'];

  const nationId = new URL(window.location.href).searchParams.get('Nation_ID') || 'global';
  const storageKey = `cnModular.rowsInline.v2.${nationId}`;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const getTbody = (table) => (table.tBodies && table.tBodies[0]) ? table.tBodies[0] : table;
  const getRowspan = (tr) => {
    const firstTd = tr ? tr.querySelector('td') : null;
    const rs = firstTd ? parseInt(firstTd.getAttribute('rowspan') || '1', 10) : 1;
    return Number.isFinite(rs) && rs > 0 ? rs : 1;
  };

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
    const infoAnchor = $('a[name="info"]');
    if (!infoAnchor) return null;
    let table = infoAnchor.closest('table');
    while (table) {
      const containsAll = SECTION_ANCHOR_NAMES.every((name) => table.querySelector(`a[name="${name}"]`));
      if (containsAll) return table;
      table = table.parentElement ? table.parentElement.closest('table') : null;
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
    const tbody = getTbody(mainTable);
    const rows = Array.from(tbody.rows);

    $$('.cn-toolbar-inline').forEach((el) => {
      const tr = el.closest('tr');
      if (tr && tr.parentElement) tr.parentElement.removeChild(tr);
    });

    const quickLinksRow = rows.find((tr) => tr.querySelector && tr.querySelector('a[href="#info"]'));
    if (!quickLinksRow) return;

    const infoLink = quickLinksRow.querySelector('a[href="#info"]');
    const container = infoLink ? infoLink.parentElement : (quickLinksRow.cells[0] || quickLinksRow.querySelector('td'));
    if (!container || container.querySelector('.cn-inline-link-save')) return;

    const appendSeparator = () => container.appendChild(document.createTextNode(' | '));
    const appendLink = (text, className, onClick) => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = className;
      a.textContent = text;
      a.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
      container.appendChild(a);
      return a;
    };

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

    const tbody = getTbody(mainTable);

    const rows = Array.from(tbody.rows);
    const govHeaderRow = rows.find((tr) => tr.querySelector && tr.querySelector('a[name="gov"]'));
    const govHeaderIndex = govHeaderRow ? rows.indexOf(govHeaderRow) : -1;

    const originalDraggableOrder = [];

    function isTopLevelRow(trEl) {
      const headerAnchor = trEl.querySelector && trEl.querySelector('a[name]');
      if (headerAnchor && SECTION_ANCHOR_NAMES.includes(headerAnchor.name)) return false;
      const cellCount = trEl.cells ? trEl.cells.length : trEl.querySelectorAll('td').length;
      return cellCount >= 2;
    }

    let pendingContinuation = 0;
    rows.forEach((tr, idx) => {
      const key = computeRowKey(tr, idx);
      tr.dataset.rowKey = key;

      const headerAnchor = tr.querySelector && tr.querySelector('a[name]');
      const isHeader = !!(headerAnchor && SECTION_ANCHOR_NAMES.includes(headerAnchor.name));

      const isAfterGov = govHeaderIndex >= 0 ? idx > govHeaderIndex : true;
      const isContinuation = pendingContinuation > 0;
      const isTopLevel = isTopLevelRow(tr) && !isContinuation;
      if (!isHeader && isAfterGov && isTopLevel) {
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

      if (pendingContinuation > 0) {
        pendingContinuation -= 1;
      } else {
        pendingContinuation = Math.max(getRowspan(tr) - 1, 0);
      }
    });

    function isDraggable(tr) {
      return tr.classList.contains('cn-row-draggable');
    }

    function applyOrder(order) {
      const allRows = Array.from(tbody.rows);
      const groups = [];
      for (let i = 0; i < allRows.length; ) {
        const row = allRows[i];
        if (isDraggable(row)) {
          const span = getRowspan(row);
          const rowsInGroup = [row];
          let next = row.nextElementSibling;
          for (let k = 1; k < span && next; k += 1) {
            rowsInGroup.push(next);
            next = next.nextElementSibling;
          }
          groups.push({ draggable: true, key: row.dataset.rowKey, rows: rowsInGroup });
          i += span;
        } else {
          groups.push({ draggable: false, rows: [row] });
          i += 1;
        }
      }

      const keyToGroup = new Map(groups.filter((g) => g.draggable).map((g) => [g.key, g]));
      const desiredGroups = [];
      for (const key of (order || [])) {
        const g = keyToGroup.get(key);
        if (g) desiredGroups.push(g);
      }

      const rebuilt = [];
      let di = 0;
      for (const g of groups) {
        if (g.draggable) {
          rebuilt.push(desiredGroups[di++] || g);
        } else {
          rebuilt.push(g);
        }
      }

      rebuilt.flatMap((g) => g.rows).forEach((tr) => tbody.appendChild(tr));
    }

    function currentDraggableOrder() {
      return Array.from(tbody.querySelectorAll('tr.cn-row-draggable'))
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
      let carriedContinuationRows = [];

      Sortable.create(tbody, {
        animation: 150,
        handle: '.cn-row-handle',
        ghostClass: 'cn-row-placeholder',
        draggable: 'tr.cn-row-draggable',
        filter: '.cn-row-fixed',
        preventOnFilter: true,
        onMove: (evt) => {
          if (!evt.related || !evt.related.classList || !evt.related.classList.contains('cn-row-draggable')) {
            return false;
          }
          if (!govHeaderRow) return true;
          const children = Array.from(tbody.rows);
          const govIdx = children.indexOf(govHeaderRow);
          const relatedIdx = children.indexOf(evt.related);
          const candidateIdx = relatedIdx + (evt.willInsertAfter ? 1 : 0);
          return candidateIdx > govIdx;
        },
        onStart: (evt) => {
          carriedContinuationRows = [];
          const startRow = evt.item;
          const groupSize = getRowspan(startRow);
          if (groupSize <= 1) return;
          let next = startRow.nextElementSibling;
          for (let i = 1; i < groupSize && next; i += 1) {
            if (next.tagName !== 'TR') break;
            const toCarry = next;
            next = next.nextElementSibling;
            carriedContinuationRows.push(toCarry);
            toCarry.parentElement && toCarry.parentElement.removeChild(toCarry);
          }
        },
        onEnd: (evt) => {
          if (carriedContinuationRows && carriedContinuationRows.length) {
            const insertAfter = evt.item;
            let reference = insertAfter;
            carriedContinuationRows.forEach((row) => {
              reference.parentElement.insertBefore(row, reference.nextElementSibling);
              reference = row;
            });
            carriedContinuationRows = [];
          }
          saveCurrentOrder();
        },
        onSort: () => saveCurrentOrder()
      });
    }
  }

  if (!window.__CN_MODULAR_ROWS_INLINE_INIT__) {
    window.__CN_MODULAR_ROWS_INLINE_INIT__ = true;
    main();
  }
})();
