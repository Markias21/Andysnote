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
      const entries = dayEntries.get(dayNum) || [];
      const shown = entries.slice(0, CAL_MAX_ENTRIES_SHOWN);
      for (const entry of shown) {
        const chip = document.createElement("div");
        chip.className = "cal-entry";
        chip.textContent = entry.title;
        chip.title = entry.title;
        chip.onclick = () => calOpenEntry(entry.kind, entry.id);
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
