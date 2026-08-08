/* ─── ANDYSLETTER: PAPER / ENVELOPE / FONT LOOKUPS ─────────────────────────
   The actual list of papers/envelopes (LETTER_PAPERS/LETTER_ENVELOPES) lives
   in js/config.js next to every other AndysLetter constant — this file just
   turns that data into what js/letter/compose.js and js/letter.js need to
   render: option lists for pickers and id -> label/class lookups. The
   visual look of each paper/envelope is pure CSS (index.html's
   .letter-paper-<id> / .letter-envelope-<id> rules) — nothing here touches
   the DOM. */

function letterPaperClass(paperId) {
  const known = LETTER_PAPERS.some((p) => p.id === paperId);
  return "letter-paper-" + (known ? paperId : DEFAULT_LETTER_PAPER);
}

function letterPaperLabel(paperId) {
  const paper = LETTER_PAPERS.find((p) => p.id === paperId);
  return t(paper ? paper.labelKey : "letter.paper.plain");
}

function letterEnvelopeClass(envelopeId) {
  const known = LETTER_ENVELOPES.some((e) => e.id === envelopeId);
  return "letter-envelope-" + (known ? envelopeId : DEFAULT_LETTER_ENVELOPE);
}

function letterEnvelopeLabel(envelopeId) {
  const env = LETTER_ENVELOPES.find((e) => e.id === envelopeId);
  return t(env ? env.labelKey : "letter.envelope.cream");
}

/* [{value, label}, ...] ready for a <select>, localized. */
function letterPaperOptions() {
  return LETTER_PAPERS.map((p) => ({ value: p.id, label: t(p.labelKey) }));
}

function letterEnvelopeOptions() {
  return LETTER_ENVELOPES.map((e) => ({ value: e.id, label: t(e.labelKey) }));
}

/* Letter body font reuses the app's existing Korean handwriting/formal font
   registry (js/settings.js: EDITOR_FONTS/buildFontOptions) instead of
   shipping new font files — same 18 나눔손글씨 faces already loaded for the
   editor. An empty fontId means "use the app's default body font". */
function letterFontOptions() {
  return buildFontOptions("kr");
}

function letterFontStack(fontId) {
  if (!fontId || !EDITOR_FONTS[fontId]) return "";
  return EDITOR_FONTS[fontId].stack;
}
