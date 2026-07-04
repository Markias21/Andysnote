/* ─── LOCAL REPOSITORY (browser-based file I/O) ───────────────────────────────────────────────────
   This backend never touches the real OS filesystem directly. Notes live in the
   browser (IndexedDB) as the primary store, and are moved in/out of the OS only
   through explicit user-driven .txt export/import:
     - Export : File System Access API save picker, with a download fallback.
     - Import : File System Access API open picker, with an <input type=file> fallback.
   The sidebar "notes_local" section is an app-managed list of these browser notes,
   NOT a mirror of a real folder. Drive (drive.js) remains a separate backend; the
   two coexist and `storageMode` tracks which one the currently-open document uses. */

/* ─── ID + IndexedDB helpers ─── */
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

function localDbPut(note) {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE, "readwrite");
        const req = tx.objectStore(LOCAL_STORE).put(note);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function localDbDelete(id) {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE, "readwrite");
        const req = tx.objectStore(LOCAL_STORE).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
}

/* ─── CRUD ─── */
async function initLocalNotes() {
  localNotes = await localDbGetAll();
  renderLocalNotes(currentSearchValue());
}

async function createLocalNote(parentId = null) {
  const now = new Date().toISOString();
  const note = {
    id: genLocalId(),
    type: "note",
    parentId: parentId,
    title: "Untitled",
    body: "",
    createdTime: now,
    modifiedTime: now,
  };
  await localDbPut(note);
  localNotes.push(note);
  renderLocalNotes(currentSearchValue());
  openLocalNote(note.id);
}

async function createLocalFolder(parentId = null) {
  const now = new Date().toISOString();
  const folder = {
    id: genLocalId(),
    type: "folder",
    parentId: parentId,
    title: "New Folder",
    createdTime: now,
    modifiedTime: now,
  };
  await localDbPut(folder);
  localNotes.push(folder);
  renderLocalNotes(currentSearchValue());
}

async function deleteLocalNote(id) {
  // If it's a folder, recursively delete children first
  const children = localNotes.filter((n) => n.parentId === id);
  for (const child of children) {
    await deleteLocalNote(child.id);
  }
  await localDbDelete(id);
  localNotes = localNotes.filter((n) => n.id !== id);
  if (currentFileId === id) {
    showEmptyState();
  }
  renderLocalNotes(currentSearchValue());
}

async function renameLocalNote(id, newTitle) {
  const note = localNotes.find((n) => n.id === id);
  if (!note) return;
  note.title = newTitle;
  note.modifiedTime = new Date().toISOString();
  await localDbPut(note);
  renderLocalNotes(currentSearchValue());
}

/* ─── OPEN LOCAL NOTE ─── */
async function openLocalNote(id) {
  await flushDriveSave();
  await flushLocalSave();
  storageMode = "local";
  currentFileId = id;
  driveDirty = false;
  localDirty = false;

  const note = localNotes.find((n) => n.id === id);
  if (!note) return;

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("writing-panel").classList.remove("hidden");
  renderSidebar(currentSearchValue());

  document.getElementById("doc-title").value = note.title || "Untitled";

  const parent = note.parentId
    ? localNotes.find((n) => n.id === note.parentId)
    : null;
  document.getElementById("meta-folder-name").textContent = parent
    ? parent.title
    : "notes_local";

  const created = note.createdTime ? new Date(note.createdTime) : null;
  document.getElementById("meta-date-val").textContent = created
    ? created.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  const modified = note.modifiedTime ? new Date(note.modifiedTime) : null;
  document.getElementById("meta-modified-val").textContent = modified
    ? modified.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  // Local notes are plain text only (no live Markdown rendering yet), so
  // the formatting toolbar shouldn't appear here either — same as Drive
  // .txt docs.
  editorOpen(note.body || "", { toolbar: false });
  setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));

  renderLocalNotes(currentSearchValue());
  updateWordCount();
  autoResize(document.getElementById("doc-title"));
}

/* ─── SAVE ─── */
function scheduleLocalSave() {
  if (storageMode !== "local" || !currentFileId) return;
  if (!getSetting("behavior.autoSave")) return;
  localDirty = true;
  if (localSaveTimer) clearTimeout(localSaveTimer);
  localSaveTimer = setTimeout(() => {
    saveLocalNow();
  }, 1200);
}

async function flushLocalSave() {
  if (localSaveTimer) {
    clearTimeout(localSaveTimer);
    localSaveTimer = null;
  }
  if (localDirty) await saveLocalNow();
}

async function saveLocalNow() {
  if (storageMode !== "local" || !currentFileId) return;
  const note = localNotes.find((n) => n.id === currentFileId);
  if (!note) return;

  const newTitle = document.getElementById("doc-title").value.trim() || "Untitled";
  const newBody = editorGetText();

  if (note.title === newTitle && note.body === newBody) {
    localDirty = false;
    return;
  }

  note.title = newTitle;
  note.body = newBody;
  note.modifiedTime = new Date().toISOString();

  await localDbPut(note);
  localDirty = false;
  renderLocalNotes(currentSearchValue());
  setSyncStatus("saved", "Saved \u00b7 " + formatTime(new Date()));
}

/* ─── IMPORT / EXPORT ─── */
async function exportLocalNote() {
  if (storageMode !== "local" || !currentFileId) return;
  const note = localNotes.find((n) => n.id === currentFileId);
  if (!note) return;

  const blob = new Blob([note.body || ""], { type: "text/plain" });
  const filename = (note.title || "Untitled") + ".txt";

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Text file", accept: { "text/plain": [".txt"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e.name !== "AbortError") console.error("showSaveFilePicker failed", e);
    }
  }

  // Fallback: download
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function onImportInputChange(input) {
  const file = input.files[0];
  if (!file) return;
  const text = await file.text();
  const title = file.name.replace(/\.txt$/, "") || "Imported";
  const now = new Date().toISOString();
  const note = {
    id: genLocalId(),
    type: "note",
    parentId: null,
    title,
    body: text,
    createdTime: now,
    modifiedTime: now,
  };
  await localDbPut(note);
  localNotes.push(note);
  renderLocalNotes(currentSearchValue());
  openLocalNote(note.id);
  input.value = "";
}

/* ─── LOCAL SIDEBAR RENDERING ─── */
function localSubtreeMatches(node, q) {
  if (!q) return true;
  const title = (node.title || "").toLowerCase();
  if (title.includes(q)) return true;
  if (node.type !== "folder") return false;
  return getLocalChildren(node.id).some((child) => localSubtreeMatches(child, q));
}

function renderLocalNotes(filter = "") {
  const list = document.getElementById("local-list");
  if (!list) return;

  const q = (filter || "").trim().toLowerCase();
  list.innerHTML = "";

  const roots = getLocalRootNodes();
  if (roots.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText =
      "padding:10px 8px 12px;color:var(--text-muted);font-size:12px;line-height:1.6;";
    empty.textContent = q ? "No matching local notes." : "No local notes yet.";
    list.appendChild(empty);
    return;
  }

  renderLocalNodes(roots, list, q);
}

function renderLocalNodes(nodes, container, q) {
  for (const node of nodes) {
    if (node.type === "folder") renderLocalFolderNode(node, container, q);
    else if (node.type === "note") renderLocalNoteRow(node, container, q);
  }
}

function renderLocalFolderNode(node, container, q) {
  if (!localSubtreeMatches(node, q)) return;

  const isOpen = localExpandedFolders.has(node.id) || !!q;
  const folderEl = document.createElement("div");
  folderEl.className = "folder" + (isOpen ? " open" : "");
  folderEl.dataset.id = node.id;

  folderEl.innerHTML = `
    <div class="folder-header" onclick="toggleLocalFolder('${node.id}')">
      <svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
      <svg class="folder-icon closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="folder-name">${escHtml(node.title || "New Folder")}</span>
      <span class="folder-count">${countLocalDocs(node.id)}</span>
    </div>
    <div class="folder-items"></div>
  `;

  const items = folderEl.querySelector(".folder-items");
  if (isOpen) renderLocalNodes(getLocalChildren(node.id), items, q);
  container.appendChild(folderEl);
}

function renderLocalNoteRow(node, container, q) {
  const title = node.title || "Untitled";
  if (q && !title.toLowerCase().includes(q)) return;

  const item = document.createElement("div");
  item.className =
    "doc-item" + (storageMode === "local" && node.id === currentFileId ? " active" : "");
  item.dataset.id = node.id;
  item.onclick = () => openLocalNote(node.id);
  item.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>
    <span class="doc-name">${escHtml(title)}</span>
  `;
  container.appendChild(item);
}

function toggleLocalFolder(folderId) {
  if (localExpandedFolders.has(folderId)) localExpandedFolders.delete(folderId);
  else localExpandedFolders.add(folderId);
  renderLocalNotes(currentSearchValue());
}

/* ─── SIDEBAR HELPERS (local tree rendering) ─── */
function getLocalRootNodes() {
  return localNotes.filter((n) => n.parentId === null);
}

function getLocalChildren(parentId) {
  return localNotes.filter((n) => n.parentId === parentId);
}

function countLocalDocs(parentId) {
  const children = getLocalChildren(parentId);
  let count = 0;
  for (const c of children) {
    if (c.type === "note") count++;
    if (c.type === "folder") count += countLocalDocs(c.id);
  }
  return count;
}
