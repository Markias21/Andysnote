/* ─── CONTEXT MENU ──────────────────────────────────────────────────────────
   A small right-click popup shared by both sidebar trees (Drive + local).
   This file only builds/shows/hides the popup and its inline-rename input —
   the actual create/rename/delete work stays owned by drive.js/local.js
   (same separation of concerns as js/modal.js's create flow). */

let contextMenuEl = null;

function hideContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
  document.removeEventListener("mousedown", onContextMenuOutsideClick, true);
  document.removeEventListener("keydown", onContextMenuEscape, true);
  window.removeEventListener("scroll", hideContextMenu, true);
  window.removeEventListener("resize", hideContextMenu);
}

function onContextMenuOutsideClick(e) {
  if (contextMenuEl && !contextMenuEl.contains(e.target)) hideContextMenu();
}

function onContextMenuEscape(e) {
  if (e.key === "Escape") hideContextMenu();
}

/* items: [{ label, danger, onClick }]; a falsy entry renders as a divider. */
function showContextMenu(x, y, items) {
  hideContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  for (const item of items) {
    if (!item) {
      const sep = document.createElement("div");
      sep.className = "context-menu-sep";
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "context-menu-item" + (item.danger ? " danger" : "");
    btn.textContent = item.label;
    btn.onclick = () => {
      hideContextMenu();
      item.onClick();
    };
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  contextMenuEl = menu;

  // Position at the cursor, then clamp so the popup never spills past the
  // viewport edge (it's already in the DOM at this point, so its real size
  // is known).
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(8, left) + "px";
  menu.style.top = Math.max(8, top) + "px";

  // Deferred so the contextmenu event that opened this menu doesn't
  // immediately trigger its own "click outside" listener.
  setTimeout(() => {
    document.addEventListener("mousedown", onContextMenuOutsideClick, true);
    document.addEventListener("keydown", onContextMenuEscape, true);
    window.addEventListener("scroll", hideContextMenu, true);
    window.addEventListener("resize", hideContextMenu);
  }, 0);
}

/* ─── INLINE RENAME ─────────────────────────────────────────────────────────
   Swaps a name <span> for a text input in place, the same pattern
   js/editor.js's renderCreatedDateChip uses for the created-date chip.
   `onCommit` performs the actual backend rename; every rename path already
   re-renders its sidebar on success, which replaces this DOM node wholesale —
   so only the Escape/no-change/failure paths need to restore the plain span
   here. */
function beginInlineRename(nameEl, currentValue, onCommit) {
  if (nameEl.querySelector("input")) return; // already editing

  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-rename-input";
  input.value = currentValue;
  nameEl.textContent = "";
  nameEl.appendChild(input);
  input.focus();
  input.select();

  let settled = false;
  const restore = () => {
    nameEl.textContent = currentValue;
  };

  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      settled = true;
      restore();
    }
  });

  input.addEventListener("blur", async () => {
    if (settled) return;
    settled = true;
    const val = input.value.trim();
    if (!val || val === currentValue) {
      restore();
      return;
    }
    try {
      await onCommit(val);
    } catch (e) {
      console.error("rename failed", e);
      restore();
    }
  });
}

/* ─── MENU BUILDERS ─────────────────────────────────────────────────────────
   One per (tree x target) combination. Each just assembles the item list and
   hands it to showContextMenu — no state of its own. */
function driveFolderContextMenu(e, node, nameEl) {
  e.preventDefault();
  e.stopPropagation();
  showContextMenu(e.clientX, e.clientY, [
    { label: t("sidebar.newDocument"), onClick: () => openModal(node.id, "doc") },
    { label: t("sidebar.newFolder"), onClick: () => openModal(node.id, "folder") },
    null,
    {
      label: t("sidebar.menuRename"),
      onClick: () =>
        beginInlineRename(nameEl, node.name, (val) =>
          renameDriveFolder(node, val).then(() => renderSidebar(currentSearchValue())),
        ),
    },
    {
      label: t("sidebar.menuDelete"),
      danger: true,
      onClick: () => confirmAndDeleteNode("drive", node.id),
    },
  ]);
}

function driveFileContextMenu(e, node, nameEl) {
  e.preventDefault();
  e.stopPropagation();
  showContextMenu(e.clientX, e.clientY, [
    {
      label: t("sidebar.menuRename"),
      onClick: () =>
        beginInlineRename(nameEl, parseCreatedFromName(node.name).cleanTitle, (val) =>
          renameDriveEntryName(node, { title: val }).then(() => {
            renderSidebar(currentSearchValue());
            if (currentFileId === node.id) document.getElementById("doc-title").value = val;
          }),
        ),
    },
    {
      label: t("sidebar.menuDelete"),
      danger: true,
      onClick: () => confirmAndDeleteNode("drive", node.id),
    },
  ]);
}

function driveRootContextMenu(e) {
  if (!driveAccessToken || !andysNoteRootId) return;
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, [
    { label: t("sidebar.newDocument"), onClick: () => openModal(null, "doc") },
    { label: t("sidebar.newFolder"), onClick: () => openModal(null, "folder") },
  ]);
}

function localFolderContextMenu(e, node, nameEl) {
  e.preventDefault();
  e.stopPropagation();
  showContextMenu(e.clientX, e.clientY, [
    { label: t("sidebar.newLocalNote"), onClick: () => createLocalNote(node.id) },
    { label: t("sidebar.newLocalMdNote"), onClick: () => createLocalNote(node.id, ".md") },
    { label: t("sidebar.newFolder"), onClick: () => createLocalFolder(node.id) },
    null,
    {
      label: t("sidebar.menuRename"),
      onClick: () => beginInlineRename(nameEl, node.title, (val) => renameLocalNote(node.id, val)),
    },
    {
      label: t("sidebar.menuDelete"),
      danger: true,
      onClick: () => confirmAndDeleteNode("local", node.id),
    },
  ]);
}

function localFileContextMenu(e, node, nameEl) {
  e.preventDefault();
  e.stopPropagation();
  showContextMenu(e.clientX, e.clientY, [
    {
      label: t("sidebar.menuRename"),
      onClick: () => beginInlineRename(nameEl, node.title, (val) => renameLocalNote(node.id, val)),
    },
    {
      label: t("sidebar.menuDelete"),
      danger: true,
      onClick: () => confirmAndDeleteNode("local", node.id),
    },
  ]);
}

function localRootContextMenu(e) {
  if (localFsSupported && !localFsConnected) return;
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, [
    { label: t("sidebar.newLocalNote"), onClick: () => createLocalNote(null) },
    { label: t("sidebar.newLocalMdNote"), onClick: () => createLocalNote(null, ".md") },
    { label: t("sidebar.newFolder"), onClick: () => createLocalFolder(null) },
  ]);
}
