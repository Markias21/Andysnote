/* ─── PLANNER (day-view 10-minute highlighter grid) ───────────────────────
   Owns everything about the calendar's per-day planner: grid rendering,
   drag-to-paint interaction, the color legend (names + per-day totals), the
   month/year summary view, and its own storage layer.

   Storage is dual-backend so the planner works fully without signing in:
     - Signed in  -> Google Drive, "AndysNote/Calendar/" (colors.json +
       one YYYY-MM.json per month). Only the low-level primitives from
       js/drive.js (driveGet/drivePost/drivePatch/driveGetFileText) are used
       here — never sync.js's tree-mutating helpers or drive.js's
       driveTree/cache plumbing, so this reserved folder never leaks into
       the sidebar's document tree (see resolvePlannerFolderId()).
     - Signed out -> browser IndexedDB ("andysnote-planner"), same shape.
   Every other function in this file (rendering, painting, stats) is
   backend-agnostic; only the plannerDrive-/plannerIdb-prefixed functions
   below (plus loadPlannerColors/loadPlannerMonth, which pick between them)
   know which backend is active. */

/* ─── STORAGE: IndexedDB (offline / signed-out backend) ─── */
function plannerOpenDb() {
  if (plannerDbPromise) return plannerDbPromise;
  plannerDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PLANNER_DB_NAME, PLANNER_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PLANNER_MONTHS_STORE))
        db.createObjectStore(PLANNER_MONTHS_STORE, { keyPath: "monthKey" });
      if (!db.objectStoreNames.contains(PLANNER_META_STORE))
        db.createObjectStore(PLANNER_META_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return plannerDbPromise;
}

function plannerIdbGet(store, key) {
  return plannerOpenDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }),
  );
}

function plannerIdbPut(store, value) {
  return plannerOpenDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

async function plannerIdbLoadColors() {
  const rec = await plannerIdbGet(PLANNER_META_STORE, "colors").catch(() => null);
  return { colors: rec && Array.isArray(rec.colors) ? rec.colors : null, fileId: null };
}
async function plannerIdbSaveColors(colors) {
  await plannerIdbPut(PLANNER_META_STORE, { key: "colors", colors }).catch(() => {});
}
async function plannerIdbLoadMonth(monthKey) {
  const rec = await plannerIdbGet(PLANNER_MONTHS_STORE, monthKey).catch(() => null);
  return { data: (rec && rec.data) || {}, fileId: null };
}
async function plannerIdbSaveMonth(monthKey, data) {
  await plannerIdbPut(PLANNER_MONTHS_STORE, { monthKey, data }).catch(() => {});
}

/* ─── STORAGE: Google Drive (signed-in backend) ─── */

/* Find-or-create "AndysNote/Calendar/". Mirrors findOrCreateAndysNoteRoot()'s
   search pattern (drive.js) and ensureFolderLoaded()'s in-flight-promise
   dedupe (drive.js) so a rapid double call never creates the folder twice.
   Deliberately never touches driveTree/insertIntoTree/syncFolderCache —
   this folder must stay invisible to the sidebar's document tree (see the
   plannerFolderId filters in sidebar.js/drive.js/calendar.js). */
async function resolvePlannerFolderId() {
  if (plannerFolderId) return plannerFolderId;
  if (!driveAccessToken || !andysNoteRootId) return null;
  if (plannerFolderResolvePromise) return plannerFolderResolvePromise;
  plannerFolderResolvePromise = (async () => {
    try {
      const r = await driveGet("https://www.googleapis.com/drive/v3/files", {
        q: `name='${PLANNER_FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and '${andysNoteRootId}' in parents and trashed=false`,
        fields: "files(id,name)",
        pageSize: 1,
      });
      if (r.files && r.files.length) {
        plannerFolderId = r.files[0].id;
      } else {
        const created = await drivePost("https://www.googleapis.com/drive/v3/files", {
          name: PLANNER_FOLDER_NAME,
          mimeType: FOLDER_MIME,
          parents: [andysNoteRootId],
        });
        plannerFolderId = created.id;
      }
      // The folder may have already been pulled into driveTree by the root's
      // own shallow listing (initDriveFilesystem) before we got here — now
      // that plannerFolderId is known, re-render so the hide-filters apply.
      renderSidebar(currentSearchValue());
      populateModalFolders();
    } catch (e) {
      console.error("resolvePlannerFolderId failed", e);
    } finally {
      plannerFolderResolvePromise = null;
    }
    return plannerFolderId;
  })();
  return plannerFolderResolvePromise;
}

async function plannerDriveFindFile(name) {
  const folderId = await resolvePlannerFolderId();
  if (!folderId) return null;
  const r = await driveGet("https://www.googleapis.com/drive/v3/files", {
    q: `name='${name}' and '${folderId}' in parents and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  return (r.files && r.files[0]) || null;
}

async function plannerDriveCreateFile(name, text) {
  const folderId = await resolvePlannerFolderId();
  const created = await drivePost(
    "https://www.googleapis.com/upload/drive/v3/files",
    { name, mimeType: "application/json", parents: [folderId] },
    text,
  );
  return created.id;
}

async function plannerDriveLoadColors() {
  const file = await plannerDriveFindFile("colors.json");
  if (!file) return { colors: null, fileId: null };
  const parsed = JSON.parse((await driveGetFileText(file.id)) || "{}");
  return { colors: Array.isArray(parsed.colors) ? parsed.colors : null, fileId: file.id };
}

async function plannerDriveSaveColors(colors) {
  const text = JSON.stringify({ colors }, null, 2);
  if (plannerColorsFileId) await drivePatch(plannerColorsFileId, text);
  else plannerColorsFileId = await plannerDriveCreateFile("colors.json", text);
}

async function plannerDriveLoadMonth(monthKey) {
  const file = await plannerDriveFindFile(monthKey + ".json");
  if (!file) return { data: {}, fileId: null };
  const data = JSON.parse((await driveGetFileText(file.id)) || "{}");
  return { data, fileId: file.id };
}

async function plannerDriveSaveMonth(monthKey, entry) {
  const text = JSON.stringify(entry.data, null, 2);
  if (entry.fileId) await drivePatch(entry.fileId, text);
  else entry.fileId = await plannerDriveCreateFile(monthKey + ".json", text);
}

function plannerBackendIsDrive() {
  return !!driveAccessToken;
}

function defaultPlannerColors() {
  return PLANNER_COLOR_IDS.map((id) => ({ id, name: "" }));
}

/* ─── STORAGE: backend-agnostic layer (everything below calls only these) ─── */
async function loadPlannerColors() {
  if (plannerColors) return plannerColors;
  try {
    const loaded = plannerBackendIsDrive()
      ? await plannerDriveLoadColors()
      : await plannerIdbLoadColors();
    plannerColors = loaded.colors || defaultPlannerColors();
    plannerColorsFileId = loaded.fileId;
  } catch (e) {
    console.error("loadPlannerColors failed", e);
    plannerColors = defaultPlannerColors();
  }
  return plannerColors;
}

async function savePlannerColors() {
  try {
    if (plannerBackendIsDrive()) await plannerDriveSaveColors(plannerColors);
    else await plannerIdbSaveColors(plannerColors);
  } catch (e) {
    console.error("savePlannerColors failed", e);
  }
}

function plannerMonthKeyOf(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function plannerDayKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function loadPlannerMonth(year, month) {
  const monthKey = plannerMonthKeyOf(year, month);
  if (plannerMonthCache[monthKey]) return plannerMonthCache[monthKey];
  const entry = { fileId: null, data: {}, dirty: false };
  try {
    const loaded = plannerBackendIsDrive()
      ? await plannerDriveLoadMonth(monthKey)
      : await plannerIdbLoadMonth(monthKey);
    entry.data = loaded.data || {};
    entry.fileId = loaded.fileId || null;
  } catch (e) {
    console.error("loadPlannerMonth failed", e);
  }
  plannerMonthCache[monthKey] = entry;
  return entry;
}

function schedulePlannerSave(monthKey) {
  plannerDirtyMonths.add(monthKey);
  clearTimeout(plannerSaveTimer);
  plannerSaveTimer = setTimeout(flushPlannerSave, 1800);
}

/* Flushes every dirty month. Called both by the debounce timer and by
   calBackToMonth()/handleSignoutClick() before those tear down state that a
   delayed timer would otherwise write against (same rationale as
   flushDriveSave() in drive.js). */
async function flushPlannerSave() {
  clearTimeout(plannerSaveTimer);
  plannerSaveTimer = null;
  const keys = Array.from(plannerDirtyMonths);
  plannerDirtyMonths.clear();
  for (const monthKey of keys) {
    const entry = plannerMonthCache[monthKey];
    if (!entry) continue;
    try {
      if (plannerBackendIsDrive()) await plannerDriveSaveMonth(monthKey, entry);
      else await plannerIdbSaveMonth(monthKey, entry.data);
      entry.dirty = false;
    } catch (e) {
      console.error("flushPlannerSave failed for", monthKey, e);
      plannerDirtyMonths.add(monthKey); // retry on the next debounce cycle
    }
  }
}

/* Backend switches (sign in / sign out) invalidate every in-memory cache —
   the data underneath plannerMonthCache/plannerColors now points at a
   different store entirely. Called from auth.js. */
function plannerResetCaches() {
  plannerFolderId = null;
  plannerFolderResolvePromise = null;
  plannerColors = null;
  plannerColorsFileId = null;
  clearTimeout(plannerColorsSaveTimer);
  plannerMonthCache = {};
  plannerDirtyMonths.clear();
  clearTimeout(plannerSaveTimer);
  plannerSaveTimer = null;
}

/* ─── LOCAL IMPORT (signed-in day with no Drive record yet, but a local
   IndexedDB record from before signing in / while signed out) ─── */
async function plannerLocalDayHasData(dayKey) {
  if (!plannerBackendIsDrive()) return false; // already on the local backend
  const monthKey = dayKey.slice(0, 7);
  const rec = await plannerIdbGet(PLANNER_MONTHS_STORE, monthKey).catch(() => null);
  return !!(rec && rec.data && rec.data[dayKey] && Object.keys(rec.data[dayKey]).length);
}

async function plannerImportFromLocal(year, month, day) {
  const dayKey = plannerDayKey(year, month, day);
  const monthKey = dayKey.slice(0, 7);
  try {
    const rec = await plannerIdbGet(PLANNER_MONTHS_STORE, monthKey).catch(() => null);
    const localDay = rec && rec.data && rec.data[dayKey];
    if (!localDay || !Object.keys(localDay).length) return;
    const entry = await loadPlannerMonth(year, month);
    entry.data[dayKey] = Object.assign({}, localDay); // copy — the local original stays untouched
    entry.dirty = true;
    schedulePlannerSave(monthKey);
    renderPlanner(year, month, day);
  } catch (e) {
    console.error("plannerImportFromLocal failed", e);
  }
}

/* ─── DURATION FORMATTING ─── */
function formatPlannerDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hUnit = t("planner.hoursShort");
  const mUnit = t("planner.minutesShort");
  if (!h) return m + mUnit;
  if (!m) return h + hUnit;
  return h + hUnit + " " + m + mUnit;
}

function plannerColorLabel(color) {
  return color.name || t("planner.colorDefaultName") + " " + color.id.slice(1);
}

function plannerDayTotalMinutes(dayData, colorId) {
  if (!dayData) return 0;
  let n = 0;
  for (const slot in dayData) if (dayData[slot] === colorId) n++;
  return n * PLANNER_SLOT_MINUTES;
}

/* ─── RENDERING (day view) ─── */
const PLANNER_ERASER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>';

async function renderPlanner(year, month, day) {
  const container = document.getElementById("planner-panel");
  if (!container) return;
  const dayKey = plannerDayKey(year, month, day);
  plannerCurrentDayKey = dayKey;

  container.innerHTML =
    '<div class="planner-loading">' + escapeHtml(t("planner.loading")) + "</div>";

  const [colors, monthEntry] = await Promise.all([loadPlannerColors(), loadPlannerMonth(year, month)]);
  if (plannerCurrentDayKey !== dayKey) return; // navigated to another day while loading

  const showImport = await plannerLocalDayHasData(dayKey);
  if (plannerCurrentDayKey !== dayKey) return; // guard again after the second await

  buildPlannerDom(container, colors, monthEntry, dayKey, year, month, day, showImport);
  scrollPlannerToDefault();
}

function buildPlannerDom(container, colors, monthEntry, dayKey, year, month, day, showImport) {
  const dayData = monthEntry.data[dayKey] || {};

  let header = '<div class="planner-header">';
  header +=
    '<button type="button" class="planner-eraser-btn' +
    (plannerEraseMode ? " active" : "") +
    '" title="' +
    escapeHtml(t("planner.eraser")) +
    '" onclick="plannerSelectEraser()">' +
    PLANNER_ERASER_SVG +
    "</button>";
  if (showImport) {
    header +=
      '<button type="button" class="planner-import-btn" onclick="plannerImportFromLocal(' +
      year +
      "," +
      month +
      "," +
      day +
      ')">' +
      escapeHtml(t("planner.importFromLocal")) +
      "</button>";
  }
  header += "</div>";

  let grid = '<div class="planner-grid" id="planner-grid">';
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    grid += '<div class="planner-row" id="planner-row-' + hh + '">';
    grid += '<div class="planner-row-label">' + hh + ":00</div>";
    for (let m = 0; m < 60; m += PLANNER_SLOT_MINUTES) {
      const slot = hh + ":" + String(m).padStart(2, "0");
      const colorId = dayData[slot];
      const color = colorId && colors.find((c) => c.id === colorId);
      const tooltip = color ? slot + " · " + plannerColorLabel(color) : slot;
      grid +=
        '<div class="planner-cell' +
        (colorId ? " " + colorId : "") +
        '" data-slot="' +
        slot +
        '" title="' +
        escapeHtml(tooltip) +
        '"></div>';
    }
    grid += "</div>";
  }
  grid += "</div>";

  let legend = '<div class="planner-legend">';
  for (const c of colors) {
    const label = plannerColorLabel(c);
    legend +=
      '<div class="planner-legend-row">' +
      '<span class="planner-legend-swatch ' +
      c.id +
      (plannerActiveColorId === c.id && !plannerEraseMode ? " active" : "") +
      '" title="' +
      escapeHtml(label) +
      "\" onclick=\"plannerSelectColor('" +
      c.id +
      '\')"></span>' +
      '<input type="text" class="planner-legend-name" value="' +
      escapeHtml(c.name) +
      '" placeholder="' +
      escapeHtml(t("planner.colorDefaultName") + " " + c.id.slice(1)) +
      "\" oninput=\"plannerRenameColor('" +
      c.id +
      "', this.value)\">" +
      '<span class="planner-legend-total" id="planner-total-' +
      c.id +
      '">' +
      escapeHtml(formatPlannerDuration(plannerDayTotalMinutes(dayData, c.id))) +
      "</span>" +
      "</div>";
  }
  legend += "</div>";

  container.innerHTML =
    header +
    '<div class="planner-body">' +
    '<div class="planner-grid-scroll" id="planner-grid-scroll">' +
    grid +
    "</div>" +
    legend +
    "</div>";

  attachPlannerPointerHandlers(document.getElementById("planner-grid"));
}

function plannerSelectColor(id) {
  plannerActiveColorId = id;
  plannerEraseMode = false;
  refreshPlannerToolbarActive();
}

function plannerSelectEraser() {
  plannerEraseMode = true;
  refreshPlannerToolbarActive();
}

function refreshPlannerToolbarActive() {
  document.querySelectorAll(".planner-legend-swatch").forEach((el) => {
    el.classList.toggle("active", !plannerEraseMode && el.classList.contains(plannerActiveColorId));
  });
  const eraserBtn = document.querySelector(".planner-eraser-btn");
  if (eraserBtn) eraserBtn.classList.toggle("active", plannerEraseMode);
}

/* Updates swatch tooltips live as the user types a color's name, without a
   full renderPlanner() re-render — a full innerHTML rebuild would drop the
   name <input>'s focus/caret mid-keystroke. */
function refreshPlannerLegendLabels() {
  if (!plannerColors) return;
  for (const c of plannerColors) {
    const swatch = document.querySelector(".planner-legend-swatch." + c.id);
    if (swatch) swatch.title = plannerColorLabel(c);
  }
}

function plannerRenameColor(id, name) {
  const c = plannerColors && plannerColors.find((c) => c.id === id);
  if (!c) return;
  c.name = name;
  clearTimeout(plannerColorsSaveTimer);
  plannerColorsSaveTimer = setTimeout(savePlannerColors, 1200);
  refreshPlannerLegendLabels();
}

function scrollPlannerToDefault() {
  const scrollEl = document.getElementById("planner-grid-scroll");
  const row = document.getElementById("planner-row-05");
  if (!scrollEl || !row) return;
  scrollEl.scrollTop = row.offsetTop;
}

/* ─── DRAG PAINTING (Pointer Events — mouse, touch, and pen alike) ─── */
function attachPlannerPointerHandlers(gridEl) {
  if (!gridEl) return;
  gridEl.addEventListener("pointerdown", plannerOnPointerDown);
}

function plannerOnPointerDown(e) {
  const cell = e.target.closest(".planner-cell");
  if (!cell) return;
  e.preventDefault();
  plannerIsPainting = true;
  plannerPaintValue = plannerEraseMode ? null : plannerActiveColorId;
  plannerLastPaintedSlot = null;
  plannerPaintCell(cell);
  // Listen on window, not the grid: a fast drag can carry the pointer
  // outside the grid element briefly, and a pointerleave there would
  // otherwise cut the gesture short mid-stroke.
  window.addEventListener("pointermove", plannerOnPointerMove);
  window.addEventListener("pointerup", plannerOnPointerUp);
  window.addEventListener("pointercancel", plannerOnPointerUp);
}

function plannerOnPointerMove(e) {
  if (!plannerIsPainting) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el && el.closest && el.closest(".planner-cell");
  if (!cell || cell.dataset.slot === plannerLastPaintedSlot) return;
  plannerPaintCell(cell);
}

function plannerOnPointerUp() {
  if (!plannerIsPainting) return;
  plannerIsPainting = false;
  plannerPaintValue = null;
  plannerLastPaintedSlot = null;
  window.removeEventListener("pointermove", plannerOnPointerMove);
  window.removeEventListener("pointerup", plannerOnPointerUp);
  window.removeEventListener("pointercancel", plannerOnPointerUp);
}

function plannerPaintCell(cell) {
  const slot = cell.dataset.slot;
  plannerLastPaintedSlot = slot;

  const dayKey = plannerCurrentDayKey;
  if (!dayKey) return;
  const monthKey = dayKey.slice(0, 7);
  const entry = plannerMonthCache[monthKey];
  if (!entry) return;

  if (plannerPaintValue) {
    if (!entry.data[dayKey]) entry.data[dayKey] = {};
    entry.data[dayKey][slot] = plannerPaintValue;
  } else if (entry.data[dayKey]) {
    delete entry.data[dayKey][slot];
    if (!Object.keys(entry.data[dayKey]).length) delete entry.data[dayKey];
  }
  entry.dirty = true;

  cell.className = "planner-cell" + (plannerPaintValue ? " " + plannerPaintValue : "");
  const color = plannerPaintValue && plannerColors && plannerColors.find((c) => c.id === plannerPaintValue);
  cell.title = color ? slot + " · " + plannerColorLabel(color) : slot;

  plannerRefreshTotals(entry.data[dayKey] || {});
  schedulePlannerSave(monthKey);
}

function plannerRefreshTotals(dayData) {
  if (!plannerColors) return;
  for (const c of plannerColors) {
    const el = document.getElementById("planner-total-" + c.id);
    if (el) el.textContent = formatPlannerDuration(plannerDayTotalMinutes(dayData, c.id));
  }
}

/* ─── MONTH / YEAR SUMMARY ─── */
async function computePlannerStats(year, monthOrNull) {
  const colors = await loadPlannerColors();
  const totals = {};
  for (const id of PLANNER_COLOR_IDS) totals[id] = 0;

  const months = monthOrNull !== null ? [monthOrNull] : Array.from({ length: 12 }, (_, i) => i);
  for (const month of months) {
    const entry = await loadPlannerMonth(year, month);
    for (const dk in entry.data) {
      const dayData = entry.data[dk];
      for (const slot in dayData) {
        const id = dayData[slot];
        if (id in totals) totals[id] += PLANNER_SLOT_MINUTES;
      }
    }
  }

  return colors.map((c) => ({ id: c.id, name: plannerColorLabel(c), minutes: totals[c.id] || 0 }));
}

/* Renders into #cal-stats-title/#cal-stats-list — the view-toggling itself
   (hiding cal-grid, showing cal-stats-view) is calendar.js's job
   (calShowStatsView), same split as renderDayView() -> renderPlanner(). */
async function renderPlannerStats(scope) {
  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const titleEl = document.getElementById("cal-stats-title");
  const listEl = document.getElementById("cal-stats-list");
  if (!titleEl || !listEl) return;

  titleEl.textContent = scope === "month" ? `${t("cal.months")[month]} ${year}` : String(year);
  listEl.innerHTML = '<div class="planner-loading">' + escapeHtml(t("planner.loading")) + "</div>";

  const token = ++plannerStatsToken;
  const stats = await computePlannerStats(year, scope === "month" ? month : null);
  if (token !== plannerStatsToken) return; // a newer stats request superseded this one

  const hasAny = stats.some((s) => s.minutes > 0);
  if (!hasAny) {
    listEl.innerHTML = '<div class="cal-day-view-empty">' + escapeHtml(t("cal.statsEmpty")) + "</div>";
    return;
  }

  const maxMinutes = Math.max(1, ...stats.map((s) => s.minutes));
  let html = "";
  for (const s of stats) {
    const pct = Math.round((s.minutes / maxMinutes) * 100);
    html +=
      '<div class="cal-stats-row">' +
      '<span class="cal-stats-swatch ' +
      s.id +
      '"></span>' +
      '<span class="cal-stats-name">' +
      escapeHtml(s.name) +
      "</span>" +
      '<span class="cal-stats-bar-track"><span class="cal-stats-bar ' +
      s.id +
      '" style="width:' +
      pct +
      '%"></span></span>' +
      '<span class="cal-stats-time">' +
      escapeHtml(formatPlannerDuration(s.minutes)) +
      "</span>" +
      "</div>";
  }
  listEl.innerHTML = html;
}
