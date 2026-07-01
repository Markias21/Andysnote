/* ─── IN-MEMORY TREE (Drive is source of truth) ─── */
// Node: { id, name, mimeType, createdTime, modifiedTime, children: [] }
let driveTree = []; // top-level children of Writer/
let writerRootId = null; // Drive folder ID of "Writer/"
let expandedFolders = new Set(); // which folder IDs are open in sidebar
let currentFileId = null; // Drive file ID of the open document
let calDate = new Date();
let driveSaveTimer = null;

/* ─── OAUTH / GAPI ─── */
let tokenClient_tc = null;
let gapiInited = false;
let gisInited = false;
let driveAccessToken = null;

/* ─── STORAGE MODE / LOCAL (BROWSER) NOTES ─── */
let storageMode = "drive"; // backend of the currently-open doc: "drive" | "local"
let localSaveTimer = null; // debounce timer for local autosave
let localNotes = []; // browser-stored notes+folders: [{id,type,parentId,title,body,createdTime,modifiedTime}]
let localDbPromise = null; // cached IndexedDB connection promise
let localExpandedFolders = new Set(); // which notes_local folder IDs are open

/* ─── DRIVE CACHE (IndexedDB performance layer) ─── */
let driveCacheDbPromise = null; // cached IndexedDB connection for the Drive cache
let driveTreeFullyLoaded = false; // true once every Drive subtree has been loaded
let driveFullLoadPromise = null; // in-flight loadEntireTree() promise (dedupe)
