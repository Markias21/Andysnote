/* ─── EDITOR ENGINE ────────────────────────────────────────────────────────
   Orchestrates Model → Markdown Engine → Renderer → DOM → Events.

   State:
     _model      – TextModel instance
     _activeIdx  – which block is currently being edited (raw mode)
     _lastActive – previous active block (for restoring styled rendering)

   Flow:
   1. openDoc(text) creates a new model, renders all styled
   2. onFocusInBlock(index) switches that block to raw mode
   3. onInput() reads block.innerText, updates model, keeps raw
   4. onBlurOrLeaveBlock(index) switches block back to styled
   5. getText() returns model.getText() for save

   The engine handles cursor mapping: when switching raw↔styled,
   it computes the raw-text offset before the switch and restores
   it after, so the cursor never jumps. */

let _editorModel = null;
let _editorActiveIdx = -1;
let _editorBodyEl = null;

/* ─── Public API ─── */

function editorOpen(text) {
  _editorModel = new TextModel(text);
  _editorActiveIdx = -1;
  _editorBodyEl = document.getElementById("doc-body");

  _editorBodyEl.setAttribute("contenteditable", "true");
  renderBody(_editorBodyEl, _editorModel, -1);

  // Wire focus tracking only once
  if (!_editorBodyEl._editorWired) {
    _editorBodyEl.addEventListener("focusin", _onFocusIn);
    _editorBodyEl.addEventListener("focusout", _onFocusOut);
    _editorBodyEl.addEventListener("input", _onInput);
    _editorBodyEl.addEventListener("keydown", _onKeyDown);
    _editorBodyEl._editorWired = true;
  }

  updateWordCount();
}

function editorGetText() {
  if (!_editorModel) return "";
  return _editorModel.getText();
}

function editorSetText(text) {
  _editorModel = new TextModel(text);
  _editorActiveIdx = -1;
  if (_editorBodyEl) renderBody(_editorBodyEl, _editorModel, -1);
  updateWordCount();
}

/* ─── Event handlers ─── */

function _onFocusIn(e) {
  let block = _findBlockAncestor(e.target);
  // Clicking directly on the body (padding area, empty doc, placeholder)
  if (!block && e.target.id === "doc-body" && _editorBodyEl.children.length) {
    block = _editorBodyEl.children[0];
  }
  if (!block) return;
  const idx = Array.from(_editorBodyEl.children).indexOf(block);
  if (idx === -1) return;

  if (_editorActiveIdx !== -1 && _editorActiveIdx !== idx) {
    _renderBlockStyled(_editorActiveIdx);
  }

  _editorActiveIdx = idx;
  const rawText = _editorModel.getBlock(idx);

  // Save cursor offset BEFORE switching to raw
  const offset = getRawOffset(block, rawText);

  // Switch to raw
  const ast = parseBlock(rawText);
  renderBlock(block, ast, true);

  // Restore cursor
  if (offset !== null) {
    setCursorInBlock(block, offset, rawText);
  }
}

function _onFocusOut(e) {
  // Delay so that if focus moves to another block in the same body,
  // focusin fires first and we don't incorrectly style it.
  setTimeout(() => {
    const activeEl = document.activeElement;
    if (!_editorBodyEl.contains(activeEl) && _editorActiveIdx !== -1) {
      _renderBlockStyled(_editorActiveIdx);
      _editorActiveIdx = -1;
    }
  }, 0);
}

function _onInput(e) {
  if (_editorActiveIdx === -1) return;

  const block = _editorBodyEl.children[_editorActiveIdx];
  if (!block) return;

  // Remove empty placeholder once the user starts typing
  if (_editorBodyEl.classList.contains("empty") && block.innerText.trim()) {
    _editorBodyEl.classList.remove("empty");
  }

  // Read raw text from the currently-editing block
  const rawText = block.innerText;
  _editorModel.setBlock(_editorActiveIdx, rawText);

  // Keep it raw — the user is still typing here
  // Don't re-render; the browser handles the DOM mutation natively
  updateWordCount();

  // Trigger autosave
  if (storageMode === "local" && currentFileId) scheduleLocalSave();
  else if (driveAccessToken && currentFileId) scheduleDriveSave();
}

function _onKeyDown(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    _handleEnter();
    return;
  }
}

/* ─── Enter handling ───
   Split the current block at the cursor position. */
function _handleEnter() {
  if (_editorActiveIdx === -1) return;

  const block = _editorBodyEl.children[_editorActiveIdx];
  const rawText = _editorModel.getBlock(_editorActiveIdx);
  const offset = getRawOffset(block, rawText);
  if (offset === null) return;

  const before = rawText.slice(0, offset);
  const after = rawText.slice(offset);

  // Update current block
  _editorModel.setBlock(_editorActiveIdx, before);
  block.innerText = before;

  // Insert new block after
  _editorModel.insertBlock(_editorActiveIdx + 1, after);
  const newDiv = document.createElement("div");
  newDiv.innerText = after;
  block.after(newDiv);

  // Move focus to new block
  _editorActiveIdx++;

  // Place cursor at start of new block
  const sel = window.getSelection();
  const range = document.createRange();
  const textNode = newDiv.firstChild;
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, 0);
  } else {
    range.setStart(newDiv, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  newDiv.focus();

  updateWordCount();
}

/* ─── Helpers ─── */

function _renderBlockStyled(idx) {
  const block = _editorBodyEl.children[idx];
  if (!block) return;
  const rawText = _editorModel.getBlock(idx);

  // Save cursor offset
  const offset = getRawOffset(block, rawText);

  const ast = parseBlock(rawText);
  renderBlock(block, ast, false);

  // Cursor is leaving — no need to restore it
}

function _findBlockAncestor(el) {
  while (el && el.id !== "doc-body") {
    if (el.parentElement?.id === "doc-body") return el;
    el = el.parentElement;
  }
  return null;
}
