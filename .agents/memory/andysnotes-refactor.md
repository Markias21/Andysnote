---
name: Andysnotes architecture
description: Architecture + conventions for the Andysnotes writing app (plain-global js/ modules, dual storage backends).
---

# Andysnotes architecture

Pure static site: root `index.html` + per-feature `js/*.js`, served by `python3 server.py` (custom no-cache static server). All JS files are PLAIN classic scripts sharing ONE global scope (no ES modules).

**Globals rule (ironclad):** top-level `let`/`const` state may ONLY be declared in `js/state.js`; config constants ONLY in `js/config.js`. Every other file may declare function declarations only — NO top-level state objects, NO `const XxxRepository`/registry. Function declarations are global and invoked at runtime, so moving whole functions between files is safe; only runtime availability matters.

**Load order (locked):** config → state → ui → drive → auth → sidebar → editor → local → modal → calendar → app → Google gsi/api scripts. auth.js MUST stay before the Google scripts (it defines + window-assigns `gisLoaded`/`gapiLoaded` that their `onload` calls). Keep `drive.js` before `auth.js` (auth's `onSignedIn` calls Drive fns).

## Two coexisting storage backends

There is NO class/registry abstraction — each backend is one file of plain top-level functions.

- **Drive** (`drive.js`): Google Drive via GIS token (full `drive` scope). Folder tree in `driveTree`/`writerRootId`; rendered in sidebar `#folder-list`.
- **Local** (`local.js`): BROWSER-based file I/O, NOT the real OS filesystem. Primary store = IndexedDB (`andysnotes-local` db, `notes` store, keyPath `id`; ids `"local-"+Date.now()+"-"+rand`). Records carry `type:"folder"|"note"` and `parentId` (null=root); backward-compat: missing `type`→note, missing `parentId`→root. Notes add `title,body,createdTime,modifiedTime`; folders omit `body`. Shown in its own sidebar section **notes_local** (`#local-list`) as an expand/collapse tree that MIRRORS the Drive tree UX (folders, nested subfolders, per-folder hover actions: new note / new subfolder / delete-recursive; open-folder state in `localExpandedFolders` Set). It is an app-managed list — NOT a mirror of any OS folder. The OS filesystem is only touched through explicit user-driven `.txt` **export** (`showSaveFilePicker` → `<a download>` fallback) and **import** (`showOpenFilePicker` → hidden `<input type=file>` fallback; imports land at root).

  **Local folder invariants (learned):** (1) folder delete must be ONE IndexedDB transaction (`localDbDeleteMany`) — deleting descendants in a per-id loop can partially fail and orphan children. (2) Rendering is orphan-safe: `localChildrenOf(null)` also surfaces any node whose `parentId` points to a missing/non-folder record, so data can never become invisible. (3) Recursive tree helpers take a `seen` Set cycle-guard against corrupted parent chains. (4) folders are never opened as documents — `openLocalNote` returns early if `type==="folder"`.

**`storageMode` ("drive"|"local", in state.js) is now PER-OPEN-DOCUMENT, not a whole-app mode.** The two backends render simultaneously (Drive folders + notes_local). `storageMode` is set by whichever doc you open: `openDoc` (drive) sets it "drive"; `openLocalNote`/`newLocalNote`/import set it "local". It only gates the save/autosave routing seams: `drive.saveDoc`, `editor.onBodyInput`/`onTitleInput`, `saveToDriveNow`/`saveLocalNow`.

**Prior folder-based local design was fully replaced** — `showDirectoryPicker`, `localRootHandle`, `localHandles`, `localIdCounter`, `localCreateItem`, `openLocalDoc`, `connectLocalFolder` no longer exist. The File-System-Access folder picker was abandoned because it throws SecurityError inside the Replit preview iframe; the download/upload fallback path is what actually works in-preview.

## Autosave data-loss guard (why flush-on-switch exists)

Both backends autosave on a debounce timer (`driveSaveTimer` 3s, `localSaveTimer` 1.2s) that reads mutable globals (`currentFileId`, editor DOM) at fire time. A delayed timer could patch/overwrite the WRONG doc after navigation. **Rule:** every doc-switch entry point (`openDoc`, `openLocalNote`) must `await flushDriveSave(); await flushLocalSave();` BEFORE changing `currentFileId`/`storageMode`. Each flush clears its timer and, if its mode is active, saves synchronously first. Any global-state reset (esp. `handleSignoutClick`) must be mode-aware or it wipes the open local note.

## Editor I/O quirk

`#doc-title` is a `<textarea>` → use `.value`. `#doc-body` is a contenteditable `<div>` → use `.innerText` (NOT `.value`). Both Drive and Local paths now correctly use `.innerText` for the body; the old Drive `.value`-on-a-div bug (edits silently lost) is fixed.
