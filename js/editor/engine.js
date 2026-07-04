/* ─── EDITOR ENGINE ────────────────────────────────────────────────────────
   Owns markdownText (the only source of truth), the cursor, and all input.
   Two surfaces share one API:
     - plain mode  : a real <textarea>. Native cursor/undo/IME, no rendering.
       Used for Drive .txt docs (no toolbar) and local notes (toolbar still
       does raw text-transforms directly on the textarea, unchanged).
     - rich mode   : a contenteditable <div> with Typora-style live Markdown
       rendering. Used for Drive .md docs.

   Rich mode's core rule: THE FOCUSED LINE IS NEVER REBUILT WHILE YOU'RE
   TYPING ON IT. It renders as one plain, fully-raw text node, and the
   browser edits it 100% natively — that's what makes regular typing, Enter,
   Space and (especially) IME composition reliable. We only mirror its text
   into markdownText afterward, via the native `input` event.

   Earlier versions rebuilt the whole line's DOM on every keystroke (via
   `beforeinput` interception) to hide Markdown syntax live. That fought the
   browser's own composition machinery: Korean input in particular fires far
   more frequent composition cycles than English, and each rebuild could tear
   down the very text node an in-progress composition was tracking — which is
   what caused Enter/Space to misbehave specifically (and only) with Korean
   input. Styling (hidden markers, bold, block types, ...) is now applied the
   moment focus moves to a different line, not while you're still on it.

   The only things still intercepted structurally are: Enter (split the
   line), Backspace at the very start of a non-first line (merge with the
   previous one), Delete at the very end of a non-last line (merge with the
   next one), and paste/drop (insert as plain text). Everything else —
   ordinary character insertion, ordinary deletion, IME composition — is left
   entirely to the browser. */

let markdownText = "";
let _plainEl = null; // <textarea id="doc-body">
let _richEl = null; // <div id="doc-body-rich">
let richMode = false; // true only for Drive .md docs
let toolbarVisible = true; // false only for Drive .txt docs
let _lineEls = [];
let _lineMappings = [];
let _focusedLine = -1; // which line index is currently rendered raw (has the caret)

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
    richRenderAll(-1);
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
    richRenderAll(-1);
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
    _richEl.addEventListener("keydown", richHandleKeyDown);
    _richEl.addEventListener("beforeinput", richHandleBeforeInput);
    _richEl.addEventListener("input", richHandleInput);
    _richEl.addEventListener("click", richHandleClick);
    // selectionchange fires asynchronously, so a click immediately followed
    // by typing can get ahead of it — keystrokes would land before the
    // clicked line has been converted to its plain, editable raw form
    // (worst case: characters inserted directly into the root, outside any
    // line, since the browser's own click-driven caret placement raced
    // ahead of our conversion too). mousedown fires, and lets us compute the
    // click target ourselves via caretPositionFromPoint, *before* the
    // browser processes its own default caret placement — so by the time it
    // does, the target line is already in its final plain form and native
    // placement just lands correctly, with nothing left to race.
    _richEl.addEventListener("mousedown", richHandleMouseDown);
    document.addEventListener("selectionchange", richHandleSelectionChange);
    _richEl._editorWired = true;
  }
}

function richHandleClick(e) {
  const box = e.target.closest(".md-checkbox");
  if (!box) return;
  e.preventDefault();
  richToggleChecklistAt(box);
}

/* Toolbar Bold/Italic/Strike/Code buttons reflect whether the caret is
   currently inside that formatting (Word/한글-style). */
const TOOLBAR_BUTTON_IDS = {
  bold: "md-btn-bold",
  italic: "md-btn-italic",
  strike: "md-btn-strike",
  code: "md-btn-code",
};

function updateToolbarActiveStates() {
  const { start, end } = richGetSelectionOffsets();
  for (const [type, id] of Object.entries(TOOLBAR_BUTTON_IDS)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const active = start != null && !!findEnclosingInlineSpan(type, start, end);
    btn.classList.toggle("active", active);
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

  let rawInLine;
  if (lineIndex === _focusedLine) {
    // The focused line is edited natively — the browser can (and does, per
    // e.g. Chromium never using a zero-length text node as an insertion
    // anchor) restructure its DOM on its own. Its cached mapping only
    // reflects however it looked at the last render, so it can't be
    // trusted here; compute the raw offset straight from the live DOM
    // instead. A Range from the container's start to this point stringifies
    // to exactly the text that precedes it (a <br>, if any, contributes
    // nothing, same as it contributes nothing to .textContent).
    const range = document.createRange();
    range.selectNodeContents(_lineEls[lineIndex]);
    range.setEnd(node, offset);
    rawInLine = range.toString().length;
  } else {
    rawInLine = rawOffsetFromCaret(_lineMappings[lineIndex], node, offset) ?? 0;
  }
  return lineStartOffset(lineIndex) + rawInLine;
}

/* Is the raw range [start, end] fully inside one inline span of `type` on a
   single line? Returns that span's absolute raw/inner offsets, or null.
   Used both to decide toolbar button active state and to decide what a
   toolbar click should do (unwrap vs. split-at-cursor vs. wrap). */
function findEnclosingInlineSpan(type, start, end) {
  const from = lineAndOffsetForAbsolute(start);
  const to = lineAndOffsetForAbsolute(end);
  if (from.line !== to.line) return null;

  const lineText = markdownText.split("\n")[from.line];
  const ast = parseBlock(lineText);
  const relStart = from.offset - ast.prefixEnd;
  const relEnd = to.offset - ast.prefixEnd;
  if (relStart < 0 || relEnd < 0) return null;

  const content = lineText.slice(ast.prefixEnd);
  const node = parseInline(content).find(
    (n) => n.type === type && n.innerStart <= relStart && n.innerEnd >= relEnd,
  );
  if (!node) return null;

  const base = lineStartOffset(from.line) + ast.prefixEnd;
  return {
    rawStart: base + node.rawStart,
    rawEnd: base + node.rawEnd,
    innerStart: base + node.innerStart,
    innerEnd: base + node.innerEnd,
  };
}

/* ─── Rich mode: rendering ───
   focusedLine is the line index that should render fully raw (or -1). */

function richRenderAll(focusedLine) {
  const lines = markdownText.split("\n");
  _richEl.innerHTML = "";
  _lineEls = [];
  _lineMappings = [];
  _focusedLine = focusedLine;
  lines.forEach((lineText, i) => {
    const container = document.createElement("div");
    container.className = "doc-line";
    const { frag, mapping } = renderLine(lineText, i === focusedLine);
    container.appendChild(frag);
    _richEl.appendChild(container);
    _lineEls.push(container);
    _lineMappings.push(mapping);
  });
}

/* Re-render just one line in place (used when focus moves between lines —
   far cheaper, and far less disruptive, than rebuilding the whole document
   on every keystroke). */
function rerenderSingleLine(index, isFocused) {
  const container = _lineEls[index];
  if (!container) return;
  const lineText = markdownText.split("\n")[index] ?? "";
  container.innerHTML = "";
  const { frag, mapping } = renderLine(lineText, isFocused);
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
   after the inserted text. Used for structural edits (Enter, line merges,
   paste, toolbar actions) — NOT for ordinary typing, which the browser
   handles natively (see richHandleInput). */
function richApplyEdit(start, end, text, selStart, selEnd) {
  markdownText = markdownText.slice(0, start) + text + markdownText.slice(end);
  scheduleRichChangeCallbacks();

  const finalStart = selStart != null ? selStart : start + text.length;
  const finalEnd = selEnd != null ? selEnd : finalStart;
  const from = lineAndOffsetForAbsolute(finalStart);
  const to = lineAndOffsetForAbsolute(finalEnd);

  richRenderAll(from.line);

  if (from.line === to.line) {
    placeCaretRangeInLine(_lineEls[from.line], _lineMappings[from.line], from.offset, to.offset);
  } else {
    placeCaretInLine(_lineEls[from.line], _lineMappings[from.line], from.offset);
  }
  updateToolbarActiveStates();
}

/* Mirrors the focused line's live (natively-edited) text into markdownText.
   Fires on every native `input` — including every step of IME composition —
   but never touches the DOM itself, so it can't disrupt an edit in
   progress. The focused line is always exactly one plain text node (see
   renderer.js), so its container's textContent IS the raw line text. */
function richHandleInput() {
  if (!richMode || _focusedLine === -1) return;
  const container = _lineEls[_focusedLine];
  if (!container) return;
  const lines = markdownText.split("\n");
  if (lines[_focusedLine] === container.textContent) return;
  lines[_focusedLine] = container.textContent;
  markdownText = lines.join("\n");
  scheduleRichChangeCallbacks();
}

/* Enter is handled at keydown, unconditionally (including mid-IME-
   composition — you can't compose a Hangul syllable across a line break
   anyway, so finalizing it here is correct, not disruptive). This is also
   just a more robust way to own this specific key than relying on
   beforeinput's "insertParagraph" alone. */
function richHandleKeyDown(e) {
  if (!richMode || e.key !== "Enter") return;
  e.preventDefault();
  const { start, end } = richGetSelectionOffsets();
  if (start == null) return;
  richApplyEdit(start, end, "\n");
}

function richHandleBeforeInput(e) {
  if (!richMode) return;

  switch (e.inputType) {
    case "insertParagraph":
    case "insertLineBreak":
      // Normally already handled by richHandleKeyDown; kept as a fallback.
      e.preventDefault();
      {
        const { start, end } = richGetSelectionOffsets();
        if (start != null) richApplyEdit(start, end, "\n");
      }
      return;

    case "insertFromPaste":
    case "insertFromDrop": {
      e.preventDefault();
      const { start, end } = richGetSelectionOffsets();
      if (start == null) return;
      const text = e.dataTransfer ? e.dataTransfer.getData("text/plain") : e.data || "";
      richApplyEdit(start, end, text);
      return;
    }

    case "deleteContentBackward": {
      const { start, end } = richGetSelectionOffsets();
      if (start == null || start !== end) return; // let native handle deleting a real selection
      const { line, offset } = lineAndOffsetForAbsolute(start);
      if (offset === 0 && line > 0) {
        // Start of a non-first line: merge with the previous one. Native
        // contenteditable's own cross-block backspace behavior is exactly
        // the kind of thing that's inconsistent across browsers, so this
        // one boundary case stays intercepted.
        e.preventDefault();
        richApplyEdit(start - 1, start, "");
      }
      // Otherwise: an ordinary in-place delete — let the browser handle it.
      return;
    }

    case "deleteContentForward": {
      const { start, end } = richGetSelectionOffsets();
      if (start == null || start !== end) return;
      const lines = markdownText.split("\n");
      const { line, offset } = lineAndOffsetForAbsolute(start);
      if (offset === lines[line].length && line < lines.length - 1) {
        e.preventDefault();
        richApplyEdit(start, start + 1, "");
      }
      return;
    }

    default:
      // insertText, insertCompositionText, deleteWordBackward/Forward, etc:
      // left entirely to the browser's native editing within the focused
      // line's plain text node. richHandleInput resyncs markdownText.
      return;
  }
}

/* Switch which line renders raw (focused) vs. styled. Touches at most two
   lines — never the whole document, never mid-typing. */
function switchFocusedLine(idx) {
  if (idx === _focusedLine) return;
  const oldLine = _focusedLine;
  _focusedLine = idx;
  if (oldLine >= 0 && oldLine < _lineEls.length) rerenderSingleLine(oldLine, false);
  rerenderSingleLine(idx, true);
}

/* Caret moved (keyboard navigation, or any other selection change not
   already handled at mousedown). If it landed on a different line, swap
   which one renders raw vs. styled. */
function richHandleSelectionChange() {
  if (!richMode || !_richEl) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!_richEl.contains(range.startContainer)) return;
  if (!range.collapsed) return; // don't disturb an active text selection

  const idx = resolveLineIndex(range.startContainer, range.startOffset);
  if (idx === -1) return;

  if (idx === _focusedLine) {
    updateToolbarActiveStates();
    return;
  }

  const offset = rawOffsetFromCaret(_lineMappings[idx], range.startContainer, range.startOffset) ?? 0;
  switchFocusedLine(idx);
  placeCaretInLine(_lineEls[idx], _lineMappings[idx], offset);
  updateToolbarActiveStates();
}

/* Precompute the click target ourselves (before the browser's own default
   mousedown handling runs) and convert that line to its plain, editable raw
   form right away. By the time the browser actually places its native
   caret, the line already looks the way it's going to — so that placement
   just lands correctly the first time, with no rebuild racing behind it. */
function richHandleMouseDown(e) {
  if (!richMode) return;
  // Clicking a decorative, non-editable control (the checklist checkbox) is
  // a toggle action, not "start editing this line" — suppress the browser's
  // own default entirely so it can't plant a selection on this line either
  // (which would otherwise make richHandleSelectionChange flip the line
  // into raw/editing mode right after the toggle, undoing it visually).
  // richHandleClick's checkbox handler still runs — preventDefault on
  // mousedown doesn't stop the later click event.
  if (e.target.closest(".md-checkbox")) {
    e.preventDefault();
    return;
  }
  let node, offset;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (!pos) return;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    return;
  }
  const idx = resolveLineIndex(node, offset);
  if (idx === -1) return;

  // Compute the raw offset against the mapping as it exists right now
  // (pre-conversion), then convert and place the caret ourselves. We also
  // preventDefault so the browser doesn't additionally try to place its own
  // caret afterward — for a short/empty line that has no real clickable
  // surface, its own hit-testing can land one level too high (as a child
  // index on the line's container rather than inside the text node),
  // which is exactly the "characters get typed outside the line" bug this
  // replaces.
  const rawOffset = rawOffsetFromCaret(_lineMappings[idx], node, offset) ?? 0;
  e.preventDefault();
  switchFocusedLine(idx);
  placeCaretInLine(_lineEls[idx], _lineMappings[idx], rawOffset);
  _richEl.focus();
}

/* ─── Rich mode: toolbar actions (called from js/markdown.js) ─── */

const MARK_TYPE_BY_DELIM = { "**": "bold", "*": "italic", "~~": "strike", "`": "code" };

function richWrapSelection(before, after = before) {
  const { start, end } = richGetSelectionOffsets();
  if (start == null) return;

  const type = MARK_TYPE_BY_DELIM[before];
  const existing = type ? findEnclosingInlineSpan(type, start, end) : null;

  if (existing) {
    if (start === end) {
      // Collapsed caret inside already-formatted text: split it into two
      // adjacent, complete spans right at the cursor. Existing text on
      // both sides keeps its formatting; new typing from here on doesn't
      // (Word/한글-style "turn this off from here").
      const seam = after + before;
      const caretPos = start + after.length;
      richApplyEdit(start, start, seam, caretPos, caretPos);
      return;
    }
    // A real selection sits inside one formatted run: remove that whole
    // span's markers (this is the "click Bold again to turn it off" case).
    const innerText = markdownText.slice(existing.innerStart, existing.innerEnd);
    richApplyEdit(
      existing.rawStart,
      existing.rawEnd,
      innerText,
      existing.rawStart,
      existing.rawStart + innerText.length,
    );
    return;
  }

  const selected = markdownText.slice(start, end);
  const replacement = before + selected + after;
  const selStart = start + before.length;
  const selEnd = selStart + selected.length;
  richApplyEdit(start, end, replacement, selStart, selEnd);
}

/* Checkbox click: toggle "- [ ] " <-> "- [x] " for that line. This is a
   click on a decorative control, not the start of an edit — unlike
   richApplyEdit (used for actual text edits), it must NOT flip the line
   into focused/raw mode, or the checkbox would visually "come undone"
   into plain raw text right after every toggle. Whatever line the user
   was actually editing (if any) is left completely alone. */
function richToggleChecklistAt(box) {
  const lineEl = box.closest(".doc-line");
  const index = _lineEls.indexOf(lineEl);
  if (index === -1) return;
  const lines = markdownText.split("\n");
  const lineText = lines[index];
  const ast = parseBlock(lineText);
  if (ast.type !== "checklist") return;
  lines[index] = (ast.checked ? "- [ ] " : "- [x] ") + lineText.slice(ast.prefixEnd);
  markdownText = lines.join("\n");
  scheduleRichChangeCallbacks();
  rerenderSingleLine(index, false);
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
