/* ─── CURSOR UTILITIES ──────────────────────────────────────────────────────
   Mapping between DOM cursor positions and raw-text offsets.

   getRawOffset(blockDiv, rawText) → number | null
     Computes the character offset within rawText that corresponds
     to the current cursor position inside blockDiv.

   setCursorInBlock(blockDiv, rawOffset, rawText) → void
     Places the cursor at the given raw-text offset inside blockDiv.
     Works whether the block is raw (text node) or rendered (mixed DOM). */

function getRawOffset(blockDiv, rawText) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);

  // If block is in raw mode, it's a single text node — easy.
  if (blockDiv.classList.contains("md-raw")) {
    const textNode = blockDiv.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      return Math.min(range.startOffset, textNode.length);
    }
    return 0;
  }

  // Rendered mode: walk all text nodes and accumulate offsets.
  const textNodes = [];
  const it = document.createNodeIterator(blockDiv, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = it.nextNode())) textNodes.push(n);

  let domOffset = 0;
  let rawOffset = 0;

  // Pre-compute raw offset for each text node using the mapping
  const mapping = blockDiv._mapping || [];

  for (const node of textNodes) {
    const nodeLen = node.length;
    const parent = node.parentElement;

    // Find this text node's raw offset range from the mapping
    let nodeRawStart = rawOffset;
    let nodeRawEnd = rawOffset + nodeLen;

    for (const m of mapping) {
      if (m.el === node || m.el === parent || (m.el.contains && m.el.contains(parent))) {
        // This text node belongs to a mapped inline node (including plain
        // text nodes, where m.el is the TextNode itself).
        nodeRawStart = m.rawStart + (domOffset - getDomOffsetOfNode(node, blockDiv));
        nodeRawEnd = m.rawEnd;
        break;
      }
    }

    if (node === range.startContainer) {
      const rel = range.startOffset;
      return Math.min(nodeRawStart + rel, rawText.length);
    }

    domOffset += nodeLen;
    rawOffset = nodeRawEnd;
  }

  // Cursor is after all text nodes
  return rawText.length;
}

function setCursorInBlock(blockDiv, rawOffset, rawText) {
  const sel = window.getSelection();
  const range = document.createRange();

  // Raw mode: single text node
  if (blockDiv.classList.contains("md-raw")) {
    const textNode = blockDiv.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      range.setStart(textNode, Math.min(rawOffset, textNode.length));
    } else {
      range.setStart(blockDiv, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  // Rendered mode: walk text nodes, map raw offsets
  const textNodes = [];
  const it = document.createNodeIterator(blockDiv, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = it.nextNode())) textNodes.push(n);

  const mapping = blockDiv._mapping || [];
  let domOffset = 0;
  let currentRawOffset = 0;

  for (const node of textNodes) {
    const nodeLen = node.length;
    const parent = node.parentElement;

    let nodeRawStart = currentRawOffset;
    let nodeRawLen = nodeLen;

    for (const m of mapping) {
      if (m.el === node || m.el === parent || (m.el.contains && m.el.contains(parent))) {
        nodeRawStart = m.rawStart + (domOffset - getDomOffsetOfNode(node, blockDiv));
        nodeRawLen = m.rawEnd - nodeRawStart;
        break;
      }
    }

    if (rawOffset >= nodeRawStart && rawOffset <= nodeRawStart + nodeRawLen) {
      const rel = rawOffset - nodeRawStart;
      range.setStart(node, Math.min(rel, nodeLen));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }

    domOffset += nodeLen;
    currentRawOffset = nodeRawStart + nodeRawLen;
  }

  // Past the end: place at end of last text node, or start of div
  if (textNodes.length) {
    const last = textNodes[textNodes.length - 1];
    range.setStart(last, last.length);
  } else {
    range.setStart(blockDiv, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* Helper: get character offset of a text node within its block. */
function getDomOffsetOfNode(targetNode, blockDiv) {
  let offset = 0;
  const it = document.createNodeIterator(blockDiv, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = it.nextNode())) {
    if (n === targetNode) return offset;
    offset += n.length;
  }
  return offset;
}
