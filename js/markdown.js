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
  if (!body) return;

  const start = body.selectionStart;
  const end = body.selectionEnd;
  if (start == null || end == null) return;

  const selectedText = body.value.slice(start, end);
  const isWrapped = selectedText.startsWith(before) && selectedText.endsWith(after);

  const replacement = isWrapped
    ? selectedText.slice(before.length, selectedText.length - after.length)
    : before + selectedText + after;

  body.setRangeText(replacement, start, end, "end");

  const cursorStart = isWrapped ? start : start + before.length;
  const cursorEnd = isWrapped ? start + replacement.length : start + replacement.length - after.length;
  body.focus();
  body.setSelectionRange(cursorStart, cursorEnd);
  body.dispatchEvent(new Event("input", { bubbles: true }));
}

function mdBold()       { mdWrapSelection("**", "**"); }
function mdItalic()     { mdWrapSelection("*", "*"); }
function mdStrike()     { mdWrapSelection("~~", "~~"); }
function mdInlineCode() { mdWrapSelection("`", "`"); }

/* ── Block formatting ── */

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

function getEditorSelection() {
  const body = document.getElementById("doc-body");
  if (!body) return null;
  return { body, start: body.selectionStart, end: body.selectionEnd };
}

function replaceCurrentLine(transform) {
  const selection = getEditorSelection();
  if (!selection) return;

  const { body, start, end } = selection;
  const text = body.value;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = text.length;

  const lineText = text.slice(lineStart, lineEnd);
  const updated = transform(lineText);
  body.setRangeText(updated, lineStart, lineEnd, "end");
  body.focus();
  body.dispatchEvent(new Event("input", { bubbles: true }));
}

function mdToggleBlockPrefix(prefix) {
  replaceCurrentLine((text) => {
    const stripped = mdStripBlockPrefix(text);
    const hasThisPrefix = text.startsWith(prefix);
    return hasThisPrefix ? stripped.text : prefix + stripped.text;
  });
}

function mdHeading()    { mdToggleBlockPrefix("# "); }
function mdQuote()      { mdToggleBlockPrefix("> "); }
function mdBulletList() { mdToggleBlockPrefix("- "); }
function mdChecklist()  { mdToggleBlockPrefix("- [ ] "); }

function mdNumberList() {
  replaceCurrentLine((text) => {
    const numMatch = text.match(/^(\d+)\.\s/);
    return numMatch ? text.slice(numMatch[0].length) : "1. " + mdStripBlockPrefix(text).text;
  });
}

function mdDivider() {
  replaceCurrentLine((text) => (text.trim() === "---" ? "" : "---"));
}

function mdCodeBlock() {
  replaceCurrentLine((text) => (text.trim() === "```" ? "" : "```"));
}
