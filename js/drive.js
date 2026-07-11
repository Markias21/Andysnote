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

/* Fetches a Drive file's raw text content. Factored out of openDoc() (which
   also handles caching/painting) so bulk operations like js/sync.js can read
   file bodies without pulling in editor-specific logic. */
async function driveGetFileText(fileId) {
  if (!driveAccessToken) throw new Error("Not authenticated");
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: "Bearer " + driveAccessToken },
  });
  if (!r.ok) throw new Error("fetch content failed: " + r.status);
  return r.text();
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

/* Metadata-only PATCH (the regular files.update endpoint, not the media
   upload one drivePatch() uses for content) — currently only used to rename
   a file, e.g. to update the created-date suffix encoded in its name. */
async function drivePatchMetadata(fileId, metadata) {
  if (!driveAccessToken) throw new Error("Not authenticated");
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + driveAccessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });
  if (!r.ok) throw new Error(`PATCH metadata ${fileId} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

/* Drag-and-drop move: reparents a file/folder to a different Drive folder
   via the addParents/removeParents query params (files.update). */
async function driveMoveFile(fileId, newParentId, oldParentId) {
  if (!driveAccessToken) throw new Error("Not authenticated");
  const url =
    `https://www.googleapis.com/drive/v3/files/${fileId}` +
    `?addParents=${newParentId}&removeParents=${oldParentId}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + driveAccessToken,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!r.ok) throw new Error(`PATCH move ${fileId} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

/* Returns true if `candidateId` is `ancestorId` itself or sits somewhere in
   its subtree — used to block dropping a folder into its own descendant. */
function isDriveDescendant(candidateId, ancestorId) {
  if (candidateId === ancestorId) return true;
  const ancestor = findNodeById(ancestorId, driveTree);
  if (!ancestor || ancestor.mimeType !== FOLDER_MIME) return false;
  return !!findNodeById(candidateId, ancestor.children);
}

/* Moves a Drive node to a new parent folder (or andysNoteRootId for the
   top level): calls the API, then patches the in-memory tree the same way
   insertIntoTree/removeFromTree keep create/delete in sync. */
async function moveDriveNode(node, newParentId) {
  const oldParent = findParentOf(node.id, driveTree);
  const oldParentId = oldParent ? oldParent.id : andysNoteRootId;
  if (oldParentId === newParentId) return;
  await driveMoveFile(node.id, newParentId, oldParentId);
  removeFromTree(node.id);
  insertIntoTree(node, newParentId);
  syncFolderCache(oldParentId);
  syncFolderCache(newParentId);
}

/* Renames a Drive node's underlying file name — the only way to make its
   created date user-editable, since Drive's real createdTime field isn't
   something a normal app can modify via the API. Rebuilds the FULL name via
   buildStoredName() every time (whether title, created date, or both
   changed) rather than patching pieces of the old one, same as the local
   backend's rename does. `title`/`createdDate` are optional — omit either
   to keep that part as-is. */
async function renameDriveEntryName(node, { title, createdDate } = {}) {
  const parsed = parseCreatedFromName(node.name);
  const finalTitle = title !== undefined ? title : parsed.cleanTitle;
  const finalDate = createdDate || parsed.createdDate || new Date(node.createdTime);
  const extMatch = node.name.match(DOC_EXT_REGEX);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".txt";
  const newName = buildStoredName(finalTitle, ext, finalDate);
  if (newName === node.name) return;
  await drivePatchMetadata(node.id, { name: newName });
  node.name = newName;
  node.modifiedTime = new Date().toISOString();
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
    setSyncStatus("saving", t("sync.loading"));
    driveTreeFullyLoaded = false;
    andysNoteRootId = await findOrCreateAndysNoteRoot();
    resolvePlannerFolderId(); // fire-and-forget — must not block the cache-first paint below

    // 1) Instant paint from cache, if we have one.
    const cached = await cacheGetChildren(andysNoteRootId);
    if (cached && cached.length) {
      driveTree = cached.map(driveNodeFrom);
      renderSidebar(currentSearchValue());
      populateModalFolders();
      setSyncStatus("saved", t("sync.loadedFromCache"));
    }

    // 2) Revalidate the root level against Drive.
    const fresh = await loadChildrenShallow(andysNoteRootId);
    driveTree = mergeChildren(driveTree, fresh);
    renderSidebar(currentSearchValue());
    populateModalFolders();
    setSyncStatus("saved", t("sync.loaded") + " \u00b7 " + formatTime(new Date()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    console.error("initDriveFilesystem error (full):", e);
    console.error("initDriveFilesystem error (message):", msg);
    setSyncStatus(
      "error",
      t("sync.loadFailed") + " \u00b7 " + formatTime(new Date()),
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
  // Dedupe: a rapid re-open must not fire a second list call for the same folder.
  if (folderLoadPromises[folderId]) return folderLoadPromises[folderId];

  folderLoadPromises[folderId] = (async () => {
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
  })();
  try {
    await folderLoadPromises[folderId];
  } finally {
    delete folderLoadPromises[folderId];
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
    parentId === andysNoteRootId
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

/* Fill a <select> with one <option> per Drive folder, indented by nesting
   depth, ahead of whatever rootOptionHtml the caller wants as the first
   (unfiltered/root) choice. Shared by the "new document" modal's folder
   picker and the calendar's folder-scope filter so both look and behave
   the same way. */
function populateDriveFolderSelect(sel, rootOptionHtml) {
  sel.innerHTML = rootOptionHtml;
  function addOptions(nodes, prefix) {
    for (const n of nodes) {
      if (n.id === plannerFolderId) continue; // reserved planner folder, not a document folder
      if (n.mimeType !== FOLDER_MIME) continue;
      const opt = document.createElement("option");
      opt.value = n.id;
      opt.textContent = prefix + n.name;
      sel.appendChild(opt);
      addOptions(n.children, prefix + "  ");
    }
  }
  addOptions(driveTree, "");
}

async function findOrCreateAndysNoteRoot() {
  const r = await driveGet("https://www.googleapis.com/drive/v3/files", {
    q: `name='${ANDYSNOTE_ROOT_NAME}' and mimeType='${FOLDER_MIME}' and 'root' in parents and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  if (r.files && r.files.length > 0) return r.files[0].id;
  // Create AndysNote/ root folder
  const created = await drivePost(
    "https://www.googleapis.com/drive/v3/files",
    { name: ANDYSNOTE_ROOT_NAME, mimeType: FOLDER_MIME, parents: ["root"] },
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
  if (!getSetting("behavior.autoSave") || !getSetting("behavior.driveSync"))
    return;
  driveDirty = true;
  clearTimeout(driveSaveTimer);
  setSyncStatus("saving", t("sync.saving"));
  driveSaveTimer = setTimeout(saveToDriveNow, 3000);
}

/* Flush a pending Drive autosave before switching documents so a delayed
   timer can never patch the wrong file after currentFileId has changed.
   Only writes when the open doc is actually dirty — browsing/reading notes
   must not trigger a wasteful PATCH on every navigation. */
async function flushDriveSave() {
  if (driveSaveTimer) {
    clearTimeout(driveSaveTimer);
    driveSaveTimer = null;
  }
  if (storageMode === "drive" && currentFileId && driveAccessToken && driveDirty)
    await saveToDriveNow();
}

async function saveToDriveNow() {
  if (!driveAccessToken || !currentFileId) return;
  try {
    setSyncStatus("saving", t("sync.saving"));
    const text = editorGetText();
    const savedId = currentFileId;
    await drivePatch(savedId, text);
    // Update cached modifiedTime + persist the new body so re-opening is instant.
    const stamp = new Date().toISOString();
    const node = findNodeById(savedId, driveTree);
    if (node) node.modifiedTime = stamp;
    cachePutDoc(savedId, text, stamp);
    driveDirty = false;
    setSyncStatus("saved", t("sync.saved") + " \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("saveToDriveNow error", e);
    setSyncStatus(
      "error",
      t("sync.saveFailed") + " \u00b7 " + formatTime(new Date()),
      true,
    );
  }
}

function retryDriveSave() {
  if (currentFileId && driveAccessToken) {
    saveToDriveNow();
  } else if (driveAccessToken && !andysNoteRootId) {
    initDriveFilesystem();
  }
}
