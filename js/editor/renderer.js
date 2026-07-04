/* ─── RENDERER ────────────────────────────────────────────────────────────
   Turns one line of raw Markdown text into DOM + a raw-offset mapping.
   Never mutates markdownText, never touches the selection.

   renderLine(text, isFocused) -> { frag, mapping }
     text       – raw text of this single line, right now
     isFocused  – true if the caret is currently on this line. A focused
                  line renders as one plain, fully-raw text node — nothing
                  hidden, nothing styled — and is deliberately never
                  touched again until focus leaves it (see engine.js).
                  This is what makes typing, including IME composition,
                  reliable: the engine never rebuilds a text node out from
                  under an edit in progress. Styling (hidden markers, bold,
                  block types, ...) is applied the moment focus moves away,
                  based purely on the line's final content at that point —
                  same as Typora: leave a line starting with "> " and it
                  renders as a quote, regardless of how it got that way.

   mapping is an array of { node, rawStart, rawEnd } in document order,
   one entry per text node placed in `frag`. It always covers the FULL
   raw text of the line (hidden syntax markers included, just visually
   collapsed via CSS) so the raw text can always be recovered by reading
   the line's textContent and so the caret can always be mapped back to
   a raw offset regardless of which spans are collapsed. */

function renderLine(text, isFocused) {
  const frag = document.createDocumentFragment();
  const mapping = [];

  if (isFocused) {
    if (text.length === 0) {
      // A truly empty (zero-length) text node is not a reliable native
      // insertion anchor in Chromium — the very first character typed can
      // land as a stray sibling instead of inside it. A lone <br> is the
      // standard, battle-tested way browsers represent an empty
      // contenteditable line, and typing into it works correctly. It
      // contributes "" to .textContent, so richHandleInput's sync is
      // unaffected; no mapping entry is needed since there's no raw
      // content to map a caret back to (placeCaretInLine's "past the end"
      // fallback already places the caret right here).
      frag.appendChild(document.createElement("br"));
      return { frag, mapping };
    }
    const node = document.createTextNode(text);
    frag.appendChild(node);
    mapping.push({ node, rawStart: 0, rawEnd: text.length });
    return { frag, mapping };
  }

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
