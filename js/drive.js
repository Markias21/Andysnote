/* ─── DRIVE HTTP API ─── */
async function driveGet(url, params = {}) {
  if (!driveAccessToken) throw new Error("Not authenticated");
  const qs = Object.keys(params).length
    ? "?" + new URLSearchParams(params).toString()
    : "";
  const r = await fetch(url + qs, {
    headers: { Authorization: "Bearer " + driveAccessToken },
  });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

async function drivePost(url, metadata, textContent = null) {
  if (!driveAccessToken) throw new Error("Not authenticated");
  if (textContent === null) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + driveAccessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    });
    if (!r.ok) throw new Error(`POST ${url} -> ${r.status}: ${await r.text()}`);
    return r.json();
  } else {
    const boundary = "wb_" + Date.now();
    const body = [
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      textContent,
      `--${boundary}--`,
    ].join("\r\n");
    const r = await fetch(url + "?uploadType=multipart", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + driveAccessToken,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!r.ok)
      throw new Error(`POST multipart -> ${r.status}: ${await r.text()}`);
    return r.json();
  }
}

async function drivePatch(fileId, textContent) {
  if (!driveAccessToken) throw new Error("Not authenticated");
  const r = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + driveAccessToken,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: textContent,
    },
  );
  if (!r.ok) throw new Error(`PATCH ${fileId} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

/* ─── DRIVE FILESYSTEM ─── */
async function driveListChildren(parentId) {
  let files = [],
    pageToken = null;
  do {
    const params = {
      q: `'${parentId}' in parents and trashed=false`,
      fields:
        "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)",
      pageSize: 200,
      orderBy: "name",
    };
    if (pageToken) params.pageToken = pageToken;
    const r = await driveGet(
      "https://www.googleapis.com/drive/v3/files",
      params,
    );
    files = files.concat(r.files || []);
    pageToken = r.nextPageToken || null;
  } while (pageToken);
  return files;
}

/* ─── DRIVE FILESYSTEM INIT ─── */
/* Lazy + cache-first. We no longer crawl the whole tree up front. The root
   level is painted instantly from the IndexedDB cache (if present), then
   revalidated against Drive. Deeper folders load only when the user expands
   them (ensureFolderLoaded), or all at once when a search needs the full tree
   (loadEntireTree). */
async function initDriveFilesystem() {
  try {
    setSyncStatus("saving", "Loading...");
    driveTreeFullyLoaded = false;
    writerRootId = await findOrCreateWriterRoot();

    // 1) Instant paint from cache, if we have one.
    const cached = await cacheGetChildren(writerRootId);
    if (cached && cached.length) {
      driveTree = cached.map(driveNodeFrom);
      renderSidebar(currentSearchValue());
      populateModalFolders();
      setSyncStatus("saved", "Loaded from cache");
    }

    // 2) Revalidate the root level against Drive.
    const fresh = await loadChildrenShallow(writerRootId);
    driveTree = mergeChildren(driveTree, fresh);
    renderSidebar(currentSearchValue());
    populateModalFolders();
    setSyncStatus("saved", "Loaded \u00b7 " + formatTime(new Date()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    console.error("initDriveFilesystem error (full):", e);
    console.error("initDriveFilesystem error (message):", msg);
    setSyncStatus(
      "error",
      "Load failed \u00b7 " + formatTime(new Date()),
      true,
    );
  }
}

/* Build an in-memory tree node from a raw Drive/cache item. Folders start
   unloaded (children fetched on demand); files are trivially "loaded". */
function driveNodeFrom(item) {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    createdTime: item.createdTime,
    modifiedTime: item.modifiedTime,
    children: [],
    loaded: item.mimeType !== FOLDER_MIME,
  };
}

/* Fetch ONLY the direct children of a folder (no recursion) and cache them. */
async function loadChildrenShallow(parentId) {
  const items = await driveListChildren(parentId);
  cachePutChildren(parentId, items);
  return items.map(driveNodeFrom);
}

/* Merge freshly-fetched children over existing ones, preserving any already
   loaded subtrees so revalidating a level does not discard deeper loaded data. */
function mergeChildren(oldNodes, freshNodes) {
  const oldById = new Map((oldNodes || []).map((n) => [n.id, n]));
  return freshNodes.map((f) => {
    const prev = oldById.get(f.id);
    if (prev && f.mimeType === FOLDER_MIME) {
      f.children = prev.children;
      f.loaded = prev.loaded;
    }
    return f;
  });
}

/* Ensure a folder's direct children are loaded. Cache-first paint, then
   revalidate against Drive. Re-renders the sidebar as data arrives. */
async function ensureFolderLoaded(folderId) {
  const node = findNodeById(folderId, driveTree);
  if (!node || node.mimeType !== FOLDER_MIME || node.loaded) return;

  if (node.children.length === 0) {
    const cached = await cacheGetChildren(folderId);
    if (cached && cached.length && node.children.length === 0) {
      node.children = cached.map(driveNodeFrom);
      renderSidebar(currentSearchValue());
    }
  }

  try {
    const fresh = await loadChildrenShallow(folderId);
    node.children = mergeChildren(node.children, fresh);
    node.loaded = true;
    renderSidebar(currentSearchValue());
    populateModalFolders();
  } catch (e) {
    console.error("ensureFolderLoaded error", e);
  }
}

/* Load every unloaded folder in the tree, in parallel per level. Used when a
   search query needs to see the whole workspace. Runs once; result is cached. */
async function loadEntireTree() {
  if (driveTreeFullyLoaded) return;
  if (driveFullLoadPromise) return driveFullLoadPromise;
  driveFullLoadPromise = (async () => {
    const ok = await deepLoadNodes(driveTree);
    // Only mark complete when EVERY subtree loaded, so a transient failure does
    // not permanently lock search into a partial view — a later search retries.
    if (ok) driveTreeFullyLoaded = true;
    renderSidebar(currentSearchValue());
    populateModalFolders();
  })();
  try {
    await driveFullLoadPromise;
  } finally {
    driveFullLoadPromise = null;
  }
}

/* Persist a folder's current in-memory children to the cache. Call after a
   create so the cached tree stays in sync with what the user sees. */
function syncFolderCache(parentId) {
  const children =
    parentId === writerRootId
      ? driveTree
      : (findNodeById(parentId, driveTree) || {}).children || [];
  cachePutChildren(parentId, children);
}

async function deepLoadNodes(nodes) {
  const results = await Promise.all(
    nodes.map(async (n) => {
      if (n.mimeType !== FOLDER_MIME) return true;
      if (!n.loaded) {
        try {
          const fresh = await loadChildrenShallow(n.id);
          n.children = mergeChildren(n.children, fresh);
          n.loaded = true;
        } catch (e) {
          console.error("deepLoadNodes error", e);
          return false; // this subtree stays incomplete; caller must not finalize
        }
      }
      return deepLoadNodes(n.children);
    }),
  );
  return results.every(Boolean);
}

async function findOrCreateWriterRoot() {
  const r = await driveGet("https://www.googleapis.com/drive/v3/files", {
    q: `name='${WRITER_ROOT_NAME}' and mimeType='${FOLDER_MIME}' and 'root' in parents and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  if (r.files && r.files.length > 0) return r.files[0].id;
  // Create Writer/ root folder
  const created = await drivePost(
    "https://www.googleapis.com/drive/v3/files",
    { name: WRITER_ROOT_NAME, mimeType: FOLDER_MIME, parents: ["root"] },
  );
  return created.id;
}

/* ─── SAVE DOC ─── */
function saveDoc() {
  if (storageMode === "local") {
    if (!currentFileId) return;
    clearTimeout(localSaveTimer);
    saveLocalNow();
    return;
  }
  if (!currentFileId || !driveAccessToken) return;
  clearTimeout(driveSaveTimer);
  saveToDriveNow();
}

function scheduleDriveSave() {
  if (!driveAccessToken || !currentFileId) return;
  clearTimeout(driveSaveTimer);
  setSyncStatus("saving", "Saving...");
  driveSaveTimer = setTimeout(saveToDriveNow, 3000);
}

/* Flush a pending Drive autosave before switching documents so a delayed
   timer can never patch the wrong file after currentFileId has changed. */
async function flushDriveSave() {
  if (driveSaveTimer) {
    clearTimeout(driveSaveTimer);
    driveSaveTimer = null;
  }
  if (storageMode === "drive" && currentFileId && driveAccessToken)
    await saveToDriveNow();
}

async function saveToDriveNow() {
  if (!driveAccessToken || !currentFileId) return;
  try {
    setSyncStatus("saving", "Saving...");
    const text = document.getElementById("doc-body").innerText || "";
    const savedId = currentFileId;
    await drivePatch(savedId, text);
    // Update cached modifiedTime + persist the new body so re-opening is instant.
    const stamp = new Date().toISOString();
    const node = findNodeById(savedId, driveTree);
    if (node) node.modifiedTime = stamp;
    cachePutDoc(savedId, text, stamp);
    setSyncStatus("saved", "Saved \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("saveToDriveNow error", e);
    setSyncStatus(
      "error",
      "Save failed \u00b7 " + formatTime(new Date()),
      true,
    );
  }
}

function retryDriveSave() {
  if (currentFileId && driveAccessToken) {
    saveToDriveNow();
  } else if (driveAccessToken && !writerRootId) {
    initDriveFilesystem();
  }
}
