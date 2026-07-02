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
  renderSidebar(currentSearchValue());
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
  renderSidebar(currentSearchValue());
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
  renderSidebar(currentSearchValue());
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
    renderSidebar(currentSearchValue());
  } else {
    renderSidebar(currentSearchValue());
  }
}

async function renameLocalNote(id, newTitle) {
  const note = localNotes.find((n) => n.id === id);
  if (!note) return;
  note.title = newTitle;
  note.modifiedTime = new Date().toISOString();
  await localDbPut(note);
  renderSidebar(currentSearchValue());
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

  const modified = note.modifiedTime ? new Date(note.modifiedTime) : null;
  document.getElementById("meta-date-val").textContent = modified
    ? modified.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  editorOpen(note.body || "");
  setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));

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
  renderSidebar(currentSearchValue());
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
  renderSidebar(currentSearchValue());
  openLocalNote(note.id);
  input.value = "";
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
