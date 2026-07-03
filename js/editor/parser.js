/* ─── MARKDOWN ENGINE ─────────────────────────────────────────────────────
   Pure parsing. Knows nothing about the DOM, the cursor, or the editor.
   Used by the Renderer to decide what to draw for a line, and by the
   Editor's toolbar actions to toggle syntax on the current line.

   parseBlock(lineText)  -> block descriptor (type + prefix length)
   parseInline(text)     -> array of inline nodes covering `text` end-to-end

   All offsets are relative to the string that was passed in. */

const MD_BLOCK_TYPES_LINE_LEVEL = [
  "heading",
  "quote",
  "bullet",
  "checklist",
  "numbered",
  "divider",
  "codeblock",
];

function parseBlock(text) {
  if (text.startsWith("### "))
    return { type: "heading", level: 3, prefixEnd: 4 };
  if (text.startsWith("## "))
    return { type: "heading", level: 2, prefixEnd: 3 };
  if (text.startsWith("# "))
    return { type: "heading", level: 1, prefixEnd: 2 };
  if (text.startsWith("> ")) return { type: "quote", prefixEnd: 2 };
  if (text === "---" || text === "***" || text === "___")
    return { type: "divider", prefixEnd: text.length };
  if (text.startsWith("```"))
    return { type: "codeblock", lang: text.slice(3).trim(), prefixEnd: text.length };
  if (text.startsWith("- [ ] "))
    return { type: "checklist", checked: false, prefixEnd: 6 };
  if (/^- \[x\] /i.test(text))
    return { type: "checklist", checked: true, prefixEnd: 6 };
  if (text.startsWith("- ")) return { type: "bullet", prefixEnd: 2 };
  const numMatch = text.match(/^(\d+)\.\s/);
  if (numMatch)
    return { type: "numbered", num: parseInt(numMatch[1]), prefixEnd: numMatch[0].length };
  return { type: "paragraph", prefixEnd: 0 };
}

/* ── Inline parser ───
   Returns nodes covering `text` end-to-end (no gaps):
     { type: "text", rawStart, rawEnd, text }
     { type: "bold"|"italic"|"strike"|"code", rawStart, rawEnd, innerStart, innerEnd, text }
   rawStart/rawEnd include the syntax markers; innerStart/innerEnd exclude them. */
function parseInline(text) {
  const patterns = [
    { regex: /\*\*(.+?)\*\*/g, type: "bold", markLen: 2 },
    // Lookaround excludes "*" that is actually part of a "**" bold marker —
    // without it, a single-* scan run on a line that already contains bold
    // text gets confused by the bold markers and swallows real italic spans.
    { regex: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, type: "italic", markLen: 1 },
    { regex: /~~(.+?)~~/g, type: "strike", markLen: 2 },
    { regex: /`(.+?)`/g, type: "code", markLen: 1 },
  ];

  const matches = [];
  for (const p of patterns) {
    const re = new RegExp(p.regex.source, p.regex.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        innerStart: m.index + p.markLen,
        innerEnd: m.index + m[0].length - p.markLen,
        text: m[1],
        type: p.type,
      });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  // Remove overlaps (first-come wins — patterns array order breaks ties,
  // e.g. "**x**" is claimed by bold before italic gets a chance at it).
  const filtered = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  const nodes = [];
  let pos = 0;
  for (const m of filtered) {
    if (pos < m.start) {
      nodes.push({ type: "text", rawStart: pos, rawEnd: m.start, text: text.slice(pos, m.start) });
    }
    nodes.push({
      type: m.type,
      rawStart: m.start,
      rawEnd: m.end,
      innerStart: m.innerStart,
      innerEnd: m.innerEnd,
      text: m.text,
    });
    pos = m.end;
  }
  if (pos < text.length) {
    nodes.push({ type: "text", rawStart: pos, rawEnd: text.length, text: text.slice(pos) });
  }
  if (nodes.length === 0) {
    nodes.push({ type: "text", rawStart: 0, rawEnd: text.length, text });
  }
  return nodes;
}
