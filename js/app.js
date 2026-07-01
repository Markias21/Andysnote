/* ─── INIT ─── */
document.addEventListener("DOMContentLoaded", () => {
  updateTodayDate();
  renderSidebar();
  renderCalendar();

  const body = document.getElementById("doc-body");
  body.addEventListener("focus", () => {
    if (!body.textContent.trim()) body.classList.add("empty");
  });
  body.addEventListener("blur", () => {
    if (!body.textContent.trim()) body.classList.add("empty");
  });
  body.classList.add("empty");

  const style = document.createElement("style");
  style.textContent =
    "#doc-body.empty:before { content: attr(data-placeholder);" +
    " color: var(--text-muted); pointer-events: none; }";
  document.head.appendChild(style);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveDoc();
    }
    if (e.key === "Escape") closeModal();
  });

  document
    .getElementById("modal-title")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") createItem();
    });
});

/* ─── SERVICE WORKER ─── */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => console.log("[SW] Registered:", reg.scope))
      .catch((err) => console.warn("[SW] Registration failed:", err));
  });
}
