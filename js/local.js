/* ─── LOCAL REPOSITORY (real folder + .txt files on disk) ─── */
/* Storage backends are separated by file, mirroring the existing pattern:
     - GoogleDrive : drive.js  (Google Drive is the source of truth)
     - Local       : this file — a real folder on the computer, accessed with the
                     File System Access API. Folders and .txt files are created,
                     opened and saved exactly like the Drive workspace; only the
                     backend operations run here in local.js.
   In "local" storage mode the shared workspace globals (driveTree, writerRootId,
   currentFileId, expandedFolders) describe the local tree, and each node id maps
   to a FileSystemHandle in `localHandles`. */

/* Register a handle and return a fresh synthetic node id. */
function registerLocalHandle(handle, parentId, name, kind) {
  const id = "L" + ++localIdCounter;
  localHandles[id] = { handle, parentId, name, kind };
  return id;
}

/* Connect (or create) a folder on disk and switch to local mode. */
async function connectLocalFolder() {
  if (!window.showDirectoryPicker) {
    alert(
      "\uC774 \uBE0C\uB77C\uC6B0\uC800\uB294 \uB85C\uCEEC \uD3F4\uB354 \uAE30\uB2A5\uC744 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.\n\uB370\uC2A4\uD06C\uD1B1 Chrome \uB610\uB294 Edge\uC5D0\uC11C \uC0AC\uC6A9\uD574 \uC8FC\uC138\uC694.",
    );
    return;
  }
  let picked;
  try {
    picked = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (e) {
    if (e && e.name === "AbortError") return; // user cancelled the picker
    console.error("showDirectoryPicker error", e);
    alert("\uD3F4\uB354\uB97C \uC5EC\uB294 \uB370 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    return;
  }
  try {
    // Create/reuse the app's workspace folder inside the chosen directory.
    localRootHandle = await picked.getDirectoryHandle(WRITER_ROOT_NAME, {
      create: true,
    });
  } catch (e) {
    console.error("getDirectoryHandle(root) error", e);
    alert("\uC120\uD0DD\uD55C \uD3F4\uB354\uC5D0 \uC4F8 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uAD8C\uD55C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
    return;
  }

  storageMode = "local";
  currentFileId = null;
  expandedFolders = new Set();
  localHandles = {};
  localIdCounter = 0;
  writerRootId = registerLocalHandle(
    localRootHandle,
    null,
    WRITER_ROOT_NAME,
    "directory",
  );
  updateLocalUI();
  showEmptyState();
  await initLocalFilesystem();
}

/* Build the tree from disk and render it (mirrors initDriveFilesystem). */
async function initLocalFilesystem() {
  try {
    setSyncStatus("saving", "Loading...");
    driveTree = await loadLocalSubtree(localRootHandle, writerRootId);
    renderSidebar();
    populateModalFolders();
    setSyncStatus("saved", "Loaded \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("initLocalFilesystem error", e);
    setSyncStatus(
      "error",
      "Load failed \u00b7 " + formatTime(new Date()),
      false,
    );
  }
}

/* Recursively read a directory into the node shape used by the sidebar. */
async function loadLocalSubtree(dirHandle, parentId) {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    entries.push([name, handle]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  const nodes = [];
  for (const [name, handle] of entries) {
    if (handle.kind === "directory") {
      const id = registerLocalHandle(handle, parentId, name, "directory");
      const children = await loadLocalSubtree(handle, id);
      nodes.push({
        id,
        name,
        mimeType: FOLDER_MIME,
        createdTime: null,
        modifiedTime: null,
        children,
      });
    } else if (name.endsWith(".txt")) {
      const id = registerLocalHandle(handle, parentId, name, "file");
      let modifiedTime = null;
      try {
        const f = await handle.getFile();
        modifiedTime = new Date(f.lastModified).toISOString();
      } catch (_) {
        /* ignore unreadable file timestamps */
      }
      nodes.push({
        id,
        name,
        mimeType: FILE_MIME,
        createdTime: modifiedTime,
        modifiedTime,
        children: [],
      });
    }
  }
  return nodes;
}

/* Create a folder or document on disk (called from createItem in local mode). */
async function localCreateItem(type, title, folderId) {
  const parentRec = localHandles[folderId];
  const parentHandle = parentRec ? parentRec.handle : localRootHandle;

  const targetName =
    type === "folder"
      ? title
      : title.endsWith(".txt")
        ? title
        : title + ".txt";

  // Prevent duplicate tree nodes when the name already exists on disk
  // (getDirectoryHandle/getFileHandle with create:true reuse existing entries).
  const siblings =
    folderId === writerRootId
      ? driveTree
      : (findNodeById(folderId, driveTree) || {}).children || [];
  if (siblings.some((c) => c.name === targetName)) {
    setSyncStatus(
      "error",
      "Name already exists \u00b7 " + formatTime(new Date()),
      false,
    );
    alert('"' + targetName + '" already exists in this folder.');
    return;
  }

  if (type === "folder") {
    const dh = await parentHandle.getDirectoryHandle(targetName, {
      create: true,
    });
    const id = registerLocalHandle(dh, folderId, targetName, "directory");
    const newNode = {
      id,
      name: targetName,
      mimeType: FOLDER_MIME,
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString(),
      children: [],
    };
    insertIntoTree(newNode, folderId);
    expandedFolders.add(folderId);
    renderSidebar();
    populateModalFolders();
    setSyncStatus("saved", "Folder created \u00b7 " + formatTime(new Date()));
  } else {
    const fileName = targetName;
    const fh = await parentHandle.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write("");
    await w.close();
    const id = registerLocalHandle(fh, folderId, fileName, "file");
    const newNode = {
      id,
      name: fileName,
      mimeType: FILE_MIME,
      createdTime: new Date().toISOString(),
      modifiedTime: new Date().toISOString(),
      children: [],
    };
    insertIntoTree(newNode, folderId);
    expandedFolders.add(folderId);
    renderSidebar();
    await openLocalDoc(newNode);
  }
}

/* Open a local document into the editor (mirrors openDoc for Drive). */
async function openLocalDoc(node) {
  currentFileId = node.id;

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("writing-panel").classList.remove("hidden");

  document.getElementById("doc-title").value = node.name.replace(/\.txt$/, "");

  const parentNode = findParentOf(node.id, driveTree);
  document.getElementById("meta-folder-name").textContent = parentNode
    ? parentNode.name
    : WRITER_ROOT_NAME;

  document.getElementById("doc-body").innerText = "";
  document.getElementById("doc-body").classList.add("empty");
  setSyncStatus("saving", "Opening...");

  try {
    const rec = localHandles[node.id];
    const f = await rec.handle.getFile();
    const text = await f.text();
    document.getElementById("doc-body").innerText = text;
    if (text.trim())
      document.getElementById("doc-body").classList.remove("empty");

    const modified = new Date(f.lastModified);
    node.modifiedTime = modified.toISOString();
    document.getElementById("meta-date-val").textContent =
      modified.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("openLocalDoc error", e);
    setSyncStatus(
      "error",
      "Open failed \u00b7 " + formatTime(new Date()),
      false,
    );
  }

  updateWordCount();
  autoResize(document.getElementById("doc-title"));
  renderSidebar(document.getElementById("search-input").value);
}

/* Debounced + immediate local save (mirror scheduleDriveSave / saveToDriveNow). */
function scheduleLocalSave() {
  if (storageMode !== "local" || !currentFileId) return;
  clearTimeout(localSaveTimer);
  setSyncStatus("saving", "Saving...");
  localSaveTimer = setTimeout(saveLocalNow, 1500);
}

async function saveLocalNow() {
  if (storageMode !== "local" || !currentFileId) return;
  const rec = localHandles[currentFileId];
  if (!rec) return;
  try {
    setSyncStatus("saving", "Saving...");
    const text = document.getElementById("doc-body").innerText || "";
    const w = await rec.handle.createWritable();
    await w.write(text);
    await w.close();
    const node = findNodeById(currentFileId, driveTree);
    if (node) node.modifiedTime = new Date().toISOString();
    setSyncStatus("saved", "Saved \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("saveLocalNow error", e);
    setSyncStatus(
      "error",
      "Save failed \u00b7 " + formatTime(new Date()),
      false,
    );
  }
}

/* Reflect local mode in the top bar. */
function updateLocalUI() {
  const btn = document.getElementById("btn-local-folder");
  if (btn) btn.classList.add("active");
}
