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
   `beforeinput`, applied to markdownText as a plain string splice, and the
   affected line(s) are re-rendered from that string. IME composition is the
   one exception: composition text lands in a live DOM text node normally,
   and is resynced into markdownText only once composition ends. */

let markdownText = "";
let _plainEl = null; // <textarea id="doc-body">
let _richEl = null; // <div id="doc-body-rich">
let richMode = false; // true only for Drive .md docs
let toolbarVisible = true; // false only for Drive .txt docs
let _lineEls = [];
let _lineMappings = [];
let _focusLine = -1;
let _focusOffset = 0;
let _composing = false;
let _programmaticSelection = false;

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
    _focusLine = -1;
    _focusOffset = 0;
    richRenderAll(-1, 0);
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
    _focusLine = -1;
    _focusOffset = 0;
    richRenderAll(-1, 0);
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
    document.addEventListener("selectionchange", richHandleSelectionChange);
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

/* ─── Rich mode: rendering ─── */

function richRenderAll(focusLine, focusOffset) {
  const lines = markdownText.split("\n");
  _richEl.innerHTML = "";
  _lineEls = [];
  _lineMappings = [];
  lines.forEach((lineText, i) => {
    const container = document.createElement("div");
    container.className = "doc-line";
    const focused = i === focusLine;
    const { frag, mapping } = renderLine(lineText, focused, focused ? focusOffset : null);
    container.appendChild(frag);
    _richEl.appendChild(container);
    _lineEls.push(container);
    _lineMappings.push(mapping);
  });
}

function richRenderLine(index, focused, offset) {
  const container = _lineEls[index];
  if (!container) return;
  const lineText = markdownText.split("\n")[index] ?? "";
  container.innerHTML = "";
  const { frag, mapping } = renderLine(lineText, focused, focused ? offset : null);
  container.appendChild(frag);
  _lineMappings[index] = mapping;
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
  markdownText = markdownText.slice(0, start) + text + markdownText.slice(end);
  scheduleRichChangeCallbacks();

  const finalStart = selStart != null ? selStart : start + text.length;
  const finalEnd = selEnd != null ? selEnd : finalStart;
  const from = lineAndOffsetForAbsolute(finalStart);
  const to = lineAndOffsetForAbsolute(finalEnd);

  _focusLine = from.line;
  _focusOffset = from.offset;
  richRenderAll(from.line, from.offset);

  _programmaticSelection = true;
  if (from.line === to.line) {
    placeCaretRangeInLine(_lineEls[from.line], _lineMappings[from.line], from.offset, to.offset);
  } else {
    placeCaretInLine(_lineEls[from.line], _lineMappings[from.line], from.offset);
  }
}

function richHandleBeforeInput(e) {
  if (!richMode || _composing) return;
  e.preventDefault();
  const { start, end } = richGetSelectionOffsets();
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

/* IME composition edits a live text node directly (uncontrolled, by design
   — this is what lets Korean/Japanese/Chinese input work naturally). Once
   composition ends, read that line's true text back out of the DOM (hidden
   syntax marks included, since they're only CSS-hidden, never removed) and
   resync markdownText from it. */
function richHandleCompositionEnd() {
  _composing = false;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const index = resolveLineIndex(range.startContainer, range.startOffset);
  if (index === -1) return;

  const container = _lineEls[index];
  const newLineText = container.textContent;
  const offset = rawOffsetFromCaret(_lineMappings[index], range.startContainer, range.startOffset);

  const lines = markdownText.split("\n");
  lines[index] = newLineText;
  markdownText = lines.join("\n");
  scheduleRichChangeCallbacks();

  const finalOffset = offset != null ? offset : newLineText.length;
  _focusLine = index;
  _focusOffset = finalOffset;
  richRenderAll(index, finalOffset);
  _programmaticSelection = true;
  placeCaretInLine(_lineEls[index], _lineMappings[index], finalOffset);
}

function richHandleSelectionChange() {
  if (!richMode || _composing) return;
  if (_programmaticSelection) {
    _programmaticSelection = false;
    return;
  }
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!_richEl || !_richEl.contains(range.startContainer)) return;
  // A real (non-collapsed) selection — e.g. dragging text to bold it — must
  // never be collapsed back to a caret here. Leave rendering alone; reveal
  // resumes once the selection collapses again.
  if (!range.collapsed) return;

  const idx = resolveLineIndex(range.startContainer, range.startOffset);
  if (idx === -1) return;
  const offset = rawOffsetFromCaret(_lineMappings[idx], range.startContainer, range.startOffset) ?? 0;
  if (idx === _focusLine && offset === _focusOffset) return;

  const oldLine = _focusLine;
  _focusLine = idx;
  _focusOffset = offset;

  if (oldLine !== idx && oldLine >= 0 && oldLine < _lineEls.length) {
    richRenderLine(oldLine, false, null);
  }
  richRenderLine(idx, true, offset);

  _programmaticSelection = true;
  placeCaretInLine(_lineEls[idx], _lineMappings[idx], offset);
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
