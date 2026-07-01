---
name: Andysnotes module refactor
description: Conventions for the in-progress index.html → js/ module refactor of the Andysnotes writing app.
---

# Andysnotes module refactor

Status: COMPLETE. All JS extracted from `index.html` inline `<script>` into per-feature files under `js/`: config, state, ui, drive, auth, sidebar, editor, modal, calendar, app. index.html now holds only bootstrap (`<script src>` tags + two Google `<script>` with onload attrs). Dead scaffolding storage.js/local-storage.js deleted (unused). app.js = bootstrap (DOMContentLoaded init + SW registration).

Final load order (locked invariant): config → state → ui → drive → auth → sidebar → editor → modal → calendar → app → Google gsi/api scripts. auth.js MUST stay before the Google scripts (it defines + window-assigns gisLoaded/gapiLoaded which their onload calls).

**Ironclad user rules:** move code only — never rewrite function bodies, never change behavior/features, remove duplicate functions, keep app runnable. Do ONE module per step; user manually smoke-tests (login → load → save) between steps before the next.

**Architecture that makes moving safe:**
- All js files are PLAIN scripts (no ES modules) sharing one global scope.
- Shared state vars (`driveAccessToken`, `driveTree`, `writerRootId`, `currentFileId`, `driveSaveTimer`, `tokenClient_tc`, `gapiInited`, `gisInited`) live in `js/state.js`. Config constants (`DRIVE_SCOPE`, `WRITER_ROOT_NAME`, `FOLDER_MIME`, `FILE_MIME`, `GOOGLE_CLIENT_ID`) in `js/config.js`.
- Because functions are global and only invoked at runtime (after login/user action), you can move whole function declarations between files without worrying about definition order — only the runtime-availability matters.

**Why:** functions freely call each other + UI helpers across files; splitting a single function (e.g. `openDoc`, which mixes editor UI + a Drive content fetch) would be a rewrite and risks behavior drift. Move whole functions to the module that owns them; leave mixed-UI functions for their UI module's step.

**Script load-order invariant:** keep `drive.js` before `auth.js` in index.html (auth's `onSignedIn` calls `initDriveFilesystem`/`driveGet`). Hold this until/unless converting to real ES module imports.

**Verify each step:** `node --check js/<mod>.js`; extract inline block and `node --check`; confirm each moved function has exactly ONE definition across `index.html js/`; confirm callers still exist; `curl` the served files (static server = `python3 -m http.server 8000`, network-first SW so fresh files serve).

**Storage "adapter" pattern (what it actually is):** there is NO registry/class abstraction. Each storage backend = one file of plain top-level functions. GoogleDrive = drive.js (source of truth). Local = local.js (real folder on disk via File System Access API — `showDirectoryPicker` → `getDirectoryHandle`/`getFileHandle`/`createWritable`; creates folders + .txt exactly like Drive). To add a backend, add another such file — do NOT introduce a `const XxxRepository` object or `window.Repositories` registry: those count as new top-level globals and violate the globals-only-in-config/state rule. Function declarations are fine; top-level `const`/`let` state is not.

**Dual-mode switch (`storageMode` = "drive"|"local", in state.js):** both modes REUSE the same workspace globals `driveTree`/`writerRootId`/`currentFileId`/`expandedFolders`, so sidebar/modal/calendar/editor render unchanged. Only the backend ops branch on `storageMode` at these seams: `drive.saveDoc`, `editor.openDoc`+`onBodyInput`, `modal.createItem`, `sidebar.renderSidebar`, `auth.onSignedIn`/`handleSignoutClick`. Local node ids are synthetic (`"L"+counter`) mapped to FileSystemHandles in `localHandles` (avoids inline-onclick quoting issues with real paths). **Why:** minimal surgical branching keeps Drive behavior intact while adding Local. **Gotchas learned:** (1) any global-state reset (esp. `handleSignoutClick`) must be mode-aware or it wipes the active local workspace; (2) `getFileHandle/getDirectoryHandle({create:true})` REUSE existing entries, so guard name collisions before inserting a new tree node or you get duplicates.

**Editor I/O:** `#doc-title` is a textarea (`.value`); `#doc-body` is a contenteditable `<div>` — local read/write uses `.innerText`. NOTE pre-existing Drive bug (out of scope, left as-is): `drive.js` openDoc/saveToDriveNow use `.value` on `#doc-body`, which is wrong for a div (edits not saved). Local code does it correctly with `.innerText`.
