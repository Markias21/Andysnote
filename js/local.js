/* ─── LOCAL REPOSITORY (TXT export/import adapter) ─── */
/* Storage backends are separated by file, mirroring the existing pattern:
     - GoogleDrive : drive.js  (Drive is the source of truth)
     - Browser     : reserved for a future browser-storage adapter
     - Local       : this file — TXT file export/import (NOT filesystem access)
   Like drive.js, this adapter is a set of plain functions (no new globals),
   so additional backends can be added simply by adding another such file. */

/* Export the current note as a downloadable .txt file. */
function exportLocalFile() {
  const titleEl = document.getElementById("doc-title");
  const bodyEl = document.getElementById("doc-body");
  const title = (titleEl && titleEl.value.trim()) || "Untitled";
  const body = bodyEl ? bodyEl.innerText : "";

  const safeName = title.replace(/[\\/:*?"<>|]/g, "_") || "Untitled";
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName + ".txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setSyncStatus("saved", "Exported \u00b7 " + formatTime(new Date()));
}

/* Open the hidden file picker so the user can choose a .txt file to import. */
function triggerLocalImport() {
  const input = document.getElementById("local-file-input");
  if (input) input.click();
}

/* Load the chosen .txt file's contents into the editor. */
function handleLocalImport(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === "string" ? reader.result : "";
    const title = file.name.replace(/\.txt$/i, "");

    document.getElementById("empty-state").classList.add("hidden");
    document.getElementById("writing-panel").classList.remove("hidden");

    document.getElementById("doc-title").value = title;
    const bodyEl = document.getElementById("doc-body");
    bodyEl.innerText = text;
    if (text.trim()) bodyEl.classList.remove("empty");
    else bodyEl.classList.add("empty");

    document.getElementById("meta-folder-name").textContent = "Local";
    document.getElementById("meta-date-val").textContent = new Date().toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    );

    // Imported notes are local-only; do not attach to a Drive file so the
    // existing Drive autosave (which requires currentFileId) never fires.
    currentFileId = null;

    updateWordCount();
    autoResize(document.getElementById("doc-title"));
    setSyncStatus("saved", "Imported \u00b7 " + formatTime(new Date()));
  };
  reader.onerror = () => {
    setSyncStatus("error", "Import failed \u00b7 " + formatTime(new Date()), false);
  };
  reader.readAsText(file);

  input.value = ""; // allow re-importing the same file
}
