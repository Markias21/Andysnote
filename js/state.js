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

/* ─── STORAGE MODE / LOCAL FILESYSTEM ─── */
let storageMode = "drive"; // "drive" | "local"
let localRootHandle = null; // FileSystemDirectoryHandle for the local workspace root
let localHandles = {}; // synthetic node id -> { handle, parentId, name, kind }
let localIdCounter = 0; // generates unique local node ids
let localSaveTimer = null; // debounce timer for local autosave
