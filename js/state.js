/* ─── IN-MEMORY TREE (Drive is source of truth) ─── */
// Node: { id, name, mimeType, createdTime, modifiedTime, children: [] }
let driveTree = []; // top-level children of AndysNote/
let andysNoteRootId = null; // Drive folder ID of "AndysNote/"
let expandedFolders = new Set(); // which folder IDs are open in sidebar
let currentFileId = null; // Drive file ID of the open document
let calDate = new Date();
let calViewMode = "month"; // "month" | "day" — "day" drills into a single date's full entry list
let calSelectedDay = null; // { year, month, day } when calViewMode === "day"
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
let localNotes = []; // browser-stored notes+folders: [{id,type,parentId,title,body,createdTime,modifiedTime}]
let localDbPromise = null; // cached IndexedDB connection promise
let localExpandedFolders = new Set(); // which notes_local folder IDs are open

/* ─── SETTINGS (single app-wide global state; logic lives in settings.js) ─── */
let appSettings = null; // one settings object: { ui, font, behavior } — mutate only via setSetting()
let settingsActiveTab = "library"; // which settings-panel tab is open: "library" | "fonts" | "calendar" | ...

/* ─── DRIVE CACHE (IndexedDB performance layer) ─── */
let driveCacheDbPromise = null; // cached IndexedDB connection for the Drive cache
let driveTreeFullyLoaded = false; // true once every Drive subtree has been loaded
let driveFullLoadPromise = null; // in-flight loadEntireTree() promise (dedupe)
let folderLoadPromises = {}; // in-flight ensureFolderLoaded() promises by folderId
