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

  const parsedName = parseCreatedFromName(node.name);
  const title = parsedName.cleanTitle;
  document.getElementById("doc-title").value = title;

  const parentNode = findParentOf(node.id, driveTree);
  document.getElementById("meta-folder-name").textContent = parentNode
    ? parentNode.name
    : ANDYSNOTE_ROOT_NAME;

  const created = parsedName.createdDate || (node.createdTime ? new Date(node.createdTime) : null);
  renderCreatedDateChip(created, async (newDate) => {
    await renameDriveEntryName(node, { createdDate: newDate });
    renderSidebar(currentSearchValue());
  });

  const modified = node.modifiedTime ? new Date(node.modifiedTime) : null;
  document.getElementById("meta-modified-val").textContent = modified
    ? modified.toLocaleDateString(localeTag(), {
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
  setSyncStatus("saving", t("sync.opening"));

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
    setSyncStatus("saved", t("sync.opened") + " \u00b7 " + formatTime(new Date()));
  }

  if (cachedIsFresh) {
    updateWordCount();
    autoResize(document.getElementById("doc-title"));
    return;
  }

  try {
    const text = await driveGetFileText(node.id);
    if (currentFileId !== node.id) return;
    cachePutDoc(node.id, text, node.modifiedTime);
    const unedited = !painted || editorGetText() === paintedText;
    if (unedited && text !== editorGetText()) {
      editorOpen(text, editorOpts);
    }
    setSyncStatus("saved", t("sync.opened") + " \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("openDoc error", e);
    if (!painted)
      setSyncStatus("error", t("sync.openFailed") + " \u00b7 " + formatTime(new Date()), true);
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
  document.getElementById("word-count").textContent = tWordCount(count);

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

/* ─── CREATED-DATE CHIP (editable, shared by openDoc/openLocalNote) ───────
   Neither backend's real created-date is something we can just overwrite
   as metadata (Drive's createdTime is server-managed; local files have no
   creation-time field at all) — both encode it in the saved filename
   instead (js/config.js: buildStoredName et al). Clicking the chip swaps
   its text for a native <input type="date">; committing it calls back into
   whichever backend is open so it can rename the underlying file/Drive doc
   to match, then re-renders the chip from the confirmed result. */
function renderCreatedDateChip(date, onDateChange) {
  const chip = document.getElementById("meta-date");
  const val = document.getElementById("meta-date-val");
  val.textContent = date
    ? date.toLocaleDateString(localeTag(), { month: "short", day: "numeric", year: "numeric" })
    : "—";
  chip.onclick = () => beginEditCreatedDate(date, onDateChange);
}

function isoDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function beginEditCreatedDate(currentDate, onDateChange) {
  const val = document.getElementById("meta-date-val");
  if (!val || val.tagName === "INPUT") return; // already editing

  const input = document.createElement("input");
  input.type = "date";
  input.className = "meta-date-edit";
  if (currentDate) input.value = isoDateOnly(currentDate);

  val.replaceWith(input);
  input.focus();

  let settled = false;
  const restore = (displayDate) => {
    if (settled) return;
    settled = true;
    // Swap a fresh <span id="meta-date-val"> back in (rather than reusing
    // the <input>, whose .textContent wouldn't render) so
    // renderCreatedDateChip's getElementById lookup finds a real span again.
    const span = document.createElement("span");
    span.id = "meta-date-val";
    input.replaceWith(span);
    renderCreatedDateChip(displayDate, onDateChange);
  };

  input.addEventListener("blur", async () => {
    const picked = input.value ? new Date(input.value + "T00:00:00") : null;
    if (!picked || (currentDate && isoDateOnly(picked) === isoDateOnly(currentDate))) {
      restore(currentDate);
      return;
    }
    try {
      await onDateChange(picked);
      restore(picked);
    } catch (e) {
      console.error("created-date edit failed", e);
      restore(currentDate);
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.value = currentDate ? isoDateOnly(currentDate) : "";
      input.blur();
    }
  });
}
