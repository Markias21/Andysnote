/* ─── MARKDOWN ENGINE ─────────────────────────────────────────────────────
   Owns the text. Knows nothing about the DOM or the editor.

   parseBlock(rawText) → AST
   generateText(ast)    → rawText  (round-trip check)

   The AST preserves the raw text so the renderer can store it for
   cursor mapping. Each AST node carries its position in the raw
   string so the renderer can build offset mappings. */

/* ─── Block-level parser ─── */

function parseBlock(text) {
  const raw = text;
  let offset = 0;

  if (text.startsWith("# ")) {
    offset = 2;
    return { type: "heading", level: 1, raw, offset, content: parseInline(text.slice(offset), offset) };
  }
  if (text.startsWith("## ")) {
    offset = 3;
    return { type: "heading", level: 2, raw, offset, content: parseInline(text.slice(offset), offset) };
  }
  if (text.startsWith("### ")) {
    offset = 4;
    return { type: "heading", level: 3, raw, offset, content: parseInline(text.slice(offset), offset) };
  }
  if (text.startsWith("> ")) {
    offset = 2;
    return { type: "quote", raw, offset, content: parseInline(text.slice(offset), offset) };
  }
  if (text === "---" || text === "***" || text === "___") {
    return { type: "divider", raw };
  }
  if (text.startsWith("```")) {
    return { type: "codeblock", lang: text.slice(3).trim(), raw };
  }
  if (text.startsWith("- [ ] ")) {
    offset = 6;
    return { type: "checklist", checked: false, raw, offset, content: parseInline(text.slice(offset), offset) };
  }
  if (text.startsWith("- [x] ") || text.startsWith("- [X] ")) {
    offset = 6;
    return { type: "checklist", checked: true, raw, offset, content: parseInline(text.slice(offset), offset) };
  }
  if (text.startsWith("- ")) {
    offset = 2;
    return { type: "list", raw, offset, content: parseInline(text.slice(offset), offset) };
  }
  const numMatch = text.match(/^(\d+)\.\s/);
  if (numMatch) {
    offset = numMatch[0].length;
    return { type: "numbered", num: parseInt(numMatch[1]), raw, offset, content: parseInline(text.slice(offset), offset) };
  }

  return { type: "paragraph", raw, offset: 0, content: parseInline(text, 0) };
}

/* ─── Inline parser ───
   Returns an array of { type, text, rawStart, rawEnd }.
   rawStart/rawEnd are offsets within the FULL block text, not just
   the inline portion. */

function parseInline(text, baseOffset) {
  const nodes = [];
  const patterns = [
    { regex: /\*\*(.+?)\*\*/g, type: "bold", prefix: "**", suffix: "**" },
    { regex: /\*(.+?)\*/g, type: "italic", prefix: "*", suffix: "*" },
    { regex: /~~(.+?)~~/g, type: "strike", prefix: "~~", suffix: "~~" },
    { regex: /`(.+?)`/g, type: "code", prefix: "`", suffix: "`" },
  ];

  const matches = [];
  for (const p of patterns) {
    const regex = new RegExp(p.regex.source, p.regex.flags);
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        innerStart: m.index + p.prefix.length,
        innerEnd: m.index + m[0].length - p.suffix.length,
        text: m[1],
        type: p.type,
      });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  // Remove overlapping matches (first-come wins)
  const filtered = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  let pos = 0;
  for (const m of filtered) {
    if (pos < m.start) {
      nodes.push({ type: "text", text: text.slice(pos, m.start), rawStart: baseOffset + pos, rawEnd: baseOffset + m.start });
    }
    nodes.push({ type: m.type, text: m.text, rawStart: baseOffset + m.innerStart, rawEnd: baseOffset + m.innerEnd });
    pos = m.end;
  }
  if (pos < text.length) {
    nodes.push({ type: "text", text: text.slice(pos), rawStart: baseOffset + pos, rawEnd: baseOffset + text.length });
  }
  if (nodes.length === 0 && text) {
    nodes.push({ type: "text", text, rawStart: baseOffset, rawEnd: baseOffset + text.length });
  }

  return nodes;
}

/* ─── Generate raw text from AST (for round-trip verification) ─── */

function generateText(ast) {
  if (!ast.content) return ast.raw;
  let text = "";
  for (const n of ast.content) {
    if (n.type === "text") text += n.text;
    if (n.type === "bold") text += "**" + n.text + "**";
    if (n.type === "italic") text += "*" + n.text + "*";
    if (n.type === "strike") text += "~~" + n.text + "~~";
    if (n.type === "code") text += "`" + n.text + "`";
  }
  const prefix = getBlockPrefix(ast);
  return prefix + text;
}

function getBlockPrefix(ast) {
  switch (ast.type) {
    case "heading": return "#".repeat(ast.level) + " ";
    case "quote": return "> ";
    case "list": return "- ";
    case "checklist": return ast.checked ? "- [x] " : "- [ ] ";
    case "numbered": return ast.num + ". ";
    case "divider": return ast.raw;
    case "codeblock": return ast.raw;
    default: return "";
  }
}
