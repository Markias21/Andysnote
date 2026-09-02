/* ─── STATUS HELPERS ─── */
function formatTime(date) {
  return date.toLocaleTimeString(localeTag(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setSyncStatus(state, label, showRetry = false) {
  const dot = document.getElementById("sync-dot");
  const lbl = document.getElementById("sync-label");
  const retry = document.getElementById("sync-retry");
  if (!dot || !lbl) return;
  dot.className = "sync-dot " + state;
  lbl.textContent = label;
  if (retry) retry.style.display = showRetry ? "inline" : "none";
}

/* ─── HTML ESCAPE ─── */
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── TODAY DATE ─── */
function updateTodayDate() {
  const d = new Date();
  document.getElementById("today-date").textContent = d.toLocaleDateString(
    localeTag(),
    {
      weekday: "short",
      month: "short",
      day: "numeric",
    },
  );
}

/* ─── VIEW SWITCHING ───────────────────────────────────────────────────────
   Two top-level views (library/calendar) — explicit per-view branches
   instead of an if/else catch-all. Each branch handles its own nav-button
   state, view container, sidebar visibility, and on-entry render. */
function switchView(view) {
  const btnLib = document.getElementById("btn-library");
  const btnCal = document.getElementById("btn-calendar");
  const libView = document.getElementById("library-view");
  const calView = document.getElementById("calendar-view");
  const sidebar = document.getElementById("sidebar");

  btnLib.classList.toggle("active", view === "library");
  btnCal.classList.toggle("active", view === "calendar");

  libView.style.display = view === "library" ? "flex" : "none";
  calView.classList.toggle("hidden", view !== "calendar");

  sidebar.style.display = view === "library" ? "" : "none";

  if (view === "calendar") {
    renderCalendar();
    // The Drive tree is lazy-loaded (only expanded folders have their
    // children fetched), so the calendar would otherwise miss anything
    // inside a folder nobody has opened yet. loadEntireTree() is a no-op if
    // everything's already loaded, so this is cheap on repeat visits.
    if (driveAccessToken && !driveTreeFullyLoaded) {
      loadEntireTree().then(renderCalendar);
    }
  }
}

