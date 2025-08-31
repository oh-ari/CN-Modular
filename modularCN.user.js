// ==UserScript==
// @name         Modular CN
// @version      1.3d
// @description  Imagine if you could drag everything around and hide it.
// @author       Ari / Mochi
// @match        https://www.cybernations.net/nation_drill_display.asp?*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/oh-ari/modularCN/raw/main/modularCN.user.js
// @downloadURL  https://github.com/oh-ari/modularCN/raw/main/modularCN.user.js
// @require      https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js
// ==/UserScript==

(function () {
  'use strict';

  const SECTION_ANCHOR_NAMES = ['info', 'messages', 'gov', 'mil', 'pop', 'fin'];

  const nationId = new URL(window.location.href).searchParams.get('Nation_ID') || 'global';
  const storageKey = `cnModular.rowsInline.v2.${nationId}`;
  const hiddenKey = `cnModular.hiddenRows.v2.${nationId}`;
  const versionKey = `cnModular.version.${nationId}`;
  const currentVersion = '1.3d';
  
  if (localStorage.getItem(versionKey) !== currentVersion) {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(hiddenKey);
    localStorage.setItem(versionKey, currentVersion);
  }
  
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
      .cn-row-locked { background: #2d5016; color: #fff; cursor: not-allowed; }
      .cn-row-locked td { user-select: text; -webkit-user-select: text; -moz-user-select: text; -ms-user-select: text; }
      .cn-row-draggable:hover { outline:1px dashed #b5c7ff; }
      .cn-row-handle { cursor:move; color:#5c6ac4; font-weight:bold; margin-right:6px; user-select:none; display:inline-block; min-width:10px; }
      .cn-row-placeholder { outline:2px dashed #000080; background:#f5f8ff; height: 32px; }
      .cn-row-hidden { display: none; }
      .cn-row-hide-btn { cursor:pointer; color:#5c6ac4; margin-left:6px; user-select:none; float:right; }
      .cn-header-hide-btn { cursor:pointer; color:#FFFFFF; margin-left:6px; user-select:none; float:right; }
      .cn-hidden-row { border-bottom: 1px solid #000080; }
      .cn-hidden-row td { 
        padding: 8px; 
        border-bottom: 1px solid #000080; 
        border-right: 1px solid #000080; 
      }
      .cn-hidden-row td:last-child { border-right: none; }
      .cn-hidden-row:hover { background-color: #f8f9fa; }
      .cn-hidden-row:last-child td { border-bottom: none; }
      .cn-modular-panel {
        background-color: #f0f0f0;
        padding: 8px;
        border-top: 1px solid #000080;
        border-bottom: 1px solid #000080;
      }
      .cn-modular-panel td {
        padding: 8px;
      }
      .cn-modular-panel table {
        width: 100%;
      }
      .cn-modular-panel tr {
        background-color: #f0f0f0;
      }
      .cn-modular-panel a {
        color: #000080;
        text-decoration: none;
        font-weight: bold;
      }
      .cn-modular-panel a:hover {
        text-decoration: underline;
      }
      .cn-modular-close {
        color: #FFFFFF;
        text-decoration: none;
      }
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

  function addInlineButtons(mainTable, applyOriginalOrder, saveCurrentOrder, showHiddenDropdown, hiddenRows, saveHiddenRows, applyOriginalOrderFunc) {
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
    if (!container || container.querySelector('.cn-inline-link-mochi')) return;

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
    const mochiButton = appendLink('Mochi\'s Modular', 'cn-inline-link-mochi', () => toggleModularDropdown());
    
    const dropdown = document.createElement('div');
    dropdown.className = 'cn-modular-dropdown';
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      background: #FFFFFF;
      border: 1px solid #000080;
      z-index: 1000;
      display: none;
      min-width: 200px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    
    dropdown.innerHTML = `
      <div style="padding: 8px; border-bottom: 1px solid #000080;">
        <span style="color: #000080; font-weight: bold;">MM's Controls</span>
      </div>
      <div style="padding: 8px;">
        <a href="#" class="cn-dropdown-save" style="color: #000080; text-decoration: none; display: block; padding: 4px 8px; margin: 2px 0; border-radius: 3px; transition: background-color 0.2s;">Save Layout</a>
        <a href="#" class="cn-dropdown-reset" style="color: #000080; text-decoration: none; display: block; padding: 4px 8px; margin: 2px 0; border-radius: 3px; transition: background-color 0.2s;">Reset Layout</a>
        <a href="#" class="cn-dropdown-show-hidden" style="color: #000080; text-decoration: none; display: block; padding: 4px 8px; margin: 2px 0; border-radius: 3px; transition: background-color 0.2s;">Show Hidden</a>
      </div>
    `;
    
    const saveBtn = dropdown.querySelector('.cn-dropdown-save');
    const resetBtn = dropdown.querySelector('.cn-dropdown-reset');
    const showHiddenBtn = dropdown.querySelector('.cn-dropdown-show-hidden');
    
    const hideDropdown = () => {
      dropdown.style.display = 'none';
    };
    
    saveBtn.addEventListener('mouseenter', () => saveBtn.style.backgroundColor = '#E6F3FF');
    saveBtn.addEventListener('mouseleave', () => saveBtn.style.backgroundColor = 'transparent');
    resetBtn.addEventListener('mouseenter', () => resetBtn.style.backgroundColor = '#E6F3FF');
    resetBtn.addEventListener('mouseleave', () => resetBtn.style.backgroundColor = 'transparent');
    showHiddenBtn.addEventListener('mouseenter', () => showHiddenBtn.style.backgroundColor = '#E6F3FF');
    showHiddenBtn.addEventListener('mouseleave', () => showHiddenBtn.style.backgroundColor = 'transparent');
    
    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      saveCurrentOrder();
      hideDropdown();
    });
    
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem(storageKey);
      localStorage.removeItem(hiddenKey);
      
      const allRows = Array.from(tbody.rows);
      allRows.forEach(tr => {
        tr.classList.remove('cn-row-hidden');
        delete tr.dataset.hiddenBy;
      });
      
      const visibleRows = Array.from(tbody.rows);
      visibleRows.forEach(tr => {
        tr.classList.remove('cn-row-hidden');
        delete tr.dataset.hiddenBy;
      });

      hiddenRows.splice(0, hiddenRows.length);
      saveHiddenRows();
      
      document.querySelectorAll('.cn-hidden-section').forEach(section => section.remove());
      
      const showHiddenBtn = document.querySelector('.cn-dropdown-show-hidden');
      if (showHiddenBtn) {
        showHiddenBtn.textContent = 'Show Hidden';
      }
      
      applyOriginalOrder();
      saveCurrentOrder();
      hideDropdown();
    });
    
    showHiddenBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showHiddenDropdown();
      setTimeout(hideDropdown, 100);
    });
    
    const updateShowHiddenButtonText = () => {
      const existingSections = document.querySelectorAll('.cn-hidden-section');
      showHiddenBtn.textContent = existingSections.length > 0 ? 'Hide Hidden' : 'Show Hidden';
    };
    
    document.addEventListener('click', (e) => {
      if (!mochiButton.contains(e.target)) {
        dropdown.style.display = 'none';
      }
      updateShowHiddenButtonText();
    });
    
    mochiButton.style.position = 'relative';
    mochiButton.appendChild(dropdown);
    
    document.addEventListener('click', (e) => {
      if (!mochiButton.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
    
    function toggleModularDropdown() {
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
  }

  function createHiddenDropdown(hiddenRows, unhideRow) {
    if (hiddenRows.length === 0) return;

    const mainTable = findMainSectionTable();
    if (!mainTable) return;

    const tbody = getTbody(mainTable);
    const quickLinksRow = tbody.querySelector('tr:has(a[href="#info"])');
    const insertAfter = quickLinksRow || mainTable;
    const headerRow = document.createElement('tr');
    headerRow.className = 'cn-hidden-section';
    headerRow.innerHTML = `
      <td width="50%" bgcolor="#000080" colspan="3">
        <table border="0" width="100%" cellspacing="0" cellpadding="0">
          <tbody><tr>
            <td><b>
              <font color="#000080"><a name="hidden">_</a></font><font color="#FFFFFF">:. Hidden Rows</font></b>
            </td>
            <td align="right">
              <font color="#FFFFFF"><i>These are the things you hid! Woah!</i></font>
            </td>
          </tr></tbody>
        </table>
      </td>
    `;

    const contentRow = document.createElement('tr');
    contentRow.className = 'cn-hidden-section';
    const contentCell = document.createElement('td');
    contentCell.colSpan = 3;
    contentCell.style.cssText = 'background-color: #FFFFFF; padding: 0';
    
    const hiddenTable = document.createElement('table');
    Object.assign(hiddenTable, { width: '100%', cellSpacing: '0', cellPadding: '0', border: '0' });
    
    const hiddenTbody = document.createElement('tbody');

    hiddenRows.forEach((row) => {
      const rowTr = document.createElement('tr');
      rowTr.className = 'cn-hidden-row';
      
      const labelTd = document.createElement('td');
      labelTd.bgcolor = '#FFFFFF';
      labelTd.width = '40%';
      labelTd.valign = 'top';
      labelTd.innerHTML = `${row.label || 'Hidden Row'}:<span class="cn-row-hide-btn" title="Show row">👁</span>`;
      
      const contentTd = document.createElement('td');
      contentTd.bgcolor = '#FFFFFF';
      contentTd.width = '60%';
      
      const unhideBtn = document.createElement('a');
      Object.assign(unhideBtn, {
        href: '#',
        textContent: 'Show Row',
        onclick: (e) => {
          e.preventDefault();
          unhideRow(row.key);
        }
      });
      Object.assign(unhideBtn.style, {
        color: '#000080',
        textDecoration: 'none',
        fontWeight: 'bold'
      });
      
      contentTd.appendChild(unhideBtn);
      
      rowTr.appendChild(labelTd);
      rowTr.appendChild(contentTd);
      hiddenTbody.appendChild(rowTr);
    });

    hiddenTable.appendChild(hiddenTbody);
    contentCell.appendChild(hiddenTable);
    contentRow.appendChild(contentCell);

    if (quickLinksRow) {
      tbody.insertBefore(headerRow, quickLinksRow.nextSibling);
      tbody.insertBefore(contentRow, headerRow.nextSibling);
    } else {
      const parent = mainTable.parentElement;
      parent.insertBefore(headerRow, mainTable.nextSibling);
      parent.insertBefore(contentRow, headerRow.nextSibling);
    }
    
    const showHiddenBtn = document.querySelector('.cn-dropdown-show-hidden');
    if (showHiddenBtn) {
      showHiddenBtn.textContent = 'Hide Hidden';
    }
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
    const hiddenRows = [];

    function isTopLevelRow(trEl) {
      const headerAnchor = trEl.querySelector && trEl.querySelector('a[name]');
      if (headerAnchor && SECTION_ANCHOR_NAMES.includes(headerAnchor.name)) return false;
      const cellCount = trEl.cells ? trEl.cells.length : trEl.querySelectorAll('td').length;
      return cellCount >= 2;
    }

    function isLockedRow(trEl) {
      const firstTd = trEl.querySelector('td');
      if (!firstTd) return false;
      const text = firstTd.textContent.trim();
      return text.includes('Ruler:') || text.includes('Nation Name:') || text.includes('Last Tax Collection:');
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
        if (isLockedRow(tr)) {
          tr.classList.add('cn-row-locked');
        } else {
          tr.classList.add('cn-row-draggable');
          const td = tr.querySelector('td');
          if (td && !td.querySelector('.cn-row-handle')) {
            const originalText = td.textContent.trim().replace(/:+$/, '');
            tr.dataset.originalText = originalText;
            
            const handle = document.createElement('span');
            handle.className = 'cn-row-handle';
            handle.textContent = '⋮⋮';
            td.insertBefore(handle, td.firstChild);

            const hideBtn = document.createElement('span');
            hideBtn.className = 'cn-row-hide-btn';
            hideBtn.innerHTML = '👁';
            hideBtn.title = 'Hide row';
            hideBtn.onclick = () => hideRow(key, tr);
            td.appendChild(hideBtn);
          }
          originalDraggableOrder.push(key);
        }
      } else if (isHeader) {
        const headerText = tr.querySelector('td')?.textContent?.trim() || '';
        const isSpecialHeader = headerText.includes('Nation Information') || headerText.includes('Private Nation Messages');
        
        if (!isSpecialHeader) {
          tr.classList.add('cn-row-header');
          const td = tr.querySelector('td');
          if (td && !td.querySelector('.cn-header-hide-btn')) {
            const hideBtn = document.createElement('span');
            hideBtn.className = 'cn-header-hide-btn';
            hideBtn.innerHTML = '👁';
            hideBtn.title = 'Hide section';
            hideBtn.onclick = () => hideHeaderSection(key, tr);
            td.appendChild(hideBtn);
          }
        }
      } else {
        tr.classList.add('cn-row-fixed');
      }

      if (pendingContinuation > 0) {
        pendingContinuation -= 1;
      } else {
        pendingContinuation = Math.max(getRowspan(tr) - 1, 0);
      }
    });

    function hideRow(key, tr) {
      const label = tr.dataset.originalText || tr.querySelector('td')?.textContent?.trim() || 'Hidden Row';
      const rowspan = getRowspan(tr);
      
      const rowsToHide = [tr];
      if (rowspan > 1) {
        let next = tr.nextElementSibling;
        for (let i = 1; i < rowspan && next; i++) {
          if (next.tagName === 'TR') {
            rowsToHide.push(next);
            next = next.nextElementSibling;
          }
        }
      }
      
      rowsToHide.forEach(row => {
        row.classList.add('cn-row-hidden');
        if (row !== tr) {
          row.dataset.hiddenBy = key;
        }
      });
      
      hiddenRows.push({ key, label, tr, rowspan, rowsToHide });
      saveHiddenRows();
      saveCurrentOrder();
      document.querySelectorAll('.cn-hidden-section').forEach(section => section.remove());
      createHiddenDropdown(hiddenRows, unhideRow);
    }

    function unhideRow(key) {
      const hiddenRow = hiddenRows.find(r => r.key === key);
      if (hiddenRow) {
        if (hiddenRow.rowsToHide) {
          hiddenRow.rowsToHide.forEach(row => {
            row.classList.remove('cn-row-hidden');
            delete row.dataset.hiddenBy;
          });
        } else {
          hiddenRow.tr.classList.remove('cn-row-hidden');
        }
        
        hiddenRows.splice(hiddenRows.indexOf(hiddenRow), 1);
        saveHiddenRows();
        saveCurrentOrder();
        document.querySelectorAll('.cn-hidden-section').forEach(section => section.remove());
        if (hiddenRows.length > 0) {
          createHiddenDropdown(hiddenRows, unhideRow);
        } else {
          const showHiddenBtn = document.querySelector('.cn-dropdown-show-hidden');
          if (showHiddenBtn) {
            showHiddenBtn.textContent = 'Show Hidden';
          }
        }
      }
    }

    function saveHiddenRows() {
      try { localStorage.setItem(hiddenKey, JSON.stringify(hiddenRows.map(r => ({ key: r.key, label: r.label })))); } catch (_) {}
    }

    function loadHiddenRows() {
      try {
        const saved = JSON.parse(localStorage.getItem(hiddenKey) || '[]');
        saved.forEach(item => {
          const tr = tbody.querySelector(`[data-row-key="${item.key}"]`);
          if (tr) {
            const rowspan = getRowspan(tr);
            const rowsToHide = [tr];
            
            if (rowspan > 1) {
              let next = tr.nextElementSibling;
              for (let i = 1; i < rowspan && next; i++) {
                if (next.tagName === 'TR') {
                  rowsToHide.push(next);
                  next.classList.add('cn-row-hidden');
                  next.dataset.hiddenBy = item.key;
                  next = next.nextElementSibling;
                }
              }
            }
            
            tr.classList.add('cn-row-hidden');
            hiddenRows.push({ key: item.key, label: item.label, tr, rowspan, rowsToHide });
          }
        });
      } catch (_) {}
    }

    function isDraggable(tr) {
      return tr.classList.contains('cn-row-draggable') && !tr.classList.contains('cn-row-hidden');
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

      const finalRows = rebuilt.flatMap((g) => g.rows);
      finalRows.forEach((tr) => {
        if (!tr.classList.contains('cn-row-hidden')) {
          tbody.appendChild(tr);
        }
      });
      
      finalRows.forEach((tr) => {
        if (tr.classList.contains('cn-row-hidden')) {
          tbody.appendChild(tr);
        }
      });
    }

    function currentDraggableOrder() {
      return Array.from(tbody.querySelectorAll('tr.cn-row-draggable:not(.cn-row-hidden)'))
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

    loadHiddenRows();

    if (saved && Array.isArray(saved)) {
      applyOrder(saved);
    } else {
      saveCurrentOrder();
    }

    addInlineButtons(mainTable, applyOriginalOrder, saveCurrentOrder, () => {
      if (hiddenRows.length === 0) {
        alert('No hidden rows to show');
        return;
      }
      const existingSections = document.querySelectorAll('.cn-hidden-section');
      if (existingSections.length > 0) {
        existingSections.forEach(section => section.remove());
        const showHiddenBtn = document.querySelector('.cn-dropdown-show-hidden');
        if (showHiddenBtn) {
          showHiddenBtn.textContent = 'Show Hidden';
        }
      } else {
        createHiddenDropdown(hiddenRows, unhideRow);
      }
    }, hiddenRows, saveHiddenRows, applyOriginalOrder);

    function hideHeaderSection(key, headerTr) {
      const headerCell = headerTr.querySelector('td');
      let headerLabel = 'Header';
      
      if (headerCell) {
        const fontElement = headerCell.querySelector('font[color="#FFFFFF"]');
        if (fontElement) {
          headerLabel = fontElement.textContent.trim().replace(/^:\.\s*/, '').replace(/\s+/g, ' ').trim();
        } else {
          headerLabel = headerCell.textContent.trim().replace(/^:\.\s*/, '').replace(/\s+/g, ' ').trim();
        }
      }
      
      hiddenRows.push({ key, label: headerLabel, tr: headerTr, isHeader: true });
      headerTr.classList.add('cn-row-hidden');
      
      saveHiddenRows();
      saveCurrentOrder();
      document.querySelectorAll('.cn-hidden-section').forEach(section => section.remove());
      createHiddenDropdown(hiddenRows, unhideRow);
    }

    if (typeof Sortable !== 'undefined') {
      let carriedContinuationRows = [];

      Sortable.create(tbody, {
        animation: 150,
        handle: '.cn-row-handle',
        ghostClass: 'cn-row-placeholder',
        draggable: 'tr.cn-row-draggable:not(.cn-row-hidden)',
        filter: '.cn-row-fixed, .cn-row-hidden, .cn-row-locked',
        preventOnFilter: false,
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