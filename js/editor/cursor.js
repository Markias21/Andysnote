/* ─── CURSOR MAPPING ─────────────────────────────────────────────────────
   Converts between a DOM caret (window.getSelection()) and a raw-text
   offset within one rendered line, using the `mapping` array a Renderer
   call produced for that line: [{ node, rawStart, rawEnd }, ...] in
   document order, one entry per text node, together covering the line's
   full raw text (hidden syntax markers included). */

/* Caret is somewhere inside a line's rendered DOM. Returns the raw offset
   within that line's text, or null if the given node isn't one of ours.
   Deliberately does NOT clamp to the mapping's (possibly stale) rawEnd:
   this is also used right after IME composition has changed a text node's
   length in place, where rawStart is still valid but rawEnd is not. */
function rawOffsetFromCaret(mapping, node, domOffset) {
  for (const m of mapping) {
    if (m.node === node) return m.rawStart + domOffset;
  }
  return null;
}

function domPointForOffset(mapping, rawOffset) {
  for (const m of mapping) {
    if (rawOffset >= m.rawStart && rawOffset <= m.rawEnd) {
      return { node: m.node, rel: Math.min(rawOffset - m.rawStart, m.node.length) };
    }
  }
  return null;
}

/* Place a collapsed caret at `rawOffset` within the line rendered with
   `mapping`. Falls back to the end of the line if the offset is past
   every mapped node (e.g. an empty line). */
function placeCaretInLine(lineEl, mapping, rawOffset) {
  const sel = window.getSelection();
  const range = document.createRange();
  const point = domPointForOffset(mapping, rawOffset);

  if (point) {
    range.setStart(point.node, point.rel);
    range.collapse(true);
  } else {
    range.selectNodeContents(lineEl);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/* Select the raw range [rawStart, rawEnd] within one line (used after a
   toolbar action, to mirror the old textarea behavior of highlighting the
   just-wrapped/unwrapped text). Falls back to a collapsed caret if either
   end can't be mapped. */
function placeCaretRangeInLine(lineEl, mapping, rawStart, rawEnd) {
  const startPoint = domPointForOffset(mapping, rawStart);
  const endPoint = domPointForOffset(mapping, rawEnd);
  if (!startPoint || !endPoint) {
    placeCaretInLine(lineEl, mapping, rawStart);
    return;
  }
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.rel);
  range.setEnd(endPoint.node, endPoint.rel);
  sel.removeAllRanges();
  sel.addRange(range);
}
