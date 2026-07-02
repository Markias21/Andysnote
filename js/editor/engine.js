/* ─── EDITOR ENGINE ────────────────────────────────────────────────────────
   Single-surface Markdown editor.

   State:
     markdownText – the only source of truth
     _editorBodyEl – textarea view bound to markdownText

   The editor keeps browser-native cursor behavior and does not manage
   block focus, block rendering, or cursor mapping. */

let markdownText = "";
let _editorBodyEl = null;

/* ─── Public API ─── */

function editorOpen(text) {
  markdownText = text || "";
  _editorBodyEl = document.getElementById("doc-body");

  if (_editorBodyEl) {
    _editorBodyEl.value = markdownText;
    if (!_editorBodyEl._editorWired) {
      _editorBodyEl.addEventListener("input", editorSyncFromView);
      _editorBodyEl._editorWired = true;
    }
  }

  updateWordCount();
}

function editorGetText() {
  return markdownText;
}

function editorSetText(text) {
  markdownText = text || "";
  if (_editorBodyEl) _editorBodyEl.value = markdownText;
  updateWordCount();
}

function editorSyncFromView() {
  if (!_editorBodyEl) return;
  markdownText = _editorBodyEl.value || "";
  updateWordCount();

  if (storageMode === "local" && currentFileId) scheduleLocalSave();
  else if (driveAccessToken && currentFileId) scheduleDriveSave();
}
