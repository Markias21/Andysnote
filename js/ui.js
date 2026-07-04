/* ─── STATUS HELPERS ─── */
function formatTime(date) {
  return date.toLocaleTimeString([], {
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
    "en-US",
    {
      weekday: "short",
      month: "short",
      day: "numeric",
    },
  );
}

/* ─── VIEW SWITCHING ─── */
function switchView(view) {
  const btnLib = document.getElementById("btn-library");
  const btnCal = document.getElementById("btn-calendar");
  const libView = document.getElementById("library-view");
  const calView = document.getElementById("calendar-view");
  const sidebar = document.getElementById("sidebar");
  if (view === "library") {
    btnLib.classList.add("active");
    btnCal.classList.remove("active");
    libView.style.display = "flex";
    calView.classList.add("hidden");
    sidebar.style.display = "";
  } else {
    btnLib.classList.remove("active");
    btnCal.classList.add("active");
    libView.style.display = "none";
    calView.classList.remove("hidden");
    sidebar.style.display = "none";
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

