/* ─── RENDERER ────────────────────────────────────────────────────────────
   Turns one line of raw Markdown text into DOM + a raw-offset mapping.
   Never mutates markdownText, never touches the selection, never depends
   on cursor position — once a pattern is recognized it renders styled with
   its syntax hidden, full stop (no "reveal raw text on focus" mode).

   renderLine(text, oldText) -> { frag, mapping }
     text    – raw text of this single line, right now
     oldText – this same line's text right before the edit that produced
               `text` (or null/undefined if unknown, e.g. on first paint).
               Used only to decide whether a block prefix (heading/quote/
               list/...) that just became recognizable is safe to collapse
               immediately: safe if the line already had this same block
               type, or if there's no content after the prefix yet. This
               stops "> " typed at the front of an existing paragraph from
               retroactively swallowing that paragraph's text.

   mapping is an array of { node, rawStart, rawEnd } in document order,
   one entry per text node placed in `frag`. It always covers the FULL
   raw text of the line (hidden syntax markers included, just visually
   collapsed via CSS) so the raw text can always be recovered by reading
   the line's textContent and so the caret can always be mapped back to
   a raw offset regardless of which spans are collapsed. */

function renderLine(text, oldText) {
  const frag = document.createDocumentFragment();
  const mapping = [];

  function addText(str, rawStart, rawEnd, parent) {
    const node = document.createTextNode(str);
    (parent || frag).appendChild(node);
    mapping.push({ node, rawStart, rawEnd });
  }

  function addMark(str, rawStart, rawEnd, parent) {
    const span = document.createElement("span");
    span.className = "md-mark";
    const node = document.createTextNode(str);
    span.appendChild(node);
    (parent || frag).appendChild(span);
    mapping.push({ node, rawStart, rawEnd });
  }

  // Render inline spans (bold/italic/strike/code) of `content`, which lives
  // at `offset` within the full line. Always collapsed once recognized —
  // there is no "active span" exception anymore.
  function addInline(content, offset, parent) {
    const inline = parseInline(content);
    for (const node of inline) {
      const rawStart = offset + node.rawStart;
      const rawEnd = offset + node.rawEnd;
      if (node.type === "text") {
        addText(node.text, rawStart, rawEnd, parent);
        continue;
      }
      const innerStart = offset + node.innerStart;
      const innerEnd = offset + node.innerEnd;
      const tag = { bold: "strong", italic: "em", strike: "s", code: "code" }[node.type];
      // Build the prefix mark and the element (with its text already inside)
      // before appending either to `parent`, so DOM order comes out as
      // prefix-mark, element, suffix-mark instead of element-then-marks.
      addMark(content.slice(node.rawStart, node.innerStart), rawStart, innerStart, parent);
      const el = document.createElement(tag);
      addText(node.text, innerStart, innerEnd, el);
      (parent || frag).appendChild(el);
      addMark(content.slice(node.innerEnd, node.rawEnd), innerEnd, rawEnd, parent);
    }
  }

  const ast = parseBlock(text);

  if (MD_BLOCK_TYPES_LINE_LEVEL.includes(ast.type) && !shouldStyleBlock(ast, text, oldText)) {
    // Not (yet) safe to collapse — e.g. "> " just got stuck in front of an
    // existing populated paragraph. Show the untouched raw line instead of
    // guessing.
    addText(text, 0, text.length, frag);
    return { frag, mapping };
  }

  const lineDiv = document.createElement("div");
  lineDiv.className = "md-block md-" + ast.type;

  switch (ast.type) {
    case "heading": {
      addMark(text.slice(0, ast.prefixEnd), 0, ast.prefixEnd, lineDiv);
      const h = document.createElement("span");
      h.className = "md-heading md-h" + ast.level;
      lineDiv.appendChild(h);
      addInline(text.slice(ast.prefixEnd), ast.prefixEnd, h);
      break;
    }
    case "quote": {
      addMark(text.slice(0, ast.prefixEnd), 0, ast.prefixEnd, lineDiv);
      const q = document.createElement("span");
      q.className = "md-quote-text";
      lineDiv.appendChild(q);
      addInline(text.slice(ast.prefixEnd), ast.prefixEnd, q);
      break;
    }
    case "bullet": {
      addMark(text.slice(0, ast.prefixEnd), 0, ast.prefixEnd, lineDiv);
      const dot = document.createElement("span");
      dot.className = "md-bullet-dot";
      dot.textContent = "•";
      dot.contentEditable = "false";
      lineDiv.appendChild(dot);
      addInline(text.slice(ast.prefixEnd), ast.prefixEnd, lineDiv);
      break;
    }
    case "checklist": {
      addMark(text.slice(0, ast.prefixEnd), 0, ast.prefixEnd, lineDiv);
      const box = document.createElement("span");
      box.className = "md-checkbox" + (ast.checked ? " checked" : "");
      box.textContent = ast.checked ? "☑" : "☐";
      box.contentEditable = "false";
      lineDiv.appendChild(box);
      const span = document.createElement("span");
      if (ast.checked) span.className = "md-checked-text";
      lineDiv.appendChild(span);
      addInline(text.slice(ast.prefixEnd), ast.prefixEnd, span);
      break;
    }
    case "numbered": {
      addMark(text.slice(0, ast.prefixEnd), 0, ast.prefixEnd, lineDiv);
      const label = document.createElement("span");
      label.className = "md-num-label";
      label.textContent = ast.num + ".";
      label.contentEditable = "false";
      lineDiv.appendChild(label);
      addInline(text.slice(ast.prefixEnd), ast.prefixEnd, lineDiv);
      break;
    }
    case "divider": {
      addMark(text, 0, text.length, lineDiv);
      break;
    }
    case "codeblock": {
      const label = document.createElement("span");
      label.className = "md-fence-label";
      label.textContent = ast.lang ? "‹" + ast.lang + "›" : "code";
      label.contentEditable = "false";
      lineDiv.appendChild(label);
      addMark(text, 0, text.length, lineDiv);
      break;
    }
    default: {
      addInline(text, 0, lineDiv);
    }
  }

  frag.appendChild(lineDiv);
  return { frag, mapping };
}

function shouldStyleBlock(ast, text, oldText) {
  const contentAfterPrefix = text.slice(ast.prefixEnd);
  if (!contentAfterPrefix) return true; // prefix just completed, nothing typed after it yet
  if (oldText == null) return true; // no history to compare against (e.g. doc just opened) — trust the content
  return parseBlock(oldText).type === ast.type; // was already this block type before this edit
}
