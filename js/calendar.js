/* ─── CALENDAR ───────────────────────────────────────────────────────────
   Shows every document (Drive + local notes) on the day it was created —
   creation date only; a doc's modified date is shown when you open it, not
   here. Folders themselves never appear, only actual documents.

   collectDayEntries() takes an optional scopeFolderId so a future "limit to
   this folder" filter can reuse it without changing how entries are
   gathered — not wired to any UI yet, just kept open for it. */
function collectDayEntries(year, month, scopeFolderId) {
  const byDay = new Map();
  function push(day, entry) {
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }

  function walkDrive(nodes) {
    for (const n of nodes) {
      if (n.mimeType === FOLDER_MIME) {
        walkDrive(n.children);
        continue;
      }
      if (!n.createdTime) continue;
      const d = new Date(n.createdTime);
      if (d.getFullYear() === year && d.getMonth() === month) {
        push(d.getDate(), { kind: "drive", id: n.id, title: stripDocExt(n.name) });
      }
    }
  }
  let driveStart = driveTree;
  if (scopeFolderId) {
    const folderNode = findNodeById(scopeFolderId, driveTree);
    driveStart = folderNode ? folderNode.children : [];
  }
  walkDrive(driveStart);

  for (const note of localNotes) {
    if (note.type !== "note" || !note.createdTime) continue;
    if (scopeFolderId && note.parentId !== scopeFolderId) continue;
    const d = new Date(note.createdTime);
    if (d.getFullYear() === year && d.getMonth() === month) {
      push(d.getDate(), { kind: "local", id: note.id, title: note.title || "Untitled" });
    }
  }

  return byDay;
}

function calOpenEntry(kind, id) {
  switchView("library");
  if (kind === "drive") {
    const node = findNodeById(id, driveTree);
    if (node) openDoc(node);
  } else {
    openLocalNote(id);
  }
}

const CAL_MAX_ENTRIES_SHOWN = 3;
const CAL_MONTH_NAMES = [
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
const CAL_FILE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

/* Always resets to month view — every entry point into rendering the
   calendar (opening the tab, navigating months, jumping to a month) means
   "show me the month grid", so this is the one place that owns leaving
   day view rather than every caller having to remember to do it. */
function renderCalendar() {
  calViewMode = "month";
  calSelectedDay = null;
  document.getElementById("calendar-header").style.display = "";
  document.getElementById("cal-grid").classList.remove("hidden");
  document.getElementById("cal-day-view").classList.add("hidden");

  document.getElementById("cal-month-label").textContent =
    `${CAL_MONTH_NAMES[calDate.getMonth()]} ${calDate.getFullYear()}`;

  const jumpInput = document.getElementById("cal-month-jump");
  if (jumpInput) {
    jumpInput.value = `${calDate.getFullYear()}-${String(calDate.getMonth() + 1).padStart(2, "0")}`;
  }

  const days = document.getElementById("cal-days");
  days.innerHTML = "";

  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const today = new Date();

  const dayEntries = collectDayEntries(year, month, null);

  function buildDayCell(dayNum, isOtherMonth, isToday) {
    const cell = document.createElement("div");
    cell.className =
      "cal-day" + (isOtherMonth ? " other-month" : "") + (isToday ? " today" : "");

    const num = document.createElement("div");
    num.className = "cal-day-num";
    num.textContent = dayNum;
    cell.appendChild(num);

    if (!isOtherMonth) {
      cell.onclick = () => calShowDayView(year, month, dayNum);

      const entries = dayEntries.get(dayNum) || [];
      const shown = entries.slice(0, CAL_MAX_ENTRIES_SHOWN);
      for (const entry of shown) {
        const chip = document.createElement("div");
        chip.className = "cal-entry";
        chip.textContent = entry.title;
        chip.title = entry.title;
        chip.onclick = (e) => {
          e.stopPropagation();
          calOpenEntry(entry.kind, entry.id);
        };
        cell.appendChild(chip);
      }
      if (entries.length > shown.length) {
        const more = document.createElement("div");
        more.className = "cal-entry-more";
        more.textContent = `+${entries.length - shown.length} more`;
        cell.appendChild(more);
      }
    }

    return cell;
  }

  // Trailing days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    days.appendChild(buildDayCell(daysInPrev - i, true, false));
  }
  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const isToday =
      year === today.getFullYear() && month === today.getMonth() && i === today.getDate();
    days.appendChild(buildDayCell(i, false, isToday));
  }
  // Next month fill
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  let nextDay = 1;
  for (let i = firstDay + daysInMonth; i < totalCells; i++) {
    days.appendChild(buildDayCell(nextDay++, true, false));
  }
}

function calNav(dir) {
  calDate.setMonth(calDate.getMonth() + dir);
  renderCalendar();
}

/* Jumps the month grid straight to a picked year/month, e.g. from typing
   into the native <input type="month">, whose value arrives as "YYYY-MM". */
function calJumpToMonth(value) {
  if (!value) return;
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return;
  calDate = new Date(y, m - 1, 1);
  renderCalendar();
}

/* Drop into a single day's full, uncapped entry list — the destination for
   clicking anywhere in a day cell (the day number, empty space, or "+N
   more"; only the entry chips themselves opt out via stopPropagation, since
   they open that specific document directly instead). */
function calShowDayView(year, month, day) {
  calViewMode = "day";
  calSelectedDay = { year, month, day };
  document.getElementById("calendar-header").style.display = "none";
  document.getElementById("cal-grid").classList.add("hidden");
  document.getElementById("cal-day-view").classList.remove("hidden");
  renderDayView();
}

function renderDayView() {
  if (!calSelectedDay) return;
  const { year, month, day } = calSelectedDay;

  document.getElementById("cal-day-view-title").textContent = new Date(
    year,
    month,
    day,
  ).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const entries = collectDayEntries(year, month, null).get(day) || [];
  const list = document.getElementById("cal-day-view-list");
  list.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "cal-day-view-empty";
    empty.textContent = "No documents created on this day.";
    list.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "cal-day-view-row";
    row.innerHTML = CAL_FILE_ICON_SVG;
    const label = document.createElement("span");
    label.textContent = entry.title;
    row.appendChild(label);
    row.onclick = () => calOpenEntry(entry.kind, entry.id);
    list.appendChild(row);
  }
}

function calBackToMonth() {
  renderCalendar();
}
