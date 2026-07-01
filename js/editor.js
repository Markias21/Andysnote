/* ─── OPEN DOC ─── */
async function openDoc(node) {
  if (!driveAccessToken) return;
  await flushDriveSave();
  await flushLocalSave();
  storageMode = "drive";
  currentFileId = node.id;
  // The freshly opened doc starts clean; never carry a prior doc's dirty flag.
  driveDirty = false;
  localDirty = false;

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("writing-panel").classList.remove("hidden");

  // Optimistic UI: paint the sidebar active highlight straight from local
  // selection state (currentFileId), decoupled from the async content load
  // below. Previously this ran only after the Drive fetch, so the highlight
  // lagged a network round-trip on every click.
  renderSidebar(currentSearchValue());

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

  setDocBody("");
  setSyncStatus("saving", "Opening...");

  // 1) Instant paint from cache, if we have this note's body stored.
  let painted = false;
  let paintedText = null;
  const cached = await cacheGetDoc(node.id);
  if (currentFileId !== node.id) return; // user switched docs during await
  if (cached && typeof cached.text === "string") {
    setDocBody(cached.text);
    paintedText = cached.text;
    painted = true;
    setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));
  }

  // 2) Always revalidate the body from Drive (stale-while-revalidate). Drive is
  //    the source of truth, so we never rely on cache alone for correctness.
  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${node.id}?alt=media`,
      { headers: { Authorization: "Bearer " + driveAccessToken } },
    );
    if (!r.ok) throw new Error("fetch content failed: " + r.status);
    const text = await r.text();
    if (currentFileId !== node.id) return; // stale response, a newer doc is open
    cachePutDoc(node.id, text, node.modifiedTime);
    // Only replace the visible body if the user hasn't started editing since the
    // cache paint, so a background refresh can never clobber in-progress edits.
    const body = document.getElementById("doc-body");
    // Re-render only when the fetched text actually differs from what's shown
    // and the user hasn't started editing — so a background revalidation never
    // wipes an indent the user just applied to unchanged content.
    const unedited = !painted || body.innerText === paintedText;
    if (unedited && text !== body.innerText) {
      setDocBody(text);
    }
    setSyncStatus("saved", "Opened \u00b7 " + formatTime(new Date()));
  } catch (e) {
    console.error("openDoc error", e);
    if (!painted)
      setSyncStatus(
        "error",
        "Open failed \u00b7 " + formatTime(new Date()),
        true,
      );
  }

  updateWordCount();
  autoResize(document.getElementById("doc-title"));
}

/* Render plain text as one <div> block per line. Block-per-line is what makes
   the paragraph-level indent possible, and innerText of these blocks round-trips
   back to the exact same plain text (newlines preserved, no indent characters),
   so saved data is unaffected by any indentation applied in the UI. */
function setDocBody(text) {
  const body = document.getElementById("doc-body");
  renderBodyBlocks(body, text || "");
  if ((text || "").trim()) body.classList.remove("empty");
  else body.classList.add("empty");
  updateWordCount();
}

function renderBodyBlocks(body, text) {
  body.innerHTML = "";
  if (!text) return;
  const frag = document.createDocumentFragment();
  for (const line of text.split("\n")) {
    const div = document.createElement("div");
    if (line === "") div.appendChild(document.createElement("br"));
    else div.textContent = line; // textContent escapes HTML — no injection
    frag.appendChild(div);
  }
  body.appendChild(frag);
}

function showEmptyState() {
  document.getElementById("empty-state").classList.remove("hidden");
  document.getElementById("writing-panel").classList.add("hidden");
  currentFileId = null;
}

/* ─── EDITOR ─── */
/* Paragraph-spacing view mode. This is NOT a text-editing feature and never
   changes the saved data: setDocBody already renders each line (Enter-separated
   paragraph) as its own <div>; this just toggles the .paragraph-view class on
   #doc-body so CSS adds vertical space between those blocks. The saved value
   (body.innerText) and its \n structure are unaffected. It's a global display
   mode, applied to every paragraph at once — on by default. */
function toggleParagraphView() {
  const body = document.getElementById("doc-body");
  const on = body.classList.toggle("paragraph-view");
  const btn = document.getElementById("btn-paragraph-view");
  if (btn) btn.classList.toggle("active", on);
  body.focus();
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

function onTitleInput() {
  autoResize(document.getElementById("doc-title"));
  updateMeta();
  if (storageMode === "local" && currentFileId) scheduleLocalSave();
}
