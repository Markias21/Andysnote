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

## Drive performance: lazy load + IndexedDB cache (why it's shaped this way)

Drive nav is lazy + cache-first, NOT an eager full crawl. `js/cache.js` (separate db `andysnotes-cache`, stores `treeChildren` per folderId + `docContent` per fileId) is a performance layer only — Drive stays source of truth.

- **Never eagerly crawl the whole tree.** The old `loadSubtree` did N serial API calls before first paint. Now `initDriveFilesystem` paints root from cache instantly, then revalidates only the root level (`loadChildrenShallow`). A folder's children load on first expand (`ensureFolderLoaded` via `toggleFolder`); nodes carry a `loaded` flag. `mergeChildren` preserves already-loaded subtrees when a level is revalidated (else you discard deeper loaded data).
- **openDoc is stale-while-revalidate.** Paint cached body instantly, then ALWAYS re-fetch from Drive. Do NOT hard-skip the network on timestamp equality — `node.modifiedTime` is client/tree-derived and can be stale (external edits) → would serve stale content forever. **Why:** correctness must not depend on cache alone. Guard: only overwrite the visible body if `body.innerText === paintedText` (user hasn't started editing), and re-check `currentFileId !== node.id` after every await (rapid doc-switch race).
- **Search needs the whole tree**, which breaks under lazy loading. `filterDocs` calls `loadEntireTree()` (parallel deep load, cached) when a query is present. `driveTreeFullyLoaded` gates it; **only set it true when EVERY subtree succeeded** (`deepLoadNodes` returns all-success bool) — else a transient failure permanently locks search into a partial view. `driveFullLoadPromise` dedupes concurrent calls. Both reset on sign-in/out.
- **Cache invalidation:** only *create* mutates the Drive tree (no Drive delete/rename exists). After create, call `syncFolderCache(parentId)` (+ `cachePutDoc` for new files); after `saveToDriveNow`, `cachePutDoc(id, text, stamp)` keeps the body cache fresh.
- Folder-count badge shows "" until a folder is `loaded` (avoids a misleading "0" on unopened folders); unopened+open folders show a "Loading…" row.

## Autosave data-loss guard (why flush-on-switch exists)

Both backends autosave on a debounce timer (`driveSaveTimer` 3s, `localSaveTimer` 1.2s) that reads mutable globals (`currentFileId`, editor DOM) at fire time. A delayed timer could patch/overwrite the WRONG doc after navigation. **Rule:** every doc-switch entry point (`openDoc`, `openLocalNote`) must `await flushDriveSave(); await flushLocalSave();` BEFORE changing `currentFileId`/`storageMode`. Each flush clears its timer and, if its mode is active AND dirty, saves synchronously first. Any global-state reset (esp. `handleSignoutClick`) must be mode-aware or it wipes the open local note.

**Dirty gating (why flush must NOT save unconditionally):** flush-on-switch used to PATCH Drive / write IndexedDB on EVERY navigation even when the doc was only read — a wasteful network write per note click, a real slowness source. Now `driveDirty`/`localDirty` (state.js) are set in `scheduleDriveSave`/`scheduleLocalSave`, cleared on successful save, and flush only saves when dirty. **Flags are boolean+global, not per-file**, so every doc-open (`openDoc`/`openLocalNote`) resets BOTH flags to false right after setting `currentFileId` — otherwise a failed prior flush leaves a stale-true flag that would later be applied to the wrong (next) doc. Known accepted limitation: flush-save errors are swallowed, so navigation still proceeds if a save fails (pre-existing; not a regression of the dirty change).

## Editor I/O quirk

`#doc-title` is a `<textarea>` → use `.value`. `#doc-body` is a contenteditable `<div>` → use `.innerText` (NOT `.value`). Both Drive and Local paths now correctly use `.innerText` for the body; the old Drive `.value`-on-a-div bug (edits silently lost) is fixed.

**Editor is plain-text-only, indent is the ONLY affordance (why it's shaped this way):** all rich-text features (bold/italic/underline/heading/quote/list) and `execCmd`/`document.execCommand` were removed. `#doc-body` is `contenteditable="plaintext-only"` so keyboard shortcuts (Ctrl+B) and rich paste can't reintroduce formatting. The single toolbar "Indent" button calls `indentParagraph()`. **Indent is a boolean TOGGLE, not accumulating** — repeated clicks flip the caret's paragraph ON/OFF between one fixed step (`paddingLeft:24px`, `data-indent:"1"`) and none; it does NOT keep increasing. **Indent is a UI-render-only effect that is intentionally NOT persisted:** it sets `block.style.paddingLeft` on the caret's top-level block; saves read `.innerText`, which ignores padding, so saved text stays flat plain text and reopening shows it un-indented — this is a deliberate requirement, not a bug. **Why block-per-line:** `setDocBody` → `renderBodyBlocks` renders text as one `<div>` per line (empty line = `<div><br></div>`, uses `textContent` = XSS-safe) so indent can target a single paragraph and `.innerText` round-trips to identical plain text. BOTH backends must go through `setDocBody` — `openLocalNote` was fixed to use it (a raw `body.innerText = ...` produces `<br>` separators, no per-line blocks, so indent can't target one paragraph). `currentEditableBlock` climbs to the direct child of `#doc-body`, wrapping a bare first-line text node in a `<div>` first. `openDoc` revalidation only re-renders when fetched text differs from what's shown, so a background refresh can't wipe an applied indent on unchanged content.
