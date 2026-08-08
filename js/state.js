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
let isSilentAuthAttempt = false; // true while requestAccessToken({prompt:""}) is in flight (auto restore) — suppresses the error toast on failure

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
let appSettings = null; // one settings object: { ui, font, behavior, security } — mutate only via setSetting()
let settingsActiveTab = "library"; // which settings-panel tab is open: "library" | "fonts" | "calendar" | ...

/* ─── APP LOCK (4-digit PIN gate; logic lives in js/lock.js) ─────────────
   Gates entry into a Google-signed-in session only (see requireAppLock() in
   js/lock.js) — local-only mode is never gated. */
let appLockPendingResolve = null; // resolver for the in-flight requireAppLock() promise, or null when no gate is active
let appLockRecoveryArmed = false; // true only right after "forgot PIN" sign-out; the next successful sign-in clears the PIN instead of asking for it

/* ─── BULK SYNC (js/sync.js — Drive <-> local one-shot copy) ─── */
let bulkSyncInProgress = false; // guards against double-clicking push/pull

/* ─── DRIVE CACHE (IndexedDB performance layer) ─── */
let driveCacheDbPromise = null; // cached IndexedDB connection for the Drive cache
let driveTreeFullyLoaded = false; // true once every Drive subtree has been loaded
let driveFullLoadPromise = null; // in-flight loadEntireTree() promise (dedupe)
let folderLoadPromises = {}; // in-flight ensureFolderLoaded() promises by folderId

/* ─── PLANNER (js/planner.js — day-view 10-minute planner) ───────────────────
   Activity names are per-day (each day gets its own {labels, slots} entry in
   plannerMonthCache); plannerLastLabels is only the "recent names" seed
   cloned into a brand-new day, never a live shared mapping. */
let plannerFolderId = null; // Drive ID of "AndysNote/Calendar/" (also the sidebar-hide filter key)
let plannerFolderResolvePromise = null; // in-flight resolvePlannerFolderId() promise (dedupe)
let plannerDbPromise = null; // cached IndexedDB connection for the offline planner store
let plannerLastLabels = null; // {c1:"",...,c5:""} seed for new days once loaded; null = not loaded yet
let plannerColorIds = null; // ["c1",...] active palette ids, user-extendable via the legend's + button; null = not loaded yet
let plannerColorPercents = null; // {c1:22,...} color-mix % per id (see applyPlannerColorVars in planner.js); null = not loaded yet
let plannerLastLabelsFileId = null; // Drive file ID of lastLabels.json, or null if not created yet
let plannerLastLabelsSaveTimer = null;
let plannerCurrentDayLabels = null; // {c1..c5} labels object for the day view currently rendered
let plannerMonthCache = {}; // "YYYY-MM" -> { fileId, data, dirty }
                             // data: {"YYYY-MM-DD": {labels:{c1..c5}, slots:{"HH:MM":"c1"}}}
let plannerDirtyMonths = new Set(); // monthKeys with unsaved paint/name changes
let plannerSaveTimer = null;
let plannerActiveColorId = "c1";
let plannerEraseMode = false;
let plannerIsPainting = false;
let plannerPaintValue = null; // "c1".."c5" or null (eraser) — fixed once per drag gesture
let plannerLastPaintedSlot = null; // dedupe re-entering the same cell during a drag
let plannerCurrentDayKey = null; // "YYYY-MM-DD" of the day view currently being rendered (stale-response guard)
let plannerStatsToken = 0; // bumped on every renderPlannerStats() call (stale-response guard for the summary view)

/* ─── ANDYSLETTER (js/letter.js, js/letter/*.js) ──────────────────────────
   AndysLetter's own sign-in is independent of driveAccessToken above — a
   user can be signed into Drive, AndysLetter, both, or neither. */
let letterSb = null; // the supabase-js client instance, created once by js/letter/api.js
let letterSession = null; // current Supabase auth session, or null when signed out
let letterProfile = null; // this user's letter_users row ({postcode,display_name,status,is_admin,...}), or null before it's loaded/created
let letterViewMode = "inbox"; // active tab: "inbox" | "sent" | "contacts" | "admin"
let letterInbox = null; // cached received letters (array), null = not loaded yet
let letterSent = null; // cached sent letters (array), null = not loaded yet
let letterContacts = null; // cached address book rows (array), null = not loaded yet
let letterOpenId = null; // id of the letter shown in detail view, overlaying the active tab; null = tab's list is shown
let letterComposeOpen = false; // true while the compose form is shown, overlaying the active tab
let letterComposeDraft = null; // { toPostcode, senderName, recipientName, subject, body, paperId, envelopeColor, fontId } — prefilled when opened from a contact or a reply
let letterAdminUsers = null; // cached admin user list (array), null = not loaded yet (admin view only)
let letterAuthMode = "signin"; // "signin" | "signup" — which form the email/password sign-in screen shows
let letterPostcodeCheckTimer = null; // debounce timer for the compose form's live postcode-exists check
