/* ─── SIDEBAR ─── */
function renderSidebar(filter = "") {
  const list = document.getElementById("folder-list");
  list.innerHTML = "";
  const q = filter.toLowerCase();

  if (!driveAccessToken) {
    list.innerHTML =
      '<div style="padding:16px 12px;font-size:12px;color:var(--text-muted);line-height:1.6;">' +
      "Sign in with Google to load your Drive workspace. Notes you create in notes_local below stay in this browser.</div>";
    return;
  }

  if (driveTree.length === 0 && andysNoteRootId) {
    list.innerHTML =
      '<div style="padding:16px 12px;font-size:12px;color:var(--text-muted);">' +
      "No folders yet. Use the \u002b button to create one.</div>";
    return;
  }

  renderNodes(driveTree, list, q, 0);
}

function renderNodes(nodes, container, q, depth) {
  for (const node of nodes) {
    if (node.mimeType === FOLDER_MIME) {
      renderFolderNode(node, container, q, depth);
    } else if (node.name.endsWith(".txt")) {
      renderFileNode(node, container, q, depth);
    }
  }
}

function renderFolderNode(node, container, q, depth) {
  const isOpen = expandedFolders.has(node.id) || !!q;

  if (q) {
    const matchingDocs = flatDocs(node).filter((d) =>
      d.name
        .replace(/\.txt$/, "")
        .toLowerCase()
        .includes(q),
    );
    if (matchingDocs.length === 0) return;
  }

  const countKnown = node.loaded || node.children.length > 0;
  const docCount = countKnown ? countDocs(node) : "";
  const icon_closed =
    '<svg class="folder-icon closed" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  const icon_open =
    '<svg class="folder-icon open" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"' +
    ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"' +
    ' fill="rgba(200,169,110,0.1)" stroke="currentColor"/></svg>';

  const folderEl = document.createElement("div");
  folderEl.className = "folder" + (isOpen ? " open" : "");
  folderEl.dataset.id = node.id;

  folderEl.innerHTML =
    '<div class="folder-header" onclick="toggleFolder(\'' +
    node.id +
    "')\">" +
    '<svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="9 18 15 12 9 6"/></svg>' +
    (isOpen ? icon_open : icon_closed) +
    '<span class="folder-name">' +
    escHtml(node.name) +
    "</span>" +
    '<span class="folder-count">' +
    docCount +
    "</span>" +
    "</div>" +
    '<div class="folder-items" id="items-' +
    node.id +
    '"></div>';

  const items = folderEl.querySelector(".folder-items");

  if (isOpen) {
    if (!node.loaded && node.children.length === 0) {
      const loadingEl = document.createElement("div");
      loadingEl.className = "doc-item loading";
      loadingEl.style.cssText =
        "opacity:.6;font-style:italic;pointer-events:none;";
      loadingEl.textContent = "Loading\u2026";
      items.appendChild(loadingEl);
    }
    renderNodes(node.children, items, q, depth + 1);
    const addBtn = document.createElement("button");
    addBtn.className = "new-doc-btn";
    addBtn.onclick = (e) => {
      e.stopPropagation();
      openModal(node.id, "doc");
    };
    addBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
      " New document";
    items.appendChild(addBtn);
  }

  container.appendChild(folderEl);
}

function renderFileNode(node, container, q, depth) {
  const title = node.name.replace(/\.txt$/, "");
  if (q && !title.toLowerCase().includes(q)) return;

  const item = document.createElement("div");
  item.className =
    "doc-item" + (node.id === currentFileId ? " active" : "");
  item.dataset.id = node.id;
  item.onclick = () => openDoc(node);
  item.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/></svg>' +
    '<span class="doc-name">' +
    escHtml(title) +
    "</span>";
  container.appendChild(item);
}

function countDocs(node) {
  let n = 0;
  for (const c of node.children) {
    if (c.mimeType === FOLDER_MIME) n += countDocs(c);
    else if (c.name.endsWith(".txt")) n++;
  }
  return n;
}

function flatDocs(node) {
  const result = [];
  for (const c of node.children) {
    if (c.mimeType === FOLDER_MIME) result.push(...flatDocs(c));
    else if (c.name.endsWith(".txt")) result.push(c);
  }
  return result;
}

function currentSearchValue() {
  const el = document.getElementById("search-input");
  return el ? el.value : "";
}

function toggleFolder(folderId) {
  const opening = !expandedFolders.has(folderId);
  if (opening) expandedFolders.add(folderId);
  else expandedFolders.delete(folderId);
  renderSidebar(currentSearchValue());
  // Lazy load: fetch this folder's contents the first time it is opened.
  if (opening) ensureFolderLoaded(folderId);
}

/* Debounced so a full sidebar rebuild (and, when needed, the one-time full-tree
   load) runs after the user pauses typing instead of on every keystroke. */
function filterDocs(val) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => applyDocFilter(val), 180);
}

function applyDocFilter(val) {
  // Search must see the whole workspace, so pull in any not-yet-loaded folders
  // (once; the result is cached). Navigation stays lazy when there is no query.
  if (val && val.trim() && driveAccessToken && !driveTreeFullyLoaded) {
    loadEntireTree();
  }
  renderSidebar(val);
  renderLocalNotes(val);
}

function findNodeById(id, nodes) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.mimeType === FOLDER_MIME) {
      const found = findNodeById(id, n.children);
      if (found) return found;
    }
  }
  return null;
}

function findParentOf(id, nodes) {
  for (const n of nodes) {
    if (n.mimeType === FOLDER_MIME) {
      if (n.children.some((c) => c.id === id)) return n;
      const found = findParentOf(id, n.children);
      if (found) return found;
    }
  }
  return null;
}
