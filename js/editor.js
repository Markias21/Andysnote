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

/* ─── PRINT ───
   Rebuilds the doc(s) being printed into #print-area (index.html's @media
   print rules) via renderLine — the same renderer the live view uses —
   instead of cloning the live #doc-body-rich DOM, since the currently
   focused line there can still be showing raw, unrendered Markdown syntax
   (see js/editor/engine.js's "the focused line is never rebuilt" rule).
   buildPrintDocBlock renders one note (title + folder/created/modified meta
   row + divider + body) matching the editor's own .editor-meta chip row;
   printCurrentDoc uses it for the open doc, printFolderDocs (called from
   js/drive.js/local.js's folder-print gathering) for every note in a
   folder. */
function buildPrintDocBlock(title, meta, text, rich) {
  const doc = document.createElement("div");
  doc.className = "print-doc";

  const titleEl = document.createElement("div");
  titleEl.className = "print-doc-title";
  titleEl.textContent = title || t("editor.titlePlaceholder");
  doc.appendChild(titleEl);

  const metaEl = document.createElement("div");
  metaEl.className = "print-doc-meta";
  for (const [label, value] of meta) {
    if (!value) continue;
    const item = document.createElement("span");
    item.className = "print-doc-meta-item";
    item.textContent = `${label}: ${value}`;
    metaEl.appendChild(item);
  }
  doc.appendChild(metaEl);

  doc.appendChild(document.createElement("hr")).className = "print-doc-divider";

  const bodyEl = document.createElement("div");
  bodyEl.className = "print-doc-body";
  if (rich) {
    for (const line of (text || "").split("\n")) {
      bodyEl.appendChild(renderLine(line, false).frag);
    }
  } else {
    bodyEl.textContent = text || "";
  }
  doc.appendChild(bodyEl);

  return doc;
}

function formatPrintDate(date) {
  return date
    ? date.toLocaleDateString(localeTag(), { month: "short", day: "numeric", year: "numeric" })
    : "";
}

function printCurrentDoc() {
  if (!currentFileId) return;

  const title = document.getElementById("doc-title").value.trim() || t("editor.titlePlaceholder");
  // Reuses the already-rendered meta chips (js/editor.js openDoc / js/local.js
  // openLocalNote both keep these in sync with the open doc) instead of
  // re-deriving folder/created/modified here.
  const folder = document.getElementById("meta-folder-name").textContent;
  const created = document.getElementById("meta-date-val").textContent;
  const modified = document.getElementById("meta-modified-val").textContent;
  const meta = [
    [t("editor.metaFolder"), folder && folder !== "—" ? folder : ""],
    [t("editor.metaCreated"), created && created !== "—" ? created : ""],
    [t("editor.metaModified"), modified && modified !== "—" ? modified : ""],
  ];

  const printArea = document.getElementById("print-area");
  printArea.innerHTML = "";
  printArea.appendChild(buildPrintDocBlock(title, meta, editorGetText(), isRichMarkdownActive()));

  window.print();
}

/* Prints every note under a folder as one multi-page job, one .print-doc per
   note (CSS page-breaks between them). `docs` is gathered by
   js/drive.js/local.js — each entry is
   { title, folderName, created: Date|null, modified: Date|null, text, rich }.
   Gathering stays with Storage (Drive/local know how to walk their own
   trees and fetch file bodies); this function only knows how to lay a list
   of already-fetched docs out for printing. */
function printFolderDocs(docs) {
  if (!docs.length) {
    setSyncStatus("error", t("sync.printFolderEmpty"));
    return;
  }

  const printArea = document.getElementById("print-area");
  printArea.innerHTML = "";
  for (const doc of docs) {
    const meta = [
      [t("editor.metaFolder"), doc.folderName || ""],
      [t("editor.metaCreated"), formatPrintDate(doc.created)],
      [t("editor.metaModified"), formatPrintDate(doc.modified)],
    ];
    printArea.appendChild(buildPrintDocBlock(doc.title, meta, doc.text, doc.rich));
  }

  window.print();
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
