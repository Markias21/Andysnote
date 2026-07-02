/* ─── MARKDOWN FORMATTING ──────────────────────────────────────────────────
   Lightweight text-transform toolbar actions. Each function inserts or removes
   Markdown syntax around the current selection or on the current line.

   Storage format remains plain text (.txt). No live preview, no HTML injection.
   The user sees raw Markdown syntax — human-readable and portable.

   Each formatting action is a standalone function. No shared state, no registry,
   no plugin system — just direct text transforms. */

/* ── Inline formatting ── */

function mdWrapSelection(before, after = before) {
  const body = document.getElementById("doc-body");
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  if (!body.contains(range.startContainer)) return;

  const selectedText = range.toString();

  if (!selectedText) {
    // No selection: insert markers and place cursor between them
    const textNode = document.createTextNode(before + after);
    range.insertNode(textNode);

    const newRange = document.createRange();
    newRange.setStart(textNode, before.length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    body.focus();
    onBodyInput();
    return;
  }

  // Toggle: if already wrapped, unwrap; otherwise wrap
  const alreadyWrapped =
    selectedText.startsWith(before) && selectedText.endsWith(after);
  const newText = alreadyWrapped
    ? selectedText.slice(before.length, -after.length)
    : before + selectedText + after;

  range.deleteContents();
  const newNode = document.createTextNode(newText);
  range.insertNode(newNode);

  // Reselect the content (without markers if we just wrapped)
  const newRange = document.createRange();
  if (alreadyWrapped) {
    newRange.selectNodeContents(newNode);
  } else {
    newRange.setStart(newNode, before.length);
    newRange.setEnd(newNode, newText.length - after.length);
  }
  sel.removeAllRanges();
  sel.addRange(newRange);

  body.focus();
  onBodyInput();
}

function mdBold()       { mdWrapSelection("**", "**"); }
function mdItalic()     { mdWrapSelection("*", "*"); }
function mdStrike()     { mdWrapSelection("~~", "~~"); }
function mdInlineCode() { mdWrapSelection("`", "`"); }

/* ── Block formatting ── */

function mdGetCurrentBlock() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  const body = document.getElementById("doc-body");
  if (!body.contains(node)) return null;
  while (node && node.id !== "doc-body") {
    if (node.parentElement?.id === "doc-body") return node;
    node = node.parentElement;
  }
  return null;
}

const MD_BLOCK_PREFIXES = ["# ", "> ", "- ", "- [ ] ", "- [x] "];

function mdStripBlockPrefix(text) {
  const numMatch = text.match(/^(\d+)\.\s/);
  if (numMatch) return { text: text.slice(numMatch[0].length), type: "num" };
  for (const p of MD_BLOCK_PREFIXES) {
    if (text.startsWith(p)) return { text: text.slice(p.length), type: "other" };
  }
  if (text === "---") return { text: "", type: "divider" };
  if (text === "```") return { text: "", type: "codeblock" };
  return { text, type: null };
}

function mdToggleBlockPrefix(prefix) {
  const block = mdGetCurrentBlock();
  if (!block) return;

  const text = block.textContent;
  const stripped = mdStripBlockPrefix(text);
  const hasThisPrefix = text.startsWith(prefix);

  const newText = hasThisPrefix ? stripped.text : prefix + stripped.text;
  block.textContent = newText;

  const sel = window.getSelection();
  const range = document.createRange();
  const textNode = block.firstChild;
  const cursorPos = hasThisPrefix ? 0 : prefix.length;
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, Math.min(cursorPos, textNode.length));
  } else {
    range.setStart(block, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  document.getElementById("doc-body").focus();
  onBodyInput();
}

function mdHeading()    { mdToggleBlockPrefix("# "); }
function mdQuote()      { mdToggleBlockPrefix("> "); }
function mdBulletList() { mdToggleBlockPrefix("- "); }
function mdChecklist()  { mdToggleBlockPrefix("- [ ] "); }

function mdNumberList() {
  const block = mdGetCurrentBlock();
  if (!block) return;

  const text = block.textContent;
  const numMatch = text.match(/^(\d+)\.\s/);

  const newText = numMatch
    ? text.slice(numMatch[0].length)
    : "1. " + mdStripBlockPrefix(text).text;

  block.textContent = newText;

  const sel = window.getSelection();
  const range = document.createRange();
  const textNode = block.firstChild;
  const cursorPos = numMatch ? 0 : "1. ".length;
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, Math.min(cursorPos, textNode.length));
  } else {
    range.setStart(block, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  document.getElementById("doc-body").focus();
  onBodyInput();
}

function mdDivider() {
  const block = mdGetCurrentBlock();
  if (!block) return;

  const text = block.textContent.trim();
  block.textContent = text === "---" ? "" : "---";

  document.getElementById("doc-body").focus();
  onBodyInput();
}

function mdCodeBlock() {
  const block = mdGetCurrentBlock();
  if (!block) return;

  const text = block.textContent.trim();
  block.textContent = text === "```" ? "" : "```";

  document.getElementById("doc-body").focus();
  onBodyInput();
}
