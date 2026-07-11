/* ─── IN-MEMORY TREE (Drive is source of truth) ─── */
// Node: { id, name, mimeType, createdTime, modifiedTime, children: [] }
let driveTree = []; // top-level children of AndysNote/
let andysNoteRootId = null; // Drive folder ID of "AndysNote/"
let expandedFolders = new Set(); // which folder IDs are open in sidebar
let currentFileId = null; // Drive file ID of the open document
let calDate = new Date();
let calViewMode = "month"; // "month" | "day" — "day" drills into a single date's full entry list
let calSelectedDay = null; // { year, month, day } when calViewMode === "day"
let calScopeFolderId = null; // Drive folder ID to limit the calendar to, or null for everything
let driveSaveTimer = null;
let driveDirty = false; // true when the open Drive doc has unsaved edits

/* ─── OAUTH / GAPI ─── */
let tokenClient_tc = null;
let gapiInited = false;
let gisInited = false;
let driveAccessToken = null;

/* ─── STORAGE MODE / LOCAL (BROWSER) NOTES ─── */
let storageMode = "drive"; // backend of the currently-open doc: "drive" | "local"
let localSaveTimer = null; // debounce timer for local autosave
let localDirty = false; // true when the open Local doc has unsaved edits
let searchDebounceTimer = null; // debounce timer for the sidebar search box
let localNotes = []; // flat, parentId-linked: [{id,type,parentId,title,body,createdTime,modifiedTime}]
                      // (real-FS backend adds a live `handle` + `ext` per node; local.js's
                      // IndexedDB fallback leaves those undefined)
let localDbPromise = null; // cached IndexedDB connection promise
let localExpandedFolders = new Set(); // which notes_local folder IDs are open

/* ─── LOCAL REAL-FILESYSTEM BACKEND (js/local.js) ─── */
let localFsSupported = typeof window !== "undefined" && !!window.showDirectoryPicker;
let localRootHandle = null; // live FileSystemDirectoryHandle for the connected AndysNote/ folder
let localFsConnected = false; // true once localRootHandle is loaded/granted and the folder has been scanned

/* ─── SETTINGS (single app-wide global state; logic lives in settings.js) ─── */
let appSettings = null; // one settings object: { ui, font, behavior } — mutate only via setSetting()
let settingsActiveTab = "library"; // which settings-panel tab is open: "library" | "fonts" | "calendar" | ...

/* ─── BULK SYNC (js/sync.js — Drive <-> local one-shot copy) ─── */
let bulkSyncInProgress = false; // guards against double-clicking push/pull

/* ─── DRIVE CACHE (IndexedDB performance layer) ─── */
let driveCacheDbPromise = null; // cached IndexedDB connection for the Drive cache
let driveTreeFullyLoaded = false; // true once every Drive subtree has been loaded
let driveFullLoadPromise = null; // in-flight loadEntireTree() promise (dedupe)
let folderLoadPromises = {}; // in-flight ensureFolderLoaded() promises by folderId

/* ─── PLANNER (js/planner.js — day-view 10-minute planner) ─── */
let plannerFolderId = null; // Drive ID of "AndysNote/Calendar/" (also the sidebar-hide filter key)
let plannerFolderResolvePromise = null; // in-flight resolvePlannerFolderId() promise (dedupe)
let plannerDbPromise = null; // cached IndexedDB connection for the offline planner store
let plannerColors = null; // [{id:"c1",name:""}, ...] once loaded; null = not loaded yet
let plannerColorsFileId = null; // Drive file ID of colors.json, or null if not created yet
let plannerColorsSaveTimer = null;
let plannerMonthCache = {}; // "YYYY-MM" -> { fileId, data, dirty } (data: {"YYYY-MM-DD": {"HH:MM":"c1"}})
let plannerDirtyMonths = new Set(); // monthKeys with unsaved paint changes
let plannerSaveTimer = null;
let plannerActiveColorId = "c1";
let plannerEraseMode = false;
let plannerIsPainting = false;
let plannerPaintValue = null; // "c1".."c5" or null (eraser) — fixed once per drag gesture
let plannerLastPaintedSlot = null; // dedupe re-entering the same cell during a drag
let plannerCurrentDayKey = null; // "YYYY-MM-DD" of the day view currently being rendered (stale-response guard)
let plannerStatsToken = 0; // bumped on every renderPlannerStats() call (stale-response guard for the summary view)
