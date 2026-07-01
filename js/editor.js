/* ─── OPEN DOC ─── */
async function openDoc(node) {
  if (storageMode === "local") return openLocalDoc(node);
  if (!driveAccessToken) return;
  currentFileId = node.id;

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("writing-panel").classList.remove("hidden");

  const title = node.name.replace(/\.txt$/, "");
  document.getElementById("doc-title").value = title;

  const parentNode = findParentOf(node.id, driveTree);
  document.getElementById("meta-folder-name").textContent = parentNode
    ? parentNode.name
    : WRITER_ROOT_NAME;

  const modified = node.modifiedTime ? new Date(node.modifiedTime) : null;
  document.getElementById("meta-date-val").textContent = modified
    ? modified.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "\u2014";

  document.getElementById("doc-body").value = "";
  document.getElementById("doc-body").classList.add("empty");
  setSyncStatus("saving", "Opening...");

  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${node.id}?alt=media`,
      { headers: { Authorization: "Bearer " + driveAccessToken } },
    );
    if (!r.ok) throw new Error("fetch content failed: " + r.status);
    const text = await r.text();
    document.getElementById("doc-body").value = text;
    if (text.trim())
      document.getElementById("doc-body").classList.remove("empty");
    setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("openDoc error", e);
    setSyncStatus(
      "error",
      "Open failed \u00b7 " + formatTime(new Date()),
      true,
    );
  }

  updateWordCount();
  autoResize(document.getElementById("doc-title"));
  renderSidebar(document.getElementById("search-input").value);
}

function showEmptyState() {
  document.getElementById("empty-state").classList.remove("hidden");
  document.getElementById("writing-panel").classList.add("hidden");
  currentFileId = null;
}

/* ─── EDITOR ─── */
function execCmd(cmd, arg = null) {
  document.getElementById("doc-body").focus();
  document.execCommand(cmd, false, arg);
}

function onBodyInput() {
  updateWordCount();
  const body = document.getElementById("doc-body");
  if (body.textContent.trim()) body.classList.remove("empty");
  else body.classList.add("empty");
  if (storageMode === "local") {
    if (currentFileId) scheduleLocalSave();
  } else if (driveAccessToken && currentFileId) {
    scheduleDriveSave();
  }
}

function updateWordCount() {
  const body = document.getElementById("doc-body");
  const text = (body?.textContent || "").trim();
  const count = text ? text.split(/\s+/).length : 0;
  document.getElementById("word-count").textContent =
    count + (count === 1 ? " word" : " words");
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function updateMeta() {
  autoResize(document.getElementById("doc-title"));
}
