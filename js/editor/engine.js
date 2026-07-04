/* ─── EDITOR ENGINE ────────────────────────────────────────────────────────
   Owns markdownText (the only source of truth), the cursor, and all input.
   Two surfaces share one API:
     - plain mode  : a real <textarea>. Native cursor/undo/IME, no rendering.
       Used for Drive .txt docs (no toolbar) and local notes (toolbar still
       does raw text-transforms directly on the textarea, unchanged).
     - rich mode   : a contenteditable <div> with Typora-style live Markdown
       rendering. Used for Drive .md docs.

   Rich mode never trusts the browser's native contenteditable editing
   (Enter/Backspace handling is inconsistent across browsers and is exactly
   what caused problems before). Instead every edit is intercepted via
   `beforeinput`, applied to markdownText as a plain string splice, and every
   line is re-rendered from that string. IME composition is the one
   exception: composition text lands in a live DOM text node normally, and
   is resynced into markdownText once composition ends (or is force-ended,
   see richHandleBeforeInput).

   Rendering never depends on cursor/focus position — once a pattern is
   recognized it renders styled with its syntax hidden, always. There is no
   "reveal raw text while the caret is on it" mode, so nothing needs to
   track which line is focused. */

let markdownText = "";
let _plainEl = null; // <textarea id="doc-body">
let _richEl = null; // <div id="doc-body-rich">
let richMode = false; // true only for Drive .md docs
let toolbarVisible = true; // false only for Drive .txt docs
let _lineEls = [];
let _lineMappings = [];
let _composing = false;

/* ─── Public API (shared by both modes) ─── */

function editorOpen(text, opts) {
  opts = opts || {};
  richMode = !!opts.rich;
  toolbarVisible = opts.toolbar !== false;
  markdownText = text || "";

  _plainEl = document.getElementById("doc-body");
  _richEl = document.getElementById("doc-body-rich");
  wireEditorEvents();
  setToolbarVisible(toolbarVisible);

  if (richMode) {
    if (_plainEl) _plainEl.style.display = "none";
    if (_richEl) _richEl.style.display = "";
    richRenderAll(null);
  } else {
    if (_richEl) _richEl.style.display = "none";
    if (_plainEl) {
      _plainEl.style.display = "";
      _plainEl.value = markdownText;
    }
  }

  updateWordCount();
}

function editorGetText() {
  return markdownText;
}

function editorSetText(text) {
  markdownText = text || "";
  if (richMode) {
    richRenderAll(null);
  } else if (_plainEl) {
    _plainEl.value = markdownText;
  }
  updateWordCount();
}

function editorSyncFromView() {
  if (richMode || !_plainEl) return;
  markdownText = _plainEl.value || "";
  updateWordCount();
  if (storageMode === "local" && currentFileId) scheduleLocalSave();
  else if (driveAccessToken && currentFileId) scheduleDriveSave();
}

function isRichMarkdownActive() {
  return richMode;
}

function isToolbarVisible() {
  return toolbarVisible;
}

function setToolbarVisible(visible) {
  const group = document.getElementById("md-toolbar-group");
  if (group) group.classList.toggle("hidden", !visible);
}

function wireEditorEvents() {
  if (_plainEl && !_plainEl._editorWired) {
    _plainEl.addEventListener("input", editorSyncFromView);
    _plainEl._editorWired = true;
  }
  if (_richEl && !_richEl._editorWired) {
    _richEl.addEventListener("beforeinput", richHandleBeforeInput);
    _richEl.addEventListener("compositionstart", richHandleCompositionStart);
    _richEl.addEventListener("compositionend", richHandleCompositionEnd);
    _richEl._editorWired = true;
  }
}

function scheduleRichChangeCallbacks() {
  updateWordCount();
  if (storageMode === "local" && currentFileId) scheduleLocalSave();
  else if (driveAccessToken && currentFileId) scheduleDriveSave();
}

/* ─── Rich mode: line bookkeeping ─── */

function lineStartOffset(index) {
  const lines = markdownText.split("\n");
  let acc = 0;
  for (let i = 0; i < index; i++) acc += lines[i].length + 1;
  return acc;
}

function lineAndOffsetForAbsolute(abs) {
  const lines = markdownText.split("\n");
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length;
    if (abs <= acc + len) return { line: i, offset: abs - acc };
    acc += len + 1;
  }
  const last = lines.length - 1;
  return { line: last, offset: lines[last].length };
}

function lineIndexForNode(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== _richEl) {
    if (el.classList && el.classList.contains("doc-line")) {
      return _lineEls.indexOf(el);
    }
    el = el.parentElement;
  }
  return -1;
}

/* Like lineIndexForNode, but also resolves the case where the browser
   addresses the caret directly on the root editable (e.g. clicking in the
   padding around a single empty line) instead of descending into a line's
   DOM — there `offset` is a child index, not a text offset. */
function resolveLineIndex(node, offset) {
  if (node === _richEl) {
    if (_lineEls.length === 0) return -1;
    return Math.max(0, Math.min(offset, _lineEls.length - 1));
  }
  return lineIndexForNode(node);
}

function domPointToAbsolute(node, offset) {
  if (node === _richEl) {
    const idx = resolveLineIndex(node, offset);
    return idx === -1 ? null : lineStartOffset(idx);
  }
  const lineIndex = lineIndexForNode(node);
  if (lineIndex === -1) return null;
  const rawInLine = rawOffsetFromCaret(_lineMappings[lineIndex], node, offset) ?? 0;
  return lineStartOffset(lineIndex) + rawInLine;
}

/* ─── Rich mode: rendering ───
   oldLines (or null) is the line array from right before the change that
   produced the current markdownText — passed straight to the Renderer so
   it can tell "this block type is brand new here" apart from "this line
   was already this type," which decides whether a completed prefix like
   "> " is safe to collapse immediately. See renderer.js's shouldStyleBlock. */

function richRenderAll(oldLines) {
  const lines = markdownText.split("\n");
  _richEl.innerHTML = "";
  _lineEls = [];
  _lineMappings = [];
  lines.forEach((lineText, i) => {
    const container = document.createElement("div");
    container.className = "doc-line";
    const oldText = oldLines ? oldLines[i] : null;
    const { frag, mapping } = renderLine(lineText, oldText);
    container.appendChild(frag);
    _richEl.appendChild(container);
    _lineEls.push(container);
    _lineMappings.push(mapping);
  });
}

/* ─── Rich mode: selection / editing ─── */

function richGetSelectionOffsets() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return { start: null, end: null };
  const range = sel.getRangeAt(0);
  const startAbs = domPointToAbsolute(range.startContainer, range.startOffset);
  const endAbs = range.collapsed ? startAbs : domPointToAbsolute(range.endContainer, range.endOffset);
  return { start: startAbs, end: endAbs };
}

/* Apply a raw-text splice, then re-render and place the caret/selection.
   selStart/selEnd (absolute offsets) default to a collapsed caret right
   after the inserted text. */
function richApplyEdit(start, end, text, selStart, selEnd) {
  const oldLines = markdownText.split("\n");
  markdownText = markdownText.slice(0, start) + text + markdownText.slice(end);
  scheduleRichChangeCallbacks();

  const finalStart = selStart != null ? selStart : start + text.length;
  const finalEnd = selEnd != null ? selEnd : finalStart;
  const from = lineAndOffsetForAbsolute(finalStart);
  const to = lineAndOffsetForAbsolute(finalEnd);

  richRenderAll(oldLines);

  if (from.line === to.line) {
    placeCaretRangeInLine(_lineEls[from.line], _lineMappings[from.line], from.offset, to.offset);
  } else {
    placeCaretInLine(_lineEls[from.line], _lineMappings[from.line], from.offset);
  }
}

/* If a composition is (or might still be, per stale event ordering — see
   richHandleBeforeInput) in progress, read its line's live text back out of
   the DOM into markdownText before anything else touches it. Hidden syntax
   marks are never removed from the DOM, only CSS-hidden, so textContent is
   always the true raw text. Returns the resynced line index, or -1. */
function finishComposition() {
  if (!_composing) return -1;
  _composing = false;
  const sel = window.getSelection();
  if (!sel.rangeCount) return -1;
  const range = sel.getRangeAt(0);
  const index = resolveLineIndex(range.startContainer, range.startOffset);
  if (index === -1 || !_lineEls[index]) return -1;

  const newLineText = _lineEls[index].textContent;
  const lines = markdownText.split("\n");
  lines[index] = newLineText;
  markdownText = lines.join("\n");
  return index;
}

function richHandleBeforeInput(e) {
  if (!richMode) return;
  // Let the IME edit its own text node natively — never intercept this.
  if (e.inputType === "insertCompositionText") return;

  // Some IMEs use Enter (or another key) to confirm/commit a composition in
  // a way where compositionend hasn't fired yet by the time this event
  // arrives — our own _composing flag can still read stale-true here. Don't
  // trust it as a gate; resync first if needed, then always handle the
  // event on its actual inputType. (This is what made Enter appear to do
  // nothing after typing Korean: we skipped the newline, the browser's own
  // uncontrolled default ran instead, and the next re-render silently
  // reverted it.)
  const resyncedLine = finishComposition();

  e.preventDefault();
  let { start, end } = richGetSelectionOffsets();
  if (start == null && resyncedLine !== -1) {
    // The selection can momentarily fail to resolve right after a DOM text
    // node's content changed out from under a stale mapping; fall back to
    // the end of the just-resynced line.
    const lines = markdownText.split("\n");
    start = end = lineStartOffset(resyncedLine) + lines[resyncedLine].length;
  }
  if (start == null) return;

  switch (e.inputType) {
    case "insertText":
    case "insertReplacementText":
      richApplyEdit(start, end, e.data != null ? e.data : "");
      return;
    case "insertFromPaste":
    case "insertFromDrop": {
      const text = e.dataTransfer ? e.dataTransfer.getData("text/plain") : e.data || "";
      richApplyEdit(start, end, text);
      return;
    }
    case "insertParagraph":
    case "insertLineBreak":
      richApplyEdit(start, end, "\n");
      return;
    case "deleteContentBackward":
    case "deleteWordBackward":
    case "deleteSoftLineBackward":
    case "deleteHardLineBackward":
      if (start !== end) richApplyEdit(start, end, "");
      else richApplyEdit(Math.max(0, start - 1), start, "");
      return;
    case "deleteContentForward":
    case "deleteWordForward":
    case "deleteSoftLineForward":
    case "deleteHardLineForward":
      if (start !== end) richApplyEdit(start, end, "");
      else richApplyEdit(start, Math.min(markdownText.length, start + 1), "");
      return;
    default:
      return; // unhandled: no-op rather than risk corrupting the text
  }
}

function richHandleCompositionStart() {
  _composing = true;
}

/* Normal end-of-composition path (e.g. the IME auto-commits after a pause,
   or focus moves away) — richHandleBeforeInput's finishComposition() covers
   the case where composition is still "active" per our flag when a real
   edit (typically Enter) arrives first. */
function richHandleCompositionEnd() {
  // Capture the precise caret offset against the still-valid pre-resync
  // mapping/DOM before finishComposition() touches markdownText.
  let offset = null;
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const idx = resolveLineIndex(range.startContainer, range.startOffset);
    if (idx !== -1 && _lineMappings[idx]) {
      offset = rawOffsetFromCaret(_lineMappings[idx], range.startContainer, range.startOffset);
    }
  }

  const index = finishComposition();
  if (index === -1) return;
  scheduleRichChangeCallbacks();
  const lines = markdownText.split("\n");
  const finalOffset = offset != null ? offset : lines[index].length;
  richRenderAll(lines);
  placeCaretInLine(_lineEls[index], _lineMappings[index], finalOffset);
}

/* ─── Rich mode: toolbar actions (called from js/markdown.js) ─── */

function richWrapSelection(before, after = before) {
  const { start, end } = richGetSelectionOffsets();
  if (start == null) return;
  const selected = markdownText.slice(start, end);
  const isWrapped =
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after);

  const replacement = isWrapped
    ? selected.slice(before.length, selected.length - after.length)
    : before + selected + after;

  const selStart = isWrapped ? start : start + before.length;
  const selEnd = isWrapped ? start + replacement.length : start + replacement.length - after.length;
  richApplyEdit(start, end, replacement, selStart, selEnd);
}

function richTransformCurrentLine(transform) {
  const { start } = richGetSelectionOffsets();
  if (start == null) return;
  const { line } = lineAndOffsetForAbsolute(start);
  const lineText = markdownText.split("\n")[line];
  const updated = transform(lineText);
  const from = lineStartOffset(line);
  richApplyEdit(from, from + lineText.length, updated, from + updated.length);
}
