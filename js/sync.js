/* ─── BULK SYNC (Drive <-> local, one-shot, same-name-overwrites) ──────────
   Orchestrates the two backends (js/drive.js primitives, js/local.js
   primitives) into a one-time bulk copy in either direction — "드라이브로
   보내기" (local -> Drive) and "드라이브에서 가져오기" (Drive -> local).
   Neither drive.js nor local.js is touched structurally; this file only
   walks both trees and calls their existing primitives. See docs plan for
   the full design rationale.

   Scope (confirmed with the user): additive + overwrite-on-name-collision
   only. Items that exist only in the destination are never touched or
   deleted — this is not a mirror/dedup sync. */

/* ─── PUSH: local -> Drive ─── */
async function syncPushToDrive() {
  if (!driveAccessToken || bulkSyncInProgress) return;
  if (!confirm(t("sync.confirmPush"))) return;

  bulkSyncInProgress = true;
  setSyncStatus("saving", t("sync.pushing"));
  try {
    await pushNodesToDrive(getLocalRootNodes(), andysNoteRootId);
    renderSidebar(currentSearchValue());
    setSyncStatus("saved", t("sync.pushDone") + " · " + formatTime(new Date()));
  } catch (e) {
    console.error("syncPushToDrive failed", e);
    setSyncStatus("error", t("sync.pushFailed"), true);
  } finally {
    bulkSyncInProgress = false;
  }
}

async function pushNodesToDrive(localChildren, driveParentId) {
  for (const node of localChildren) {
    try {
      if (node.type === "folder") {
        const driveFolderId = await findOrCreateDriveFolder(node.title, driveParentId);
        await pushNodesToDrive(getLocalChildren(node.id), driveFolderId);
      } else {
        const name = node.name || buildStoredName(node.title, node.ext || ".txt", new Date(node.createdTime));
        const body = await readLocalNodeBody(node);
        const existing = findDriveChildByName(driveParentId, name);
        if (existing) await drivePatch(existing.id, body);
        else await createDriveFile(name, driveParentId, body);
      }
    } catch (e) {
      console.error("pushNodesToDrive item failed (continuing)", node, e);
    }
  }
}

/* ─── PULL: Drive -> local ─── */
async function syncPullFromDrive() {
  if (!driveAccessToken || bulkSyncInProgress) return;
  if (!confirm(t("sync.confirmPull"))) return;

  bulkSyncInProgress = true;
  setSyncStatus("saving", t("sync.pulling"));
  try {
    await loadEntireTree();
    await pullNodesToLocal(driveTree, null);
    renderLocalNotes(currentSearchValue());
    setSyncStatus("saved", t("sync.pullDone") + " · " + formatTime(new Date()));
  } catch (e) {
    console.error("syncPullFromDrive failed", e);
    setSyncStatus("error", t("sync.pullFailed"), true);
  } finally {
    bulkSyncInProgress = false;
  }
}

async function pullNodesToLocal(driveChildren, localParentId) {
  for (const node of driveChildren) {
    try {
      if (node.mimeType === FOLDER_MIME) {
        const localFolderId = await findOrCreateLocalFolder(node.name, localParentId);
        await pullNodesToLocal(node.children, localFolderId);
      } else if (isDriveDocName(node.name)) {
        const text = await driveGetFileText(node.id);
        await writeLocalFileOverwrite(node.name, localParentId, text);
      }
    } catch (e) {
      console.error("pullNodesToLocal item failed (continuing)", node, e);
    }
  }
}

/* ─── Drive-side helpers (tree lookup + create, mirroring modal.js:createItem) ─── */
function getDriveChildrenArray(parentId) {
  if (parentId === andysNoteRootId) return driveTree;
  function find(nodes) {
    for (const n of nodes) {
      if (n.id === parentId) return n.children;
      if (n.mimeType === FOLDER_MIME) {
        const found = find(n.children);
        if (found) return found;
      }
    }
    return null;
  }
  return find(driveTree) || [];
}

function findDriveChildByName(parentId, name) {
  return getDriveChildrenArray(parentId).find((n) => n.name === name) || null;
}

async function findOrCreateDriveFolder(name, parentId) {
  const existing = getDriveChildrenArray(parentId).find(
    (n) => n.mimeType === FOLDER_MIME && n.name === name,
  );
  if (existing) return existing.id;
  const created = await drivePost("https://www.googleapis.com/drive/v3/files", {
    name,
    mimeType: FOLDER_MIME,
    parents: [parentId],
  });
  const node = {
    id: created.id,
    name,
    mimeType: FOLDER_MIME,
    createdTime: new Date().toISOString(),
    modifiedTime: new Date().toISOString(),
    children: [],
    loaded: true,
  };
  insertIntoTree(node, parentId);
  syncFolderCache(parentId);
  return node.id;
}

async function createDriveFile(name, parentId, body) {
  const extMatch = name.match(DOC_EXT_REGEX);
  const mimeType = extMatch && extMatch[0].toLowerCase() === ".md" ? MARKDOWN_MIME : FILE_MIME;
  const created = await drivePost(
    "https://www.googleapis.com/upload/drive/v3/files",
    { name, mimeType, parents: [parentId] },
    body,
  );
  const node = {
    id: created.id,
    name,
    mimeType,
    createdTime: new Date().toISOString(),
    modifiedTime: new Date().toISOString(),
    children: [],
    loaded: true,
  };
  insertIntoTree(node, parentId);
  syncFolderCache(parentId);
  cachePutDoc(created.id, body, node.modifiedTime);
  return node.id;
}

/* ─── Local-side helpers (find-or-create/overwrite; works for both the
   real-FS backend and the IndexedDB fallback — see js/local.js's own
   dual-backend comment for why the branch has to happen per-call rather
   than once). ─── */
async function readLocalNodeBody(node) {
  if (node.body !== undefined) return node.body;
  if (node.handle) return node.handle.getFile().then((f) => f.text());
  return "";
}

async function findOrCreateLocalFolder(name, parentId) {
  const existing = getLocalChildren(parentId).find((n) => n.type === "folder" && n.title === name);
  if (existing) return existing.id;

  const now = new Date().toISOString();
  if (localFsSupported && localFsConnected) {
    const dir = resolveParentDirHandle(parentId);
    const handle = await dir.getDirectoryHandle(name, { create: true });
    const node = {
      id: genLocalId(),
      type: "folder",
      parentId,
      title: name,
      name,
      createdTime: now,
      modifiedTime: now,
      handle,
      ext: null,
    };
    localNotes.push(node);
    return node.id;
  }

  const folder = { id: genLocalId(), type: "folder", parentId, title: name, createdTime: now, modifiedTime: now };
  await localDbPut(folder);
  localNotes.push(folder);
  return folder.id;
}

/* Drive's stored name always carries the title+created-date encoding (see
   js/config.js: parseCreatedFromName) regardless of which local backend
   receives it — the real-FS backend keeps that same encoding in its own
   filename, but the IndexedDB fallback has no filename concept at all, so
   it's decoded back into plain title/createdTime fields instead. */
async function writeLocalFileOverwrite(driveName, parentId, body) {
  const { cleanTitle, createdDate } = parseCreatedFromName(driveName);
  const now = new Date();

  if (localFsSupported && localFsConnected) {
    const existing = getLocalChildren(parentId).find((n) => n.type === "note" && n.name === driveName);
    if (existing) {
      const writable = await existing.handle.createWritable();
      await writable.write(body);
      await writable.close();
      existing.body = body;
      existing.modifiedTime = now.toISOString();
      return;
    }
    const dir = resolveParentDirHandle(parentId);
    const extMatch = driveName.match(DOC_EXT_REGEX);
    const ext = extMatch ? extMatch[0].toLowerCase() : ".txt";
    const handle = await dir.getFileHandle(driveName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(body);
    await writable.close();
    localNotes.push({
      id: genLocalId(),
      type: "note",
      parentId,
      title: cleanTitle,
      name: driveName,
      body,
      createdTime: (createdDate || now).toISOString(),
      modifiedTime: now.toISOString(),
      handle,
      ext,
    });
    return;
  }

  const existing = getLocalChildren(parentId).find((n) => n.type === "note" && n.title === cleanTitle);
  if (existing) {
    existing.body = body;
    existing.modifiedTime = now.toISOString();
    await localDbPut(existing);
    return;
  }
  const note = {
    id: genLocalId(),
    type: "note",
    parentId,
    title: cleanTitle,
    body,
    createdTime: (createdDate || now).toISOString(),
    modifiedTime: now.toISOString(),
  };
  await localDbPut(note);
  localNotes.push(note);
}
