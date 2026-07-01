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
async function initDriveFilesystem() {
  try {
    setSyncStatus("saving", "Loading...");
    writerRootId = await findOrCreateWriterRoot();
    driveTree = await loadSubtree(writerRootId);
    renderSidebar();
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

async function loadSubtree(parentId) {
  const items = await driveListChildren(parentId);
  const nodes = [];
  for (const item of items) {
    const node = {
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      createdTime: item.createdTime,
      modifiedTime: item.modifiedTime,
      children: [],
    };
    if (item.mimeType === FOLDER_MIME) {
      node.children = await loadSubtree(item.id);
    }
    nodes.push(node);
  }
  return nodes;
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

async function saveToDriveNow() {
  if (!driveAccessToken || !currentFileId) return;
  try {
    setSyncStatus("saving", "Saving...");
    const text = document.getElementById("doc-body").value || "";
    await drivePatch(currentFileId, text);
    // Update cached modifiedTime
    const node = findNodeById(currentFileId, driveTree);
    if (node) node.modifiedTime = new Date().toISOString();
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
