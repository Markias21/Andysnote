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
  }
}

/* ─── CALENDAR (uses Drive modifiedTime) ─── */
function renderCalendar() {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  document.getElementById("cal-month-label").textContent =
    `${months[calDate.getMonth()]} ${calDate.getFullYear()}`;

  const days = document.getElementById("cal-days");
  days.innerHTML = "";

  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const today = new Date();

  // Collect days that have a modified Drive file
  const modDays = new Set();
  function collectDates(nodes) {
    for (const n of nodes) {
      if (n.mimeType === FOLDER_MIME) {
        collectDates(n.children);
        continue;
      }
      if (n.modifiedTime) {
        const d = new Date(n.modifiedTime);
        if (d.getFullYear() === year && d.getMonth() === month) {
          modDays.add(d.getDate());
        }
      }
    }
  }
  collectDates(driveTree);

  // Trailing days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = document.createElement("div");
    d.className = "cal-day other-month";
    d.textContent = daysInPrev - i;
    days.appendChild(d);
  }
  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const d = document.createElement("div");
    d.className = "cal-day";
    if (
      year === today.getFullYear() &&
      month === today.getMonth() &&
      i === today.getDate()
    ) {
      d.classList.add("today");
    }
    if (modDays.has(i)) d.classList.add("has-entry");
    d.textContent = i;
    days.appendChild(d);
  }
  // Next month fill
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  let nextDay = 1;
  for (let i = firstDay + daysInMonth; i < totalCells; i++) {
    const d = document.createElement("div");
    d.className = "cal-day other-month";
    d.textContent = nextDay++;
    days.appendChild(d);
  }
}

function calNav(dir) {
  calDate.setMonth(calDate.getMonth() + dir);
  renderCalendar();
}
