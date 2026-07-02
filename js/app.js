/* ─── INIT ─── */
document.addEventListener("DOMContentLoaded", () => {
  initSettings();
  updateTodayDate();
  renderSidebar();
  renderCalendar();
  initLocalNotes();

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
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      mdBold();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "i") {
      e.preventDefault();
      mdItalic();
    }
    if (e.key === "Escape") {
      closeModal();
      closeSettings();
    }
  });

  document
    .getElementById("modal-title")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") createItem();
    });
});

/* ─── SERVICE WORKER CLEANUP ─── */
/* Older versions of this app registered a caching service worker that ended up
   serving stale files. We no longer register a service worker; instead we
   unregister any existing one and clear all caches so the browser always loads
   fresh files from the network. */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}
if (window.caches) {
  caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}
