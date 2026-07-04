/* ─── EDITOR ADAPTER ────────────────────────────────────────────────────────
   Thin adapter layer. Keeps all old function signatures so the rest of
   the app (sidebar.js, local.js, app.js, etc.) does not need to change.
   Internally delegates to the new modular engine in js/editor/.

   Old API          →  New Engine
   openDoc(node)    →  editorOpen(text)   (after Drive fetch)
   setDocBody(text) →  editorSetText(text)
   onBodyInput()    →  no-op (engine handles it)
   onTitleInput()   →  autoResize + schedule save
   getBodyText()    →  editorGetText()
   updateWordCount() →  unchanged
   autoResize()     →  unchanged
   updateMeta()     →  unchanged
   showEmptyState() →  unchanged
   saveDoc()        →  unchanged (delegates to drive.js/local.js) */

/* ─── OPEN DOC ─── */
async function openDoc(node) {
  if (!driveAccessToken) return;
  await flushDriveSave();
  await flushLocalSave();
  storageMode = "drive";
  currentFileId = node.id;
  driveDirty = false;
  localDirty = false;

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("writing-panel").classList.remove("hidden");

  renderSidebar(currentSearchValue());

  const title = stripDocExt(node.name);
  document.getElementById("doc-title").value = title;

  const parentNode = findParentOf(node.id, driveTree);
  document.getElementById("meta-folder-name").textContent = parentNode
    ? parentNode.name
    : ANDYSNOTE_ROOT_NAME;

  const created = node.createdTime ? new Date(node.createdTime) : null;
  document.getElementById("meta-date-val").textContent = created
    ? created.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  const modified = node.modifiedTime ? new Date(node.modifiedTime) : null;
  document.getElementById("meta-modified-val").textContent = modified
    ? modified.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  // Only .md docs get the live Markdown renderer + formatting toolbar;
  // .txt docs stay plain text, matching PRINCIPLE.md's storage rules.
  const richMarkdown = /\.md$/i.test(node.name);
  const editorOpts = { rich: richMarkdown, toolbar: richMarkdown };

  editorOpen("", editorOpts);
  setSyncStatus("saving", "Opening...");

  let painted = false;
  let paintedText = null;
  const cached = await cacheGetDoc(node.id);
  if (currentFileId !== node.id) return;
  const cachedText =
    cached && typeof cached.text === "string" ? cached.text : null;
  const cachedIsFresh =
    cachedText !== null &&
    cached &&
    cached.modifiedTime &&
    node.modifiedTime &&
    cached.modifiedTime === node.modifiedTime;

  if (cachedText !== null) {
    editorOpen(cachedText, editorOpts);
    paintedText = cachedText;
    painted = true;
    setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));
  }

  if (cachedIsFresh) {
    updateWordCount();
    autoResize(document.getElementById("doc-title"));
    return;
  }

  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${node.id}?alt=media`,
      { headers: { Authorization: "Bearer " + driveAccessToken } },
    );
    if (!r.ok) throw new Error("fetch content failed: " + r.status);
    const text = await r.text();
    if (currentFileId !== node.id) return;
    cachePutDoc(node.id, text, node.modifiedTime);
    const unedited = !painted || editorGetText() === paintedText;
    if (unedited && text !== editorGetText()) {
      editorOpen(text, editorOpts);
    }
    setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("openDoc error", e);
    if (!painted)
      setSyncStatus("error", "Open failed \u00b7 " + formatTime(new Date()), true);
  }

  updateWordCount();
  autoResize(document.getElementById("doc-title"));
}

/* ─── SET BODY ─── */
function setDocBody(text) {
  editorSetText(text || "");
  setBodyEmptyClass(text);
}

function setBodyEmptyClass(text) {
  const isEmpty = !(text || "").trim();
  for (const id of ["doc-body", "doc-body-rich"]) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("empty", isEmpty);
  }
}

/* ─── INPUT HANDLERS ───
   The new engine owns the contenteditable surface, so these are no-ops
   or thin wrappers. */
function onBodyInput() {
  if (typeof editorSyncFromView === "function") {
    editorSyncFromView();
  }
}

function onTitleInput() {
  autoResize(document.getElementById("doc-title"));
  updateMeta();
  if (storageMode === "local" && currentFileId) scheduleLocalSave();
}

/* ─── UTILITIES ─── */
function updateWordCount() {
  const text = (editorGetText() || "").trim();
  const count = text ? text.split(/\s+/).length : 0;
  document.getElementById("word-count").textContent =
    count + (count === 1 ? " word" : " words");

  setBodyEmptyClass(text);
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function updateMeta() {
  autoResize(document.getElementById("doc-title"));
}

function showEmptyState() {
  document.getElementById("empty-state").classList.remove("hidden");
  document.getElementById("writing-panel").classList.add("hidden");
  currentFileId = null;
}
