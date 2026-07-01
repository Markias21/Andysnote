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

  const notes = localNotes
    .slice()
    .sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
  const shown = notes.filter(
    (n) => !q || (n.title || "").toLowerCase().includes(q),
  );

  if (shown.length === 0) {
    list.innerHTML =
      '<div style="padding:10px 12px;font-size:12px;color:var(--text-muted);line-height:1.6;">' +
      (localNotes.length === 0
        ? "No local notes yet. Use \u002b to create one, or import a .txt file."
        : "No matches.") +
      "</div>";
    return;
  }

  const fileIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/></svg>';
  const exportIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const delIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  for (const n of shown) {
    const item = document.createElement("div");
    item.className =
      "doc-item" +
      (n.id === currentFileId && storageMode === "local" ? " active" : "");
    item.dataset.id = n.id;
    item.onclick = () => openLocalNote(n.id);
    item.innerHTML =
      fileIcon +
      '<span class="doc-name">' +
      escHtml(n.title || "Untitled") +
      "</span>" +
      '<span class="local-actions">' +
      '<button class="local-act" title="Export as .txt" onclick="event.stopPropagation();exportLocalNote(\'' +
      n.id +
      "')\">" +
      exportIcon +
      "</button>" +
      '<button class="local-act" title="Delete note" onclick="deleteLocalNote(\'' +
      n.id +
      "',event)\">" +
      delIcon +
      "</button>" +
      "</span>";
    list.appendChild(item);
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
async function newLocalNote() {
  const now = new Date().toISOString();
  const note = {
    id: genLocalId(),
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
  renderLocalNotes();
  await openLocalNote(note.id);
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
  if (!note) return;

  storageMode = "local";
  currentFileId = id;

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("writing-panel").classList.remove("hidden");

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

  const body = document.getElementById("doc-body");
  body.innerText = note.body || "";
  if ((note.body || "").trim()) body.classList.remove("empty");
  else body.classList.add("empty");

  setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));
  updateWordCount();
  autoResize(document.getElementById("doc-title"));
  renderLocalNotes(document.getElementById("search-input").value);
  renderSidebar(document.getElementById("search-input").value);
}

function scheduleLocalSave() {
  if (storageMode !== "local" || !currentFileId) return;
  clearTimeout(localSaveTimer);
  setSyncStatus("saving", "Saving...");
  localSaveTimer = setTimeout(saveLocalNow, 1200);
}

async function flushLocalSave() {
  if (localSaveTimer) {
    clearTimeout(localSaveTimer);
    localSaveTimer = null;
  }
  if (storageMode === "local" && currentFileId) await saveLocalNow();
}

async function saveLocalNow() {
  if (storageMode !== "local" || !currentFileId) return;
  try {
    setSyncStatus("saving", "Saving...");
    const note = (await localDbGet(currentFileId)) || {
      id: currentFileId,
      createdTime: new Date().toISOString(),
    };
    note.title =
      document.getElementById("doc-title").value.trim() || "Untitled";
    note.body = document.getElementById("doc-body").innerText || "";
    note.modifiedTime = new Date().toISOString();
    await localDbPut(note);

    const i = localNotes.findIndex((n) => n.id === note.id);
    if (i >= 0) localNotes[i] = note;
    else localNotes.push(note);

    renderLocalNotes(document.getElementById("search-input").value);
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
