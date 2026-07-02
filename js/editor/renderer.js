/* ─── PREVIEW RENDERER ────────────────────────────────────────────────────
   Optional Markdown preview helper. It never mutates editor state.

   renderMarkdownPreview(markdownText, container)
   The editor remains a single text surface; preview is purely visual. */

function renderMarkdownPreview(markdownText, container) {
  if (!container) return;

  const escaped = String(markdownText || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  container.innerHTML = escaped.replace(/\n/g, "<br>");
}
