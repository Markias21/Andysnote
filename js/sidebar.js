/* ─── SIDEBAR ─── */
function renderSidebar(filter = "") {
  const list = document.getElementById("folder-list");
  list.innerHTML = "";
  const q = filter.toLowerCase();

  if (!driveAccessToken) {
    list.innerHTML =
      '<div style="padding:16px 12px;font-size:12px;color:var(--text-muted);line-height:1.6;">' +
      escapeHtml(t("sidebar.signInPrompt")) +
      "</div>";
    return;
  }

  if (driveTree.length === 0 && andysNoteRootId) {
    list.innerHTML =
      '<div style="padding:16px 12px;font-size:12px;color:var(--text-muted);">' +
      escapeHtml(t("sidebar.noFoldersYet")) +
      "</div>";
    return;
  }

  renderNodes(driveTree, list, q, 0);
}

function renderNodes(nodes, container, q, depth) {
  for (const node of nodes) {
    if (node.id === plannerFolderId) continue; // reserved planner folder, not a document folder
    if (node.mimeType === FOLDER_MIME) {
      renderFolderNode(node, container, q, depth);
    } else if (isDriveDocName(node.name)) {
      renderFileNode(node, container, q, depth);
    }
  }
}

function renderFolderNode(node, container, q, depth) {
  const isOpen = expandedFolders.has(node.id) || !!q;

  if (q) {
    const matchingDocs = flatDocs(node).filter((d) =>
      parseCreatedFromName(d.name).cleanTitle.toLowerCase().includes(q),
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

  const header = folderEl.querySelector(".folder-header");
  wireDragSource(header, "drive", node.id);
  wireDragTarget(header, "drive", node.id);

  const items = folderEl.querySelector(".folder-items");

  if (isOpen) {
    if (!node.loaded && node.children.length === 0) {
      const loadingEl = document.createElement("div");
      loadingEl.className = "doc-item loading";
      loadingEl.style.cssText =
        "opacity:.6;font-style:italic;pointer-events:none;";
      loadingEl.textContent = t("sidebar.loading");
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
      " " + escapeHtml(t("sidebar.newDocument"));
    items.appendChild(addBtn);
  }

  container.appendChild(folderEl);
}

function renderFileNode(node, container, q, depth) {
  const title = parseCreatedFromName(node.name).cleanTitle;
  if (q && !title.toLowerCase().includes(q)) return;

  const item = document.createElement("div");
  item.className =
    "doc-item" + (node.id === currentFileId ? " active" : "");
  item.dataset.id = node.id;
  item.onclick = () => {
    openDoc(node);
    if (isMobileViewport()) closeSidebarMobile();
  };
  wireDragSource(item, "drive", node.id);
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
    else if (isDriveDocName(c.name)) n++;
  }
  return n;
}

function flatDocs(node) {
  const result = [];
  for (const c of node.children) {
    if (c.mimeType === FOLDER_MIME) result.push(...flatDocs(c));
    else if (isDriveDocName(c.name)) result.push(c);
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

/* ─── DRAG AND DROP (folder/file move + local<->drive copy) ─────────────────
   Shared by both sidebar panels (the Drive tree here and the local tree in
   js/local.js): dragging within one panel reparents the item, dragging
   across panels copies it instead — see handleTreeDrop. Reparenting only;
   there is no sibling reorder (neither backend has an "order" field). */
function wireDragSource(el, origin, id) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify({ origin, id }));
  });
  // Safety net: dragend always fires exactly once when a drag operation
  // concludes — dropped on a valid target, dropped somewhere invalid,
  // cancelled via Escape, or released outside the window. Whatever else
  // happens, nothing should be left highlighted afterward.
  el.addEventListener("dragend", () => {
    document.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
  });
}

/* Makes `el` a valid drop target representing the folder `targetParentId`
   (or the root, when called from initSidebarDragDrop/initLocalDragDrop). */
function wireDragTarget(el, targetOrigin, targetParentId) {
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation(); // don't also light up an ancestor drop target (e.g. the root list)
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", (e) => {
    e.stopPropagation();
    el.classList.remove("drag-over");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("drag-over");
    let data;
    try {
      data = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch (err) {
      return;
    }
    if (!data) return;
    // targetParentId may be a thunk (e.g. the Drive root, whose id isn't
    // known until the tree loads) so it's resolved lazily at drop time.
    const parentId = typeof targetParentId === "function" ? targetParentId() : targetParentId;
    handleTreeDrop(data, targetOrigin, parentId);
  });
}

async function handleTreeDrop(dropData, targetOrigin, targetParentId) {
  if (dropData.origin === targetOrigin) {
    if (targetOrigin === "drive") {
      const node = findNodeById(dropData.id, driveTree);
      if (!node || isDriveDescendant(targetParentId, node.id)) return;
      await moveDriveNode(node, targetParentId);
      // Expand the destination so the moved item is actually visible —
      // otherwise a move into a collapsed folder looks like nothing happened.
      if (targetParentId !== andysNoteRootId) expandedFolders.add(targetParentId);
      renderSidebar(currentSearchValue());
    } else {
      const node = localNotes.find((n) => n.id === dropData.id);
      if (!node || isLocalDescendant(targetParentId, node.id)) return;
      if (targetParentId !== null) localExpandedFolders.add(targetParentId);
      await moveLocalNode(node.id, targetParentId);
    }
    return;
  }
  if (dropData.origin === "local") {
    const node = localNotes.find((n) => n.id === dropData.id);
    if (node) await copyLocalNodeToDrive(node, targetParentId);
  } else {
    const node = findNodeById(dropData.id, driveTree);
    if (node) await copyDriveNodeToLocal(node, targetParentId);
  }
}

/* Lets dropping on empty sidebar space (not on any folder row) move/copy an
   item to the Drive tree's top level. Wired once at startup — #folder-list
   itself persists across renderSidebar() calls, only its innerHTML changes. */
function initSidebarDragDrop() {
  const list = document.getElementById("folder-list");
  wireDragTarget(list, "drive", () => andysNoteRootId);
}

/* ─── SIDEBAR LAYOUT (resize / collapse / mobile drawer) ───────────────────
   Independent from the Settings module (js/settings.js): sidebar width and
   collapsed state are UI layout, not a user "setting", so they get their own
   localStorage key instead of living in appSettings. The mobile drawer's
   open/closed state is intentionally NOT persisted — it always starts closed,
   same as Notion's mobile app. */
const SIDEBAR_LAYOUT_KEY = "andysnote-sidebar-layout";
const SIDEBAR_MIN_W = 180;
const SIDEBAR_MAX_W = 480;
// Must match the `@media (max-width: 768px)` breakpoint in index.html.
const SIDEBAR_MOBILE_BREAKPOINT = 768;

function isMobileViewport() {
  return window.matchMedia(`(max-width: ${SIDEBAR_MOBILE_BREAKPOINT}px)`).matches;
}

/* On mobile the sidebar is an off-canvas drawer (see .sidebar.mobile-open in
   index.html), so this button is the only way to open it and must always be
   visible there — not just when the (desktop-only) .collapsed state is on. */
function updateSidebarExpandBtnVisibility(collapsed) {
  document.getElementById("sidebar-expand-btn").style.display =
    isMobileViewport() || collapsed ? "flex" : "none";
}

function loadSidebarLayout() {
  let layout = null;
  try {
    layout = JSON.parse(localStorage.getItem(SIDEBAR_LAYOUT_KEY) || "null");
  } catch (e) {
    layout = null;
  }
  const width = Math.min(
    SIDEBAR_MAX_W,
    Math.max(SIDEBAR_MIN_W, (layout && layout.width) || 240),
  );
  const collapsed = !!(layout && layout.collapsed);

  document.documentElement.style.setProperty("--sidebar-w", width + "px");
  document.getElementById("sidebar").classList.toggle("collapsed", collapsed);
  updateSidebarExpandBtnVisibility(collapsed);
}

function saveSidebarLayout(width, collapsed) {
  try {
    localStorage.setItem(
      SIDEBAR_LAYOUT_KEY,
      JSON.stringify({ width, collapsed }),
    );
  } catch (e) {
    /* ignore quota / privacy-mode errors */
  }
}

function currentSidebarWidth() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    "--sidebar-w",
  );
  return parseInt(raw, 10) || 240;
}

/* Shared by the hover arrow (inside the sidebar) and the expand button
   (outside it, shown only while collapsed) — see index.html. Branches on
   viewport because desktop "collapse" (shrink to width:0, push layout) and
   mobile "drawer" (slide off-canvas via transform, overlay layout) are
   different mechanisms driven by different classes. */
function toggleSidebarCollapse() {
  const sidebar = document.getElementById("sidebar");
  if (isMobileViewport()) {
    const opening = !sidebar.classList.contains("mobile-open");
    sidebar.classList.toggle("mobile-open", opening);
    document.getElementById("sidebar-backdrop").style.display = opening
      ? "block"
      : "none";
    return;
  }
  const collapsed = !sidebar.classList.contains("collapsed");
  sidebar.classList.toggle("collapsed", collapsed);
  updateSidebarExpandBtnVisibility(collapsed);
  saveSidebarLayout(currentSidebarWidth(), collapsed);
}

function closeSidebarMobile() {
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.getElementById("sidebar-backdrop").style.display = "none";
}

function initSidebarResizer() {
  const resizer = document.getElementById("sidebar-resizer");
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const width = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, clientX));
    document.documentElement.style.setProperty("--sidebar-w", width + "px");
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("sidebar-resizing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    saveSidebarLayout(
      currentSidebarWidth(),
      document.getElementById("sidebar").classList.contains("collapsed"),
    );
  };

  const onStart = (e) => {
    if (isMobileViewport()) return;
    dragging = true;
    document.body.classList.add("sidebar-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove);
    document.addEventListener("touchend", onEnd);
    e.preventDefault();
  };

  resizer.addEventListener("mousedown", onStart);
  resizer.addEventListener("touchstart", onStart);
}

/* Resets the mobile drawer when the viewport crosses the breakpoint (window
   resize, phone rotation) so it can't get stuck open/mid-transition. */
function initSidebarResponsive() {
  let wasMobile = isMobileViewport();
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nowMobile = isMobileViewport();
      if (nowMobile !== wasMobile) {
        closeSidebarMobile();
        updateSidebarExpandBtnVisibility(
          document.getElementById("sidebar").classList.contains("collapsed"),
        );
        wasMobile = nowMobile;
      }
    }, 150);
  });
}
