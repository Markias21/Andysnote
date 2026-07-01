/* ─── LOCAL REPOSITORY (browser-based file I/O) ─── */
/* This backend never touches the real OS filesystem directly. Notes live in the
   browser (IndexedDB) as the primary store, and are moved in/out of the OS only
   through explicit user-driven .txt export/import:
     - Export : File System Access API save picker, with a download fallback.
     - Import : File System Access API open picker, with an <input type=file> fallback.
   The sidebar "notes_local" section is an app-managed list of these browser notes,
   NOT a mirror of a real folder. Drive (drive.js) remains a separate backend; the
   two coexist and `storageMode` tracks which one the currently-open document uses. */

/* ── ID + IndexedDB helpers ── */
function genLocalId() {
  return "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function openLocalDb() {
  if (localDbPromise) return localDbPromise;
  localDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOCAL_STORE)) {
        db.createObjectStore(LOCAL_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return localDbPromise;
}

function localDbGetAll() {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE, "readonly");
        const req = tx.objectStore(LOCAL_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }),
  );
}

function localDbGet(id) {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE, "readonly");
        const req = tx.objectStore(LOCAL_STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }),
  );
}

function localDbPut(note) {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE, "readwrite");
        tx.objectStore(LOCAL_STORE).put(note);
        tx.oncomplete = () => resolve(note);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function localDbDelete(id) {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE, "readwrite");
        tx.objectStore(LOCAL_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

// Delete many ids in ONE transaction so it all succeeds or all rolls back
// (prevents orphaned descendants from a partially-failed folder delete).
function localDbDeleteMany(ids) {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE, "readwrite");
        const store = tx.objectStore(LOCAL_STORE);
        for (const id of ids) store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/* ── Load + render the notes_local list ── */
async function initLocalNotes() {
  try {
    localNotes = await localDbGetAll();
  } catch (e) {
    console.error("initLocalNotes error", e);
    localNotes = [];
  }
  renderLocalNotes();
}

function renderLocalNotes(filter = "") {
  const list = document.getElementById("local-list");
  if (!list) return;
  list.innerHTML = "";
  const q = (filter || "").toLowerCase();

  if (localNotes.length === 0) {
    list.innerHTML =
      '<div style="padding:10px 12px;font-size:12px;color:var(--text-muted);line-height:1.6;">' +
      "No local notes yet. Use \u002b to add a note, the folder button to add a folder, or import a .txt file." +
      "</div>";
    return;
  }

  renderLocalNodes(null, list, q, 0);

  if (!list.children.length) {
    list.innerHTML =
      '<div style="padding:10px 12px;font-size:12px;color:var(--text-muted);">No matches.</div>';
  }
}

function renderLocalNodes(parentId, container, q, depth) {
  for (const node of localChildrenOf(parentId)) {
    if (node.type === "folder") {
      renderLocalFolderNode(node, container, q, depth);
    } else {
      renderLocalNoteRow(node, container, q, depth);
    }
  }
}

function renderLocalFolderNode(node, container, q, depth) {
  if (q && !localSubtreeMatches(node.id, q)) return;
  const isOpen = localExpandedFolders.has(node.id) || !!q;
  const count = localNoteCount(node.id);

  const folderEl = document.createElement("div");
  folderEl.className = "folder" + (isOpen ? " open" : "");
  folderEl.dataset.id = node.id;

  folderEl.innerHTML =
    '<div class="folder-header" onclick="toggleLocalFolder(\'' +
    node.id +
    "')\">" +
    '<svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="9 18 15 12 9 6"/></svg>' +
    (isOpen ? localIcon("folderOpen") : localIcon("folderClosed")) +
    '<span class="folder-name">' +
    escHtml(node.title || "Untitled") +
    "</span>" +
    '<span class="local-actions">' +
    '<button class="local-act" title="New note in folder" onclick="event.stopPropagation();newLocalNote(\'' +
    node.id +
    "')\">" +
    localIcon("addNote") +
    "</button>" +
    '<button class="local-act" title="New subfolder" onclick="event.stopPropagation();newLocalFolder(\'' +
    node.id +
    "')\">" +
    localIcon("addFolder") +
    "</button>" +
    '<button class="local-act" title="Delete folder" onclick="event.stopPropagation();deleteLocalFolder(\'' +
    node.id +
    "')\">" +
    localIcon("delete") +
    "</button>" +
    "</span>" +
    '<span class="folder-count">' +
    count +
    "</span>" +
    "</div>" +
    '<div class="folder-items" id="local-items-' +
    node.id +
    '"></div>';

  const items = folderEl.querySelector(".folder-items");
  if (isOpen) renderLocalNodes(node.id, items, q, depth + 1);
  container.appendChild(folderEl);
}

function renderLocalNoteRow(node, container, q, depth) {
  if (q && !(node.title || "").toLowerCase().includes(q)) return;
  const item = document.createElement("div");
  item.className =
    "doc-item" +
    (node.id === currentFileId && storageMode === "local" ? " active" : "");
  item.dataset.id = node.id;
  item.onclick = () => openLocalNote(node.id);
  item.innerHTML =
    localIcon("file") +
    '<span class="doc-name">' +
    escHtml(node.title || "Untitled") +
    "</span>" +
    '<span class="local-actions">' +
    '<button class="local-act" title="Export as .txt" onclick="event.stopPropagation();exportLocalNote(\'' +
    node.id +
    "')\">" +
    localIcon("export") +
    "</button>" +
    '<button class="local-act" title="Delete note" onclick="deleteLocalNote(\'' +
    node.id +
    "',event)\">" +
    localIcon("delete") +
    "</button>" +
    "</span>";
  container.appendChild(item);
}

/* ── notes_local tree helpers ── */
function localChildrenOf(parentId) {
  const pid = parentId || null;
  const isRoot = pid === null;
  return localNotes
    .filter((n) => {
      const p = n.parentId || null;
      if (p === pid) return true;
      // Orphan recovery: a node whose parent no longer exists (or is not a
      // folder) surfaces at root so it can never become invisible/unreachable.
      if (isRoot && p !== null) {
        const parent = localNotes.find((x) => x.id === p);
        if (!parent || parent.type !== "folder") return true;
      }
      return false;
    })
    .sort((a, b) => {
      const at = a.type === "folder" ? 0 : 1;
      const bt = b.type === "folder" ? 0 : 1;
      if (at !== bt) return at - bt;
      return (a.title || "").localeCompare(b.title || "");
    });
}

function localNoteCount(parentId, seen) {
  seen = seen || new Set();
  if (parentId && seen.has(parentId)) return 0;
  if (parentId) seen.add(parentId);
  let n = 0;
  for (const c of localChildrenOf(parentId)) {
    if (c.type === "folder") n += localNoteCount(c.id, seen);
    else n++;
  }
  return n;
}

function localSubtreeMatches(parentId, q, seen) {
  seen = seen || new Set();
  if (parentId && seen.has(parentId)) return false;
  if (parentId) seen.add(parentId);
  for (const c of localChildrenOf(parentId)) {
    if (c.type === "folder") {
      if (localSubtreeMatches(c.id, q, seen)) return true;
    } else if ((c.title || "").toLowerCase().includes(q)) {
      return true;
    }
  }
  return false;
}

function collectLocalDescendants(parentId, acc, seen) {
  seen = seen || new Set();
  if (parentId && seen.has(parentId)) return acc;
  if (parentId) seen.add(parentId);
  for (const c of localChildrenOf(parentId)) {
    acc.push(c);
    if (c.type === "folder") collectLocalDescendants(c.id, acc, seen);
  }
  return acc;
}

function toggleLocalFolder(id) {
  if (localExpandedFolders.has(id)) localExpandedFolders.delete(id);
  else localExpandedFolders.add(id);
  renderLocalNotes(document.getElementById("search-input").value);
}

function localIcon(kind) {
  switch (kind) {
    case "file":
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/></svg>'
      );
    case "folderClosed":
      return (
        '<svg class="folder-icon closed" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
      );
    case "folderOpen":
      return (
        '<svg class="folder-icon open" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"' +
        ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"' +
        ' fill="rgba(200,169,110,0.1)" stroke="currentColor"/></svg>'
      );
    case "export":
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
      );
    case "delete":
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="3 6 5 6 21 6"/>' +
        '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
      );
    case "addNote":
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
      );
    case "addFolder":
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' +
        '<line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>'
      );
    default:
      return "";
  }
}

/* ── Sidebar FOLDERS "+" (Drive create) ── */
function handleSidebarAdd() {
  if (driveAccessToken) {
    openModal();
    return;
  }
  alert(
    "Sign in with Google to create Drive folders.\nTo create a note stored in this browser, use the notes_local section below (\u002b to add, or Import a .txt).",
  );
}

/* ── Create / open / save browser notes ── */
async function newLocalNote(parentId = null) {
  const now = new Date().toISOString();
  const note = {
    id: genLocalId(),
    type: "note",
    parentId: parentId || null,
    title: "Untitled",
    body: "",
    createdTime: now,
    modifiedTime: now,
  };
  try {
    await localDbPut(note);
  } catch (e) {
    console.error("newLocalNote error", e);
    setSyncStatus("error", "Create failed \u00b7 " + formatTime(new Date()));
    return;
  }
  localNotes.push(note);
  if (parentId) localExpandedFolders.add(parentId);
  renderLocalNotes();
  await openLocalNote(note.id);
}

async function newLocalFolder(parentId = null) {
  const name = (prompt("Folder name:") || "").trim();
  if (!name) return;
  const now = new Date().toISOString();
  const folder = {
    id: genLocalId(),
    type: "folder",
    parentId: parentId || null,
    title: name,
    createdTime: now,
    modifiedTime: now,
  };
  try {
    await localDbPut(folder);
  } catch (e) {
    console.error("newLocalFolder error", e);
    setSyncStatus("error", "Create failed \u00b7 " + formatTime(new Date()));
    return;
  }
  localNotes.push(folder);
  if (parentId) localExpandedFolders.add(parentId);
  localExpandedFolders.add(folder.id);
  renderLocalNotes(document.getElementById("search-input").value);
  setSyncStatus("saved", "Folder created \u00b7 " + formatTime(new Date()));
}

async function deleteLocalFolder(id) {
  const folder = localNotes.find((n) => n.id === id);
  const name = folder ? folder.title || "Untitled" : "this folder";
  const descendants = collectLocalDescendants(id, []);
  const noteCount = descendants.filter((n) => n.type !== "folder").length;
  if (
    !confirm(
      'Delete folder "' +
        name +
        '"' +
        (noteCount ? " and its " + noteCount + " note(s)" : "") +
        "? This cannot be undone.",
    )
  )
    return;
  const ids = [id, ...descendants.map((n) => n.id)];
  try {
    await localDbDeleteMany(ids);
  } catch (e) {
    console.error("deleteLocalFolder error", e);
    setSyncStatus("error", "Delete failed \u00b7 " + formatTime(new Date()));
    return;
  }
  const idset = new Set(ids);
  localNotes = localNotes.filter((n) => !idset.has(n.id));
  ids.forEach((x) => localExpandedFolders.delete(x));
  if (idset.has(currentFileId) && storageMode === "local") showEmptyState();
  renderLocalNotes(document.getElementById("search-input").value);
  setSyncStatus("saved", "Deleted \u00b7 " + formatTime(new Date()));
}

async function openLocalNote(id) {
  await flushDriveSave();
  await flushLocalSave();
  let note;
  try {
    note = await localDbGet(id);
  } catch (e) {
    console.error("openLocalNote error", e);
    return;
  }
  if (!note || note.type === "folder") return;

  storageMode = "local";
  currentFileId = id;
  // The freshly opened note starts clean; never carry a prior doc's dirty flag.
  driveDirty = false;
  localDirty = false;

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("writing-panel").classList.remove("hidden");

  // Optimistic UI: paint the sidebar active highlight straight from local
  // selection state (currentFileId + storageMode), before filling in the note's
  // content below, so selection is instant and decoupled from data loading.
  renderLocalNotes(document.getElementById("search-input").value);
  renderSidebar(document.getElementById("search-input").value);

  document.getElementById("doc-title").value = note.title || "";
  document.getElementById("meta-folder-name").textContent = "notes_local";

  const modified = note.modifiedTime ? new Date(note.modifiedTime) : null;
  document.getElementById("meta-date-val").textContent = modified
    ? modified.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "\u2014";

  // Use the shared renderer so Local notes get the same block-per-line structure
  // as Drive notes — required for per-paragraph indent to target one paragraph.
  setDocBody(note.body || "");

  setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));
  updateWordCount();
  autoResize(document.getElementById("doc-title"));
}

function scheduleLocalSave() {
  if (storageMode !== "local" || !currentFileId) return;
  localDirty = true;
  clearTimeout(localSaveTimer);
  setSyncStatus("saving", "Saving...");
  localSaveTimer = setTimeout(saveLocalNow, 1200);
}

/* Only persist when the open note is actually dirty, so switching between
   notes to read them never triggers a redundant IndexedDB write. */
async function flushLocalSave() {
  if (localSaveTimer) {
    clearTimeout(localSaveTimer);
    localSaveTimer = null;
  }
  if (storageMode === "local" && currentFileId && localDirty) await saveLocalNow();
}

async function saveLocalNow() {
  if (storageMode !== "local" || !currentFileId) return;
  try {
    setSyncStatus("saving", "Saving...");
    const note = (await localDbGet(currentFileId)) || {
      id: currentFileId,
      type: "note",
      parentId: null,
      createdTime: new Date().toISOString(),
    };
    note.type = note.type || "note";
    if (note.parentId === undefined) note.parentId = null;
    note.title =
      document.getElementById("doc-title").value.trim() || "Untitled";
    note.body = document.getElementById("doc-body").innerText || "";
    note.modifiedTime = new Date().toISOString();
    await localDbPut(note);

    const i = localNotes.findIndex((n) => n.id === note.id);
    if (i >= 0) localNotes[i] = note;
    else localNotes.push(note);

    renderLocalNotes(document.getElementById("search-input").value);
    localDirty = false;
    setSyncStatus("saved", "Saved \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("saveLocalNow error", e);
    setSyncStatus("error", "Save failed \u00b7 " + formatTime(new Date()));
  }
}

async function deleteLocalNote(id, ev) {
  if (ev) ev.stopPropagation();
  const note = localNotes.find((n) => n.id === id);
  const name = note ? note.title || "Untitled" : "this note";
  if (
    !confirm(
      'Delete "' + name + '" from notes_local? This cannot be undone.',
    )
  )
    return;
  try {
    await localDbDelete(id);
  } catch (e) {
    console.error("deleteLocalNote error", e);
    return;
  }
  localNotes = localNotes.filter((n) => n.id !== id);
  if (currentFileId === id && storageMode === "local") showEmptyState();
  renderLocalNotes(document.getElementById("search-input").value);
  setSyncStatus("saved", "Deleted \u00b7 " + formatTime(new Date()));
}

/* ── .txt EXPORT (File System Access API, download fallback) ── */
function safeFileName(name) {
  const base = (name && name.trim() ? name.trim() : "untitled").replace(
    /[\\/:*?"<>|]/g,
    "_",
  );
  return base.endsWith(".txt") ? base : base + ".txt";
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportLocalNote(id) {
  let title, text;
  if (id) {
    const note = await localDbGet(id);
    if (!note) return;
    title = note.title;
    text = note.body || "";
  } else {
    // Export the document currently open in the editor (any mode).
    if (storageMode === "local" && currentFileId) await saveLocalNow();
    title = document.getElementById("doc-title").value;
    text = document.getElementById("doc-body").innerText || "";
  }
  const filename = safeFileName(title);

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          { description: "Text file", accept: { "text/plain": [".txt"] } },
        ],
      });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      setSyncStatus("saved", "Exported \u00b7 " + formatTime(new Date()));
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // user cancelled
      // Picker blocked (e.g. inside an iframe) — fall back to a plain download.
      console.warn("showSaveFilePicker failed, using download fallback", e);
    }
  }
  downloadTextFile(filename, text);
  setSyncStatus("saved", "Downloaded \u00b7 " + formatTime(new Date()));
}

/* ── .txt IMPORT (File System Access API, upload fallback) ── */
async function importLocalNote() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          { description: "Text file", accept: { "text/plain": [".txt"] } },
        ],
        multiple: false,
      });
      const file = await handle.getFile();
      await importTextFile(file);
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // user cancelled
      console.warn("showOpenFilePicker failed, using upload fallback", e);
    }
  }
  const input = document.getElementById("local-import-input");
  if (input) {
    input.value = "";
    input.click();
  }
}

async function onImportInputChange(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (file) await importTextFile(file);
  inputEl.value = "";
}

async function importTextFile(file) {
  try {
    const text = await file.text();
    const now = new Date().toISOString();
    const note = {
      id: genLocalId(),
      type: "note",
      parentId: null,
      title: file.name.replace(/\.txt$/i, "") || "Imported",
      body: text,
      createdTime: now,
      modifiedTime: now,
    };
    await localDbPut(note);
    localNotes.push(note);
    renderLocalNotes();
    await openLocalNote(note.id);
    setSyncStatus("saved", "Imported \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("importTextFile error", e);
    setSyncStatus("error", "Import failed \u00b7 " + formatTime(new Date()));
  }
}
