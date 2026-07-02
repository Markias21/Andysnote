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
    : ANDYSNOTE_ROOT_NAME;

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
   paragraph) as its own <div>; this just toggles the .indent-mode class on
   #doc-body so CSS adds vertical space between those blocks. The saved value
   (body.innerText) and its \n structure are unaffected. It's a global display
   mode, applied to every paragraph at once — on by default. */
function onBodyInput() {
  const body = document.getElementById("doc-body");
  normalizeBodyBlocks(body);
  if (body.textContent.trim()) body.classList.remove("empty");
  else body.classList.add("empty");
  updateWordCount();
  if (storageMode === "local") {
    if (currentFileId) scheduleLocalSave();
  } else if (driveAccessToken && currentFileId) {
    scheduleDriveSave();
  }
}

/* Ensure #doc-body contains exactly one <div> per paragraph (one per \n).
   If the browser has merged paragraphs (e.g. <br> inside a single <div>),
   rebuild from innerText and restore the cursor position. */
function normalizeBodyBlocks(body) {
  const children = Array.from(body.childNodes);
  const allDivs = children.every(
    n => n.nodeType === Node.ELEMENT_NODE && n.tagName === "DIV"
  );
  if (allDivs) return; // already normalized

  const pos = saveBodyCursor(body);
  renderBodyBlocks(body, body.innerText);
  restoreBodyCursor(body, pos);
}

/* Save cursor position as { line, col } where line = paragraph index
   (0-based, from innerText.split("\n")) and col = character offset within
   that paragraph. Works across DOM rebuilds because line/col are derived
   from plain text, not DOM nodes. */
function saveBodyCursor(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);

  const lines = body.innerText.split("\n");
  const textNodes = [];
  const it = document.createNodeIterator(body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = it.nextNode())) textNodes.push(n);

  let offset = 0;
  for (const node of textNodes) {
    if (node === range.startContainer) {
      offset += range.startOffset;
      let lineStart = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineEnd = lineStart + lines[i].length;
        if (offset <= lineEnd) return { line: i, col: offset - lineStart };
        lineStart = lineEnd + 1; // +1 for the \n
      }
      return { line: lines.length - 1, col: lines[lines.length - 1].length };
    }
    offset += node.length;
  }

  // Cursor not inside a text node (e.g. empty <div>). Find which div.
  const divs = body.querySelectorAll(":scope > div");
  for (let i = 0; i < divs.length; i++) {
    if (divs[i] === range.startContainer || divs[i].contains(range.startContainer)) {
      return { line: i, col: 0 };
    }
  }
  return null;
}

/* Restore cursor from a { line, col } position saved before DOM rebuild. */
function restoreBodyCursor(body, pos) {
  if (!pos || typeof pos !== "object") return;
  const divs = body.querySelectorAll(":scope > div");
  const div = divs[pos.line];
  if (!div) return;

  const sel = window.getSelection();
  const range = document.createRange();

  const textNodes = [];
  const it = document.createNodeIterator(div, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = it.nextNode())) textNodes.push(n);

  let offset = 0;
  for (const node of textNodes) {
    const len = node.length;
    if (offset + len >= pos.col) {
      range.setStart(node, Math.min(pos.col - offset, len));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    offset += len;
  }

  // Past all text in this paragraph: place at end of last text node,
  // or at start of the div if it only contains <br>.
  if (textNodes.length) {
    const last = textNodes[textNodes.length - 1];
    range.setStart(last, last.length);
  } else if (div.firstChild) {
    range.setStartBefore(div.firstChild);
  } else {
    range.setStart(div, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
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
