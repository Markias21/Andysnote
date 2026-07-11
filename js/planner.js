/* ─── PLANNER (day-view 10-minute highlighter grid) ───────────────────────
   Owns everything about the calendar's per-day planner: grid rendering,
   drag-to-paint interaction, the day's activity-name legend, the
   month/year/week summary views, and its own storage layer.

   Activity names are PER DAY, not global: the 5 color slots (c1..c5) are a
   fixed palette (paint tool identity + theme-derived color only), but what
   each slot means ("운동", "코딩", ...) is decided fresh for every day and
   stored alongside that day's painted slots. A brand-new day is only ever
   *seeded* with the most-recently-typed set of names (plannerLastLabels) so
   there's something sensible to look at when you open the grid — editing
   that seed never rewrites any past day, and editing a past day never
   rewrites the seed for days after it beyond updating what "recent" means.
   See plannerEnsureDayEntry()/plannerRenameDayColor() for exactly where
   that seed gets cloned vs. written through.

   Storage is dual-backend so the planner works fully without signing in:
     - Signed in  -> Google Drive, "AndysNote/Calendar/" (lastLabels.json +
       one YYYY-MM.json per month). Only the low-level primitives from
       js/drive.js (driveGet/drivePost/drivePatch/driveGetFileText) are used
       here — never sync.js's tree-mutating helpers or drive.js's
       driveTree/cache plumbing, so this reserved folder never leaks into
       the sidebar's document tree (see resolvePlannerFolderId()).
     - Signed out -> browser IndexedDB ("andysnote-planner"), same shape.
   Every other function in this file (rendering, painting, stats) is
   backend-agnostic; only the plannerDrive-/plannerIdb-prefixed functions
   below (plus loadPlannerLastLabels/loadPlannerMonth, which pick between
   them) know which backend is active. */

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

async function plannerIdbLoadLastLabels() {
  const rec = await plannerIdbGet(PLANNER_META_STORE, "lastLabels").catch(() => null);
  return { labels: rec && rec.labels ? rec.labels : null, fileId: null };
}
async function plannerIdbSaveLastLabels(labels) {
  await plannerIdbPut(PLANNER_META_STORE, { key: "lastLabels", labels }).catch(() => {});
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

async function plannerDriveLoadLastLabels() {
  const file = await plannerDriveFindFile("lastLabels.json");
  if (!file) return { labels: null, fileId: null };
  const parsed = JSON.parse((await driveGetFileText(file.id)) || "{}");
  return { labels: parsed.labels && typeof parsed.labels === "object" ? parsed.labels : null, fileId: file.id };
}

async function plannerDriveSaveLastLabels(labels) {
  const text = JSON.stringify({ labels }, null, 2);
  if (plannerLastLabelsFileId) await drivePatch(plannerLastLabelsFileId, text);
  else plannerLastLabelsFileId = await plannerDriveCreateFile("lastLabels.json", text);
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

function defaultPlannerLabels() {
  const obj = {};
  for (const id of PLANNER_COLOR_IDS) obj[id] = "";
  return obj;
}

/* ─── STORAGE: backend-agnostic layer (everything below calls only these) ─── */

/* The "recent names" seed — not a real day's data, just what gets cloned
   into a brand-new day so the legend isn't blank on first open. */
async function loadPlannerLastLabels() {
  if (plannerLastLabels) return plannerLastLabels;
  try {
    const loaded = plannerBackendIsDrive()
      ? await plannerDriveLoadLastLabels()
      : await plannerIdbLoadLastLabels();
    plannerLastLabels = loaded.labels || defaultPlannerLabels();
    plannerLastLabelsFileId = loaded.fileId;
  } catch (e) {
    console.error("loadPlannerLastLabels failed", e);
    plannerLastLabels = defaultPlannerLabels();
  }
  return plannerLastLabels;
}

function schedulePlannerLastLabelsSave() {
  clearTimeout(plannerLastLabelsSaveTimer);
  plannerLastLabelsSaveTimer = setTimeout(async () => {
    try {
      if (plannerBackendIsDrive()) await plannerDriveSaveLastLabels(plannerLastLabels);
      else await plannerIdbSaveLastLabels(plannerLastLabels);
    } catch (e) {
      console.error("savePlannerLastLabels failed", e);
    }
  }, 1200);
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

/* Creates monthEntry.data[dayKey] the first time a day is actually touched
   (painted or renamed) — seeded from whatever labels are currently showing
   (plannerCurrentDayLabels: either a real day's own labels, or a fresh
   clone of the "recent" seed for a day that had none yet). Days that are
   only ever *opened*, never edited, stay absent — same sparse-storage
   principle as the old flat slot map. */
function plannerEnsureDayEntry(monthEntry, dayKey) {
  if (!monthEntry.data[dayKey]) {
    monthEntry.data[dayKey] = { labels: Object.assign({}, plannerCurrentDayLabels), slots: {} };
  }
  return monthEntry.data[dayKey];
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
   the data underneath plannerMonthCache/plannerLastLabels now points at a
   different store entirely. Called from auth.js. */
function plannerResetCaches() {
  plannerFolderId = null;
  plannerFolderResolvePromise = null;
  plannerLastLabels = null;
  plannerLastLabelsFileId = null;
  clearTimeout(plannerLastLabelsSaveTimer);
  plannerCurrentDayLabels = null;
  plannerMonthCache = {};
  plannerDirtyMonths.clear();
  clearTimeout(plannerSaveTimer);
  plannerSaveTimer = null;
}

/* A day "has content" once it carries a painted slot or a non-blank name —
   an entry that only exists because plannerEnsureDayEntry() cloned the seed
   but nothing was actually typed/painted yet does not count. */
function plannerDayEntryHasContent(dayEntry) {
  if (!dayEntry) return false;
  if (dayEntry.slots && Object.keys(dayEntry.slots).length) return true;
  if (dayEntry.labels) {
    for (const id of PLANNER_COLOR_IDS) if ((dayEntry.labels[id] || "").trim()) return true;
  }
  return false;
}

/* ─── LOCAL IMPORT (signed-in day with no Drive record yet, but a local
   IndexedDB record from before signing in / while signed out) ─── */
async function plannerLocalDayHasData(dayKey) {
  if (!plannerBackendIsDrive()) return false; // already on the local backend
  const monthKey = dayKey.slice(0, 7);
  const rec = await plannerIdbGet(PLANNER_MONTHS_STORE, monthKey).catch(() => null);
  return plannerDayEntryHasContent(rec && rec.data && rec.data[dayKey]);
}

async function plannerImportFromLocal(year, month, day) {
  const dayKey = plannerDayKey(year, month, day);
  const monthKey = dayKey.slice(0, 7);
  try {
    const rec = await plannerIdbGet(PLANNER_MONTHS_STORE, monthKey).catch(() => null);
    const localDay = rec && rec.data && rec.data[dayKey];
    if (!plannerDayEntryHasContent(localDay)) return;
    const entry = await loadPlannerMonth(year, month);
    entry.data[dayKey] = {
      labels: Object.assign({}, localDay.labels),
      slots: Object.assign({}, localDay.slots),
    };
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

function plannerUnnamedLabel(colorId) {
  return t("planner.colorUnnamed") + " " + colorId.slice(1);
}

/* The label to show for a color slot in the CURRENTLY OPEN day (legend,
   grid tooltips) — falls back to "Unnamed N" rather than ever showing a
   blank string. */
function plannerLabelFor(colorId) {
  const name = plannerCurrentDayLabels && plannerCurrentDayLabels[colorId];
  return name || plannerUnnamedLabel(colorId);
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

  const [lastLabels, monthEntry] = await Promise.all([loadPlannerLastLabels(), loadPlannerMonth(year, month)]);
  if (plannerCurrentDayKey !== dayKey) return; // navigated to another day while loading

  const existingDayEntry = monthEntry.data[dayKey];
  // A day that already has an entry edits that entry's labels object
  // directly (so renames persist); a fresh day gets a throwaway clone of
  // the "recent" seed until it's actually touched (see plannerEnsureDayEntry).
  plannerCurrentDayLabels = existingDayEntry ? existingDayEntry.labels : Object.assign({}, lastLabels);

  const showImport = await plannerLocalDayHasData(dayKey);
  if (plannerCurrentDayKey !== dayKey) return; // guard again after the second await

  buildPlannerDom(container, monthEntry, dayKey, year, month, day, showImport);
  scrollPlannerToDefault();
}

function buildPlannerDom(container, monthEntry, dayKey, year, month, day, showImport) {
  const dayData = (monthEntry.data[dayKey] && monthEntry.data[dayKey].slots) || {};

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
      const tooltip = colorId ? slot + " · " + plannerLabelFor(colorId) : slot;
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
  for (const id of PLANNER_COLOR_IDS) {
    const name = plannerCurrentDayLabels[id] || "";
    legend +=
      '<div class="planner-legend-row">' +
      '<span class="planner-legend-swatch ' +
      id +
      (plannerActiveColorId === id && !plannerEraseMode ? " active" : "") +
      '" title="' +
      escapeHtml(plannerLabelFor(id)) +
      "\" onclick=\"plannerSelectColor('" +
      id +
      '\')"></span>' +
      '<input type="text" class="planner-legend-name" value="' +
      escapeHtml(name) +
      '" placeholder="' +
      escapeHtml(plannerUnnamedLabel(id)) +
      "\" oninput=\"plannerRenameDayColor('" +
      id +
      "', this.value)\">" +
      '<span class="planner-legend-total" id="planner-total-' +
      id +
      '">' +
      escapeHtml(formatPlannerDuration(plannerDayTotalMinutes(dayData, id))) +
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

/* Updates swatch tooltips live as the user types a name, without a full
   renderPlanner() re-render — a full innerHTML rebuild would drop the name
   <input>'s focus/caret mid-keystroke. */
function refreshPlannerLegendLabels() {
  for (const id of PLANNER_COLOR_IDS) {
    const swatch = document.querySelector(".planner-legend-swatch." + id);
    if (swatch) swatch.title = plannerLabelFor(id);
  }
}

function plannerRenameDayColor(colorId, name) {
  const dayKey = plannerCurrentDayKey;
  if (!dayKey) return;
  const monthKey = dayKey.slice(0, 7);
  const monthEntry = plannerMonthCache[monthKey];
  if (!monthEntry) return;

  const dayEntry = plannerEnsureDayEntry(monthEntry, dayKey);
  dayEntry.labels[colorId] = name;
  plannerCurrentDayLabels = dayEntry.labels; // now the real, persisted object
  monthEntry.dirty = true;
  schedulePlannerSave(monthKey);

  // Seed the NEXT untouched day with whatever was just typed — past days
  // are never rewritten by this, only what a brand-new day starts with.
  if (plannerLastLabels) {
    plannerLastLabels[colorId] = name;
    schedulePlannerLastLabelsSave();
  }

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
  const monthEntry = plannerMonthCache[monthKey];
  if (!monthEntry) return;

  let dayData;
  if (plannerPaintValue) {
    const dayEntry = plannerEnsureDayEntry(monthEntry, dayKey);
    dayEntry.slots[slot] = plannerPaintValue;
    dayData = dayEntry.slots;
  } else if (monthEntry.data[dayKey]) {
    dayData = monthEntry.data[dayKey].slots;
    delete dayData[slot];
    // Deliberately NOT deleting the day entry when its slots empty out —
    // the user may have typed names for this day without painting
    // anything (yet), and erasing the last cell must not silently drop them.
  } else {
    dayData = {};
  }
  monthEntry.dirty = true;

  cell.className = "planner-cell" + (plannerPaintValue ? " " + plannerPaintValue : "");
  cell.title = plannerPaintValue ? slot + " · " + plannerLabelFor(plannerPaintValue) : slot;

  plannerRefreshTotals(dayData);
  schedulePlannerSave(monthKey);
}

function plannerRefreshTotals(dayData) {
  for (const id of PLANNER_COLOR_IDS) {
    const el = document.getElementById("planner-total-" + id);
    if (el) el.textContent = formatPlannerDuration(plannerDayTotalMinutes(dayData, id));
  }
}

/* ─── MONTH / YEAR / WEEK SUMMARY ───────────────────────────────────────
   Aggregation groups by ACTIVITY NAME, not by color slot — the whole point
   of per-day-independent naming is that "운동" on one day and "운동" on
   another (even painted with different color slots) count as the same
   activity, while a slot left unnamed on a given day buckets separately as
   "Unnamed N" (N = that slot's position, 1..5) rather than being merged
   with every other unnamed slot across every day. */
function plannerDayKeysInMonth(year, month) {
  const days = new Date(year, month + 1, 0).getDate();
  const keys = [];
  for (let d = 1; d <= days; d++) keys.push(plannerDayKey(year, month, d));
  return keys;
}

function plannerDayKeysInYear(year) {
  const keys = [];
  for (let m = 0; m < 12; m++) keys.push(...plannerDayKeysInMonth(year, m));
  return keys;
}

/* One row per Sun-Sat week the month's grid spans (5 or 6, matching
   renderCalendar()'s own trailing/leading-day math) — each week's day list
   always has exactly 7 entries and freely spills into the previous/next
   month, per the "그 주 전체를 가져와" requirement. */
function plannerMonthWeekRanges(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalWeeks = Math.ceil((firstDay + daysInMonth) / 7);
  const ranges = [];
  for (let w = 0; w < totalWeeks; w++) {
    const start = new Date(year, month, 1 - firstDay + w * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      days.push(plannerDayKey(d.getFullYear(), d.getMonth(), d.getDate()));
    }
    ranges.push({ start, days });
  }
  return ranges;
}

function plannerWeekRangeLabel(range, weekIndex) {
  const end = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString(localeTag(), { month: "short", day: "numeric" });
  return tWeekLabel(weekIndex + 1) + " · " + fmt(range.start) + " – " + fmt(end);
}

/* Loads only the distinct months the given day keys touch, then sums
   painted-slot minutes per activity name (falling back to "Unnamed N" for
   slots with no name), sorted most-time-first. */
async function computePlannerStatsForDays(dayKeys) {
  const byMonth = {};
  for (const dk of dayKeys) {
    const mk = dk.slice(0, 7);
    (byMonth[mk] || (byMonth[mk] = [])).push(dk);
  }

  const totals = new Map(); // key -> { name, minutes }
  for (const mk of Object.keys(byMonth)) {
    const [y, m] = mk.split("-").map(Number);
    const monthEntry = await loadPlannerMonth(y, m - 1);
    for (const dk of byMonth[mk]) {
      const dayEntry = monthEntry.data[dk];
      if (!dayEntry) continue;
      const labels = dayEntry.labels || {};
      const slots = dayEntry.slots || {};
      for (const slot in slots) {
        const colorId = slots[slot];
        const name = (labels[colorId] || "").trim();
        const key = name || "unnamed:" + colorId;
        const displayName = name || plannerUnnamedLabel(colorId);
        if (!totals.has(key)) totals.set(key, { name: displayName, minutes: 0 });
        totals.get(key).minutes += PLANNER_SLOT_MINUTES;
      }
    }
  }

  return Array.from(totals.values()).sort((a, b) => b.minutes - a.minutes);
}

function buildPlannerWeekButtons(ranges, activeWeekIndex) {
  let html =
    '<button type="button" class="cal-stats-week-btn' +
    (activeWeekIndex == null ? " active" : "") +
    '" onclick="renderPlannerStats(\'month\')">' +
    escapeHtml(t("cal.statsWeekAll")) +
    "</button>";
  ranges.forEach((r, i) => {
    html +=
      '<button type="button" class="cal-stats-week-btn' +
      (activeWeekIndex === i ? " active" : "") +
      "\" onclick=\"renderPlannerStats('month', " +
      i +
      ')">' +
      escapeHtml(tWeekLabel(i + 1)) +
      "</button>";
  });
  return html;
}

function renderPlannerStatsRows(stats) {
  const listEl = document.getElementById("cal-stats-list");
  if (!listEl) return;

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
      '<span class="cal-stats-name">' +
      escapeHtml(s.name) +
      "</span>" +
      '<span class="cal-stats-bar-track"><span class="cal-stats-bar" style="width:' +
      pct +
      '%"></span></span>' +
      '<span class="cal-stats-time">' +
      escapeHtml(formatPlannerDuration(s.minutes)) +
      "</span>" +
      "</div>";
  }
  listEl.innerHTML = html;
}

/* Renders into #cal-stats-title/#cal-stats-weeks/#cal-stats-list — the
   view-toggling itself (hiding cal-grid, showing cal-stats-view) is
   calendar.js's job (calShowStatsView), same split as
   renderDayView() -> renderPlanner(). scope is "month" or "year"; weekIndex
   (0-based) narrows a "month" scope down to one Sun-Sat week and is what
   the week-button row (rendered here, month scope only) drives. */
async function renderPlannerStats(scope, weekIndex) {
  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const titleEl = document.getElementById("cal-stats-title");
  const weeksEl = document.getElementById("cal-stats-weeks");
  const listEl = document.getElementById("cal-stats-list");
  if (!titleEl || !listEl || !weeksEl) return;

  let dayKeys;
  if (scope === "year") {
    titleEl.textContent = String(year);
    weeksEl.innerHTML = "";
    dayKeys = plannerDayKeysInYear(year);
  } else {
    const ranges = plannerMonthWeekRanges(year, month);
    const idx = typeof weekIndex === "number" ? weekIndex : null;
    if (idx === null) {
      titleEl.textContent = `${t("cal.months")[month]} ${year}`;
      dayKeys = plannerDayKeysInMonth(year, month);
    } else {
      titleEl.textContent = plannerWeekRangeLabel(ranges[idx], idx);
      dayKeys = ranges[idx].days;
    }
    weeksEl.innerHTML = buildPlannerWeekButtons(ranges, idx);
  }

  listEl.innerHTML = '<div class="planner-loading">' + escapeHtml(t("planner.loading")) + "</div>";
  const token = ++plannerStatsToken;
  const stats = await computePlannerStatsForDays(dayKeys);
  if (token !== plannerStatsToken) return; // a newer stats request superseded this one

  renderPlannerStatsRows(stats);
}
