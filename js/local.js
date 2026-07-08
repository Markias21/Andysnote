/* ─── LOCAL REPOSITORY ─────────────────────────────────────────────────────
   Two implementations share one public API (createLocalNote, createLocalFolder,
   deleteLocalNote, renameLocalNote, openLocalNote, scheduleLocalSave,
   flushLocalSave, saveLocalNow, exportLocalNote, onImportInputChange,
   renderLocalNotes, toggleLocalFolder, getLocalRootNodes, getLocalChildren,
   countLocalDocs) so no other file needs to know or care which one is active:

   - Real filesystem (localFsSupported && localFsConnected): notes_local is a
     real "AndysNote" folder on disk, picked via the File System Access API
     (connectLocalFolder/reconnectLocalFolder). Real .txt/.md files and real
     subfolders, read/written directly — this is now the primary backend.
   - IndexedDB fallback (browsers without File System Access support, e.g.
     Firefox/Safari): the original implementation, kept verbatim as the
     `*Idb` functions below. Notes never touch the real OS filesystem here;
     `localNotes` is loaded from/persisted to IndexedDB directly.

   `localNotes` stays a FLAT parentId-linked array in BOTH cases (not a
   nested tree like Drive) — js/calendar.js iterates it directly, and doing
   it this way means calendar.js, sidebar.js, editor.js, auth.js, drive.js
   and modal.js need zero changes for this backend swap. Real-FS nodes carry
   two extra internal fields IndexedDB nodes don't need: `handle` (the live
   FileSystemFileHandle/FileSystemDirectoryHandle) and `name`/`ext` (the
   actual on-disk filename, since it encodes the created date — see below).

   Created-date filename encoding: neither the File System Access API nor
   the Drive API expose a real, user-editable "created on" date, so both
   backends encode it in the saved name itself ("제목_20260707.txt" — see
   js/config.js: formatCreatedSuffix/parseCreatedFromName/buildStoredName).
   Real-FS notes always go through this; IndexedDB-fallback notes don't
   need it (they were never real files to begin with, so `createdTime` is
   just stored as a plain field like before). */

/* ─── ID + IndexedDB helpers (also the fallback backend's storage) ─── */
function genLocalId() {
  return "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function openLocalDb() {
  if (localDbPromise) return localDbPromise;
  localDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOCAL_STORE)) {
        db.createObjectStore(LOCAL_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(LOCAL_HANDLES_STORE)) {
        db.createObjectStore(LOCAL_HANDLES_STORE, { keyPath: "key" });
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

/* Small key-value helpers for the handles store (root directory handle +
   the one-time migration marker). */
function localHandleGet(key) {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_HANDLES_STORE, "readonly");
        const req = tx.objectStore(LOCAL_HANDLES_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }),
  ).catch(() => null);
}

function localHandlePut(key, value) {
  return openLocalDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_HANDLES_STORE, "readwrite");
        const req = tx.objectStore(LOCAL_HANDLES_STORE).put({ key, ...value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  ).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════════════
   PUBLIC API — branches to real-FS or IndexedDB-fallback internals.
   ═══════════════════════════════════════════════════════════════════════ */

async function initLocalNotes() {
  if (localFsSupported) {
    const saved = await localHandleGet("root");
    if (saved && saved.handle) {
      localRootHandle = saved.handle;
      const perm = await localRootHandle.queryPermission({ mode: "readwrite" }).catch(() => "denied");
      if (perm === "granted") {
        await connectToRootHandle(localRootHandle, /*isNewConnection*/ false);
        return;
      }
      // Permission needs a user gesture to re-grant — show a reconnect prompt.
      localFsConnected = false;
      renderLocalNotes(currentSearchValue());
      return;
    }
    // No stored handle yet — show the "connect a folder" prompt.
    localFsConnected = false;
    renderLocalNotes(currentSearchValue());
    return;
  }
  await initLocalNotesIdb();
}

async function initLocalNotesIdb() {
  localNotes = await localDbGetAll();
  renderLocalNotes(currentSearchValue());
}

async function createLocalNote(parentId = null, ext = ".txt") {
  if (localFsSupported && localFsConnected) return createLocalNoteFs(parentId, ext);
  return createLocalNoteIdb(parentId);
}

async function createLocalNoteIdb(parentId = null) {
  const now = new Date().toISOString();
  const note = {
    id: genLocalId(),
    type: "note",
    parentId: parentId,
    title: t("editor.titlePlaceholder"),
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
  if (localFsSupported && localFsConnected) return createLocalFolderFs(parentId);
  return createLocalFolderIdb(parentId);
}

async function createLocalFolderIdb(parentId = null) {
  const now = new Date().toISOString();
  const folder = {
    id: genLocalId(),
    type: "folder",
    parentId: parentId,
    title: t("local.newFolderDefaultName"),
    createdTime: now,
    modifiedTime: now,
  };
  await localDbPut(folder);
  localNotes.push(folder);
  renderLocalNotes(currentSearchValue());
}

async function deleteLocalNote(id) {
  if (localFsSupported && localFsConnected) return deleteLocalNoteFs(id);
  return deleteLocalNoteIdb(id);
}

async function deleteLocalNoteIdb(id) {
  // If it's a folder, recursively delete children first
  const children = localNotes.filter((n) => n.parentId === id);
  for (const child of children) {
    await deleteLocalNoteIdb(child.id);
  }
  await localDbDelete(id);
  localNotes = localNotes.filter((n) => n.id !== id);
  if (currentFileId === id) {
    showEmptyState();
  }
  renderLocalNotes(currentSearchValue());
}

async function renameLocalNote(id, newTitle, newCreatedDate) {
  if (localFsSupported && localFsConnected) return renameLocalNoteFs(id, newTitle, newCreatedDate);
  return renameLocalNoteIdb(id, newTitle);
}

async function renameLocalNoteIdb(id, newTitle) {
  const note = localNotes.find((n) => n.id === id);
  if (!note) return;
  note.title = newTitle;
  note.modifiedTime = new Date().toISOString();
  await localDbPut(note);
  renderLocalNotes(currentSearchValue());
}

/* Drag-and-drop move within the local tree (reparent only, no sibling
   reordering — see js/sidebar.js's isLocalDescendant for cycle checks). */
async function moveLocalNode(id, newParentId) {
  if (localFsSupported && localFsConnected) return moveLocalNodeFs(id, newParentId);
  return moveLocalNodeIdb(id, newParentId);
}

async function moveLocalNodeIdb(id, newParentId) {
  const node = localNotes.find((n) => n.id === id);
  if (!node || node.parentId === newParentId) return;
  node.parentId = newParentId;
  node.modifiedTime = new Date().toISOString();
  await localDbPut(node);
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

  document.getElementById("doc-title").value = note.title || t("editor.titlePlaceholder");

  const parent = note.parentId
    ? localNotes.find((n) => n.id === note.parentId)
    : null;
  document.getElementById("meta-folder-name").textContent = parent
    ? parent.title
    : "notes_local";

  const created = note.createdTime ? new Date(note.createdTime) : null;
  renderCreatedDateChip(created, async (newDate) => {
    await renameLocalNote(note.id, note.title, newDate);
  });

  const modified = note.modifiedTime ? new Date(note.modifiedTime) : null;
  document.getElementById("meta-modified-val").textContent = modified
    ? modified.toLocaleDateString(localeTag(), {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  // .md local notes now get the same live Markdown editor as Drive .md docs
  // (file-extension based, matching js/editor.js's openDoc) — only .txt
  // stays plain. IndexedDB-fallback notes have no `ext` field, so this is
  // always false for them (they predate .md support and stay plain-text).
  const richMarkdown = note.ext === ".md";
  let body = note.body;
  if (body === undefined && note.handle) {
    // Real-FS bodies are loaded lazily — only read the file when opened.
    body = await note.handle.getFile().then((f) => f.text()).catch(() => "");
    note.body = body;
  }
  editorOpen(body || "", { rich: richMarkdown, toolbar: richMarkdown });
  setSyncStatus("saved", t("sync.opened") + " · " + formatTime(new Date()));

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
  if (localFsSupported && localFsConnected) return saveLocalNowFs();
  return saveLocalNowIdb();
}

async function saveLocalNowIdb() {
  const note = localNotes.find((n) => n.id === currentFileId);
  if (!note) return;

  const newTitle = document.getElementById("doc-title").value.trim() || t("editor.titlePlaceholder");
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
  setSyncStatus("saved", t("sync.saved") + " · " + formatTime(new Date()));
}

/* ─── IMPORT / EXPORT ─── */
async function exportLocalNote() {
  if (storageMode !== "local" || !currentFileId) return;
  const note = localNotes.find((n) => n.id === currentFileId);
  if (!note) return;

  const blob = new Blob([note.body || ""], { type: "text/plain" });
  const filename = (note.title || t("editor.titlePlaceholder")) + ".txt";

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: t("local.textFileDescription"), accept: { "text/plain": [".txt"] } }],
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
  const title = file.name.replace(/\.txt$/, "") || t("local.importedTitle");
  const now = new Date().toISOString();

  if (localFsSupported && localFsConnected) {
    await createLocalNoteFs(null, ".txt", title, text);
    input.value = "";
    return;
  }

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

  if (localFsSupported && !localFsConnected) {
    list.innerHTML = "";
    renderLocalConnectPrompt(list);
    return;
  }

  const q = (filter || "").trim().toLowerCase();
  list.innerHTML = "";

  if (!localFsSupported) {
    const notice = document.createElement("div");
    notice.style.cssText =
      "padding:8px 8px 4px;color:var(--text-muted);font-size:11px;line-height:1.5;";
    notice.textContent = t("local.fallbackNotice");
    list.appendChild(notice);
  }

  const roots = getLocalRootNodes();
  if (roots.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText =
      "padding:10px 8px 12px;color:var(--text-muted);font-size:12px;line-height:1.6;";
    empty.textContent = q ? t("sidebar.noMatchingLocalNotes") : t("sidebar.noLocalNotesYet");
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
      <span class="folder-name">${escHtml(node.title || t("local.newFolderDefaultName"))}</span>
      <span class="folder-count">${countLocalDocs(node.id)}</span>
    </div>
    <div class="folder-items"></div>
  `;

  const header = folderEl.querySelector(".folder-header");
  wireDragSource(header, "local", node.id);
  wireDragTarget(header, "local", node.id);

  const items = folderEl.querySelector(".folder-items");
  if (isOpen) renderLocalNodes(getLocalChildren(node.id), items, q);
  container.appendChild(folderEl);
}

function renderLocalNoteRow(node, container, q) {
  const title = node.title || t("editor.titlePlaceholder");
  if (q && !title.toLowerCase().includes(q)) return;

  const item = document.createElement("div");
  item.className =
    "doc-item" + (storageMode === "local" && node.id === currentFileId ? " active" : "");
  item.dataset.id = node.id;
  item.onclick = () => {
    openLocalNote(node.id);
    if (isMobileViewport()) closeSidebarMobile();
  };
  wireDragSource(item, "local", node.id);
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

/* Lets dropping on empty sidebar space (not on any folder row) move/copy an
   item to the local tree's top level (parentId null). Wired once at
   startup — #local-list itself persists across renderLocalNotes() calls,
   only its innerHTML changes. Uses wireDragTarget from js/sidebar.js, shared
   by both sidebar panels. */
function initLocalDragDrop() {
  const list = document.getElementById("local-list");
  wireDragTarget(list, "local", null);
}

/* ─── SIDEBAR HELPERS (local tree rendering) ─── */
function getLocalRootNodes() {
  return localNotes.filter((n) => n.parentId === null);
}

function getLocalChildren(parentId) {
  return localNotes.filter((n) => n.parentId === parentId);
}

/* Returns true if `candidateId` is `ancestorId` itself or sits somewhere in
   its subtree (walking up candidateId's parentId chain) — blocks dropping a
   folder into its own descendant. */
function isLocalDescendant(candidateId, ancestorId) {
  if (candidateId === ancestorId) return true;
  let cur = localNotes.find((n) => n.id === candidateId);
  while (cur && cur.parentId !== null) {
    if (cur.parentId === ancestorId) return true;
    cur = localNotes.find((n) => n.id === cur.parentId);
  }
  return false;
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

/* ═══════════════════════════════════════════════════════════════════════
   REAL-FILESYSTEM BACKEND (File System Access API)
   ═══════════════════════════════════════════════════════════════════════ */

function renderLocalConnectPrompt(list) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "padding:10px 8px 12px;";
  const msg = document.createElement("div");
  msg.style.cssText = "color:var(--text-muted);font-size:12px;line-height:1.6;margin-bottom:8px;";
  msg.textContent = localRootHandle ? t("local.reconnectPrompt") : t("local.connectPrompt");
  const btn = document.createElement("button");
  btn.className = "btn btn-accent";
  btn.style.cssText = "font-size:12px;padding:5px 10px;";
  btn.textContent = localRootHandle ? t("local.reconnectButton") : t("local.connectButton");
  btn.onclick = () => (localRootHandle ? reconnectLocalFolder() : connectLocalFolder());
  wrap.appendChild(msg);
  wrap.appendChild(btn);
  list.appendChild(wrap);
}

async function connectLocalFolder() {
  try {
    const parentHandle = await window.showDirectoryPicker({
      id: "andysnote-local",
      mode: "readwrite",
      startIn: "documents",
    });
    const rootHandle = await parentHandle.getDirectoryHandle(ANDYSNOTE_ROOT_NAME, { create: true });
    await localHandlePut("root", { handle: rootHandle });
    localRootHandle = rootHandle;
    await connectToRootHandle(rootHandle, /*isNewConnection*/ true);
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("connectLocalFolder failed", e);
      setSyncStatus("error", t("local.connectFailed"), true);
    }
  }
}

async function reconnectLocalFolder() {
  if (!localRootHandle) return connectLocalFolder();
  try {
    const perm = await localRootHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    await connectToRootHandle(localRootHandle, /*isNewConnection*/ false);
  } catch (e) {
    console.error("reconnectLocalFolder failed", e);
  }
}

async function connectToRootHandle(rootHandle, isNewConnection) {
  localFsConnected = true;
  if (isNewConnection) {
    await migrateIdbToFolder(rootHandle);
  }
  await rescanLocalFolder();
}

async function rescanLocalFolder() {
  if (!localRootHandle) return;
  localNotes = await walkLocalFolder(localRootHandle, null);
  renderLocalNotes(currentSearchValue());
}

/* Recursively lists one real directory's contents into flat `localNotes`
   entries. Bodies are NOT read here (lazy — only on open), so this stays
   fast even for large folders. */
async function walkLocalFolder(dirHandle, parentId) {
  const nodes = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "directory") {
      const now = new Date().toISOString();
      const folderId = genLocalId();
      nodes.push({
        id: folderId,
        type: "folder",
        parentId,
        title: name,
        name,
        createdTime: now,
        modifiedTime: now,
        handle,
        ext: null,
      });
      const children = await walkLocalFolder(handle, folderId);
      nodes.push(...children);
    } else if (handle.kind === "file" && isDriveDocName(name)) {
      const file = await handle.getFile();
      const { cleanTitle, createdDate } = parseCreatedFromName(name);
      const extMatch = name.match(DOC_EXT_REGEX);
      const ext = extMatch ? extMatch[0].toLowerCase() : ".txt";
      nodes.push({
        id: genLocalId(),
        type: "note",
        parentId,
        title: cleanTitle,
        name,
        body: undefined, // lazily loaded on open
        createdTime: (createdDate || new Date(file.lastModified)).toISOString(),
        modifiedTime: new Date(file.lastModified).toISOString(),
        handle,
        ext,
      });
    }
  }
  return nodes;
}

function resolveParentDirHandle(parentId) {
  if (parentId === null || parentId === undefined) return localRootHandle;
  const parent = localNotes.find((n) => n.id === parentId);
  return parent ? parent.handle : null;
}

/* Tries "title", then "title (2)", "title (3)", ... until an unused name is
   found in `dir` — used for both file and folder creation so two same-day
   "Untitled" notes (identical filename otherwise) don't silently collide. */
async function uniqueLocalName(dir, baseTitle, buildName, excludeName) {
  let n = 0;
  while (true) {
    const candidateTitle = n === 0 ? baseTitle : `${baseTitle} (${n + 1})`;
    const name = buildName(candidateTitle);
    if (name === excludeName) return { name, title: candidateTitle };
    const existsAsFile = await dir.getFileHandle(name).then(() => true).catch(() => false);
    const existsAsDir = existsAsFile
      ? true
      : await dir.getDirectoryHandle(name).then(() => true).catch(() => false);
    if (!existsAsFile && !existsAsDir) return { name, title: candidateTitle };
    n++;
  }
}

async function createLocalNoteFs(parentId, ext, presetTitle, presetBody) {
  const dir = resolveParentDirHandle(parentId);
  if (!dir) return;
  const now = new Date();
  const baseTitle = presetTitle || t("editor.titlePlaceholder");
  const { name, title } = await uniqueLocalName(dir, baseTitle, (t) => buildStoredName(t, ext, now));
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(presetBody || "");
  await writable.close();
  const node = {
    id: genLocalId(),
    type: "note",
    parentId,
    title,
    name,
    body: presetBody || "",
    createdTime: now.toISOString(),
    modifiedTime: now.toISOString(),
    handle,
    ext,
  };
  localNotes.push(node);
  renderLocalNotes(currentSearchValue());
  openLocalNote(node.id);
}

async function createLocalFolderFs(parentId) {
  const dir = resolveParentDirHandle(parentId);
  if (!dir) return;
  const baseTitle = t("local.newFolderDefaultName");
  const { name, title } = await uniqueLocalName(dir, baseTitle, (t) => t);
  const handle = await dir.getDirectoryHandle(name, { create: true });
  const now = new Date().toISOString();
  const folder = {
    id: genLocalId(),
    type: "folder",
    parentId,
    title,
    name,
    createdTime: now,
    modifiedTime: now,
    handle,
    ext: null,
  };
  localNotes.push(folder);
  renderLocalNotes(currentSearchValue());
}

async function deleteLocalNoteFs(id) {
  const node = localNotes.find((n) => n.id === id);
  if (!node) return;
  const parentDir = resolveParentDirHandle(node.parentId);
  try {
    if (node.type === "folder") {
      await parentDir.removeEntry(node.name, { recursive: true });
    } else {
      await parentDir.removeEntry(node.name);
    }
  } catch (e) {
    console.error("deleteLocalNoteFs error", e);
  }

  const idsToRemove = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of localNotes) {
      if (idsToRemove.has(n.parentId) && !idsToRemove.has(n.id)) {
        idsToRemove.add(n.id);
        changed = true;
      }
    }
  }
  localNotes = localNotes.filter((n) => !idsToRemove.has(n.id));
  if (idsToRemove.has(currentFileId)) {
    currentFileId = null;
    showEmptyState();
  }
  renderLocalNotes(currentSearchValue());
}

/* Recursively copies every real file/folder from src into (already-created)
   dest — the core of "rename a folder", since File System Access has no
   native move/rename. */
async function copyLocalFolderContents(srcDirHandle, destDirHandle) {
  for await (const [name, handle] of srcDirHandle.entries()) {
    if (handle.kind === "directory") {
      const newSubDir = await destDirHandle.getDirectoryHandle(name, { create: true });
      await copyLocalFolderContents(handle, newSubDir);
    } else {
      const file = await handle.getFile();
      const content = await file.text();
      const newFileHandle = await destDirHandle.getFileHandle(name, { create: true });
      const writable = await newFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }
  }
}

/* Shared rename core for both files and folders — always rebuilds the full
   on-disk name via buildStoredName(), whether the title changed, the
   created date changed, or (for the date-edit flow) both stay the same for
   one and change for the other. Used by renameLocalNoteFs (title edits),
   the created-date chip's edit callback, and file/folder creation dedup. */
async function renameLocalNoteFs(id, newTitle, newCreatedDate) {
  const node = localNotes.find((n) => n.id === id);
  if (!node) return;
  const finalTitle = newTitle !== undefined && newTitle !== null ? newTitle : node.title;
  const finalDate = newCreatedDate || new Date(node.createdTime);
  const parentDir = resolveParentDirHandle(node.parentId);
  if (!parentDir) return;

  if (node.type === "folder") {
    const { name: newName } = await uniqueLocalName(parentDir, finalTitle, (t) => t, node.name);
    if (newName !== node.name) {
      const newDirHandle = await parentDir.getDirectoryHandle(newName, { create: true });
      await copyLocalFolderContents(node.handle, newDirHandle);
      await parentDir.removeEntry(node.name, { recursive: true });
    }
    // Folder contents (and their handles) are cheapest to refresh via a full
    // rescan rather than surgically patching every descendant's handle.
    await rescanLocalFolder();
    return;
  }

  const { name: newName, title: dedupedTitle } = await uniqueLocalName(
    parentDir,
    finalTitle,
    (t) => buildStoredName(t, node.ext, finalDate),
    node.name,
  );
  if (newName === node.name) return;

  const isOpenDoc = id === currentFileId;
  const content = isOpenDoc ? editorGetText() : await node.handle.getFile().then((f) => f.text());
  const newHandle = await parentDir.getFileHandle(newName, { create: true });
  const writable = await newHandle.createWritable();
  await writable.write(content);
  await writable.close();
  await parentDir.removeEntry(node.name);

  node.handle = newHandle;
  node.name = newName;
  node.title = dedupedTitle;
  node.createdTime = finalDate.toISOString();
  node.body = content;

  if (isOpenDoc) {
    document.getElementById("doc-title").value = dedupedTitle;
  }
  renderLocalNotes(currentSearchValue());
}

/* Drag-and-drop move within the real filesystem — same "copy into new
   location, then remove the original" approach as renameLocalNoteFs's
   folder branch, since File System Access has no native move either. */
async function moveLocalNodeFs(id, newParentId) {
  const node = localNotes.find((n) => n.id === id);
  if (!node || node.parentId === newParentId) return;
  const oldParentDir = resolveParentDirHandle(node.parentId);
  const newParentDir = resolveParentDirHandle(newParentId);
  if (!oldParentDir || !newParentDir) return;

  if (node.type === "folder") {
    const { name: newName } = await uniqueLocalName(newParentDir, node.title, (t) => t);
    const newDirHandle = await newParentDir.getDirectoryHandle(newName, { create: true });
    await copyLocalFolderContents(node.handle, newDirHandle);
    await oldParentDir.removeEntry(node.name, { recursive: true });
    // Same as renameLocalNoteFs's folder branch: cheapest to refresh every
    // descendant handle via a full rescan rather than patching them by hand.
    await rescanLocalFolder();
    return;
  }

  const { name: newName } = await uniqueLocalName(
    newParentDir,
    node.title,
    (t) => buildStoredName(t, node.ext, new Date(node.createdTime)),
  );
  const isOpenDoc = id === currentFileId;
  const content = isOpenDoc ? editorGetText() : await node.handle.getFile().then((f) => f.text());
  const newHandle = await newParentDir.getFileHandle(newName, { create: true });
  const writable = await newHandle.createWritable();
  await writable.write(content);
  await writable.close();
  await oldParentDir.removeEntry(node.name);

  node.handle = newHandle;
  node.name = newName;
  node.parentId = newParentId;
  node.body = content;
  renderLocalNotes(currentSearchValue());
}

async function saveLocalNowFs() {
  const note = localNotes.find((n) => n.id === currentFileId);
  if (!note) return;

  const newTitle = document.getElementById("doc-title").value.trim() || t("editor.titlePlaceholder");
  const newBody = editorGetText();
  const titleChanged = note.title !== newTitle;

  if (!titleChanged && note.body === newBody) {
    localDirty = false;
    return;
  }

  if (titleChanged) {
    await renameLocalNoteFs(note.id, newTitle);
  }

  const writable = await note.handle.createWritable();
  await writable.write(newBody);
  await writable.close();
  note.body = newBody;
  note.modifiedTime = new Date().toISOString();

  localDirty = false;
  renderLocalNotes(currentSearchValue());
  setSyncStatus("saved", t("sync.saved") + " · " + formatTime(new Date()));
}

/* One-time IndexedDB -> real folder export, run right after a fresh
   connect (never re-runs once the "migrated" marker is set — a partial
   failure just means it can retry on the next connect, since already-
   written files are simply overwritten again, not duplicated). */
async function migrateIdbToFolder(rootHandle) {
  const marker = await localHandleGet("migrated");
  if (marker && marker.done) return;

  const old = await localDbGetAll().catch(() => []);
  if (!old.length) {
    await localHandlePut("migrated", { done: true });
    return;
  }

  setSyncStatus("saving", t("local.migrating"));
  const idToDirHandle = new Map(); // old IndexedDB id -> new real directory handle
  const byParent = new Map();
  for (const n of old) {
    if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
    byParent.get(n.parentId).push(n);
  }

  async function migrateLevel(parentOldId, destDirHandle) {
    for (const n of byParent.get(parentOldId) || []) {
      try {
        if (n.type === "folder") {
          const { name } = await uniqueLocalName(destDirHandle, n.title, (t) => t);
          const dirHandle = await destDirHandle.getDirectoryHandle(name, { create: true });
          idToDirHandle.set(n.id, dirHandle);
          await migrateLevel(n.id, dirHandle);
        } else {
          const created = n.createdTime ? new Date(n.createdTime) : new Date();
          const { name } = await uniqueLocalName(destDirHandle, n.title, (t) =>
            buildStoredName(t, ".txt", created),
          );
          const fileHandle = await destDirHandle.getFileHandle(name, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(n.body || "");
          await writable.close();
        }
      } catch (e) {
        console.error("migrateIdbToFolder item failed (continuing)", n, e);
      }
    }
  }

  await migrateLevel(null, rootHandle);
  await localHandlePut("migrated", { done: true });
  setSyncStatus("saved", t("local.migrateDone"));
  // Old IndexedDB copy is deliberately kept (not cleared) as a safety net.
}
