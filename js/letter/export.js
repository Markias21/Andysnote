/* ─── ANDYSLETTER: EXPORT TO DRIVE / LOCAL ──────────────────────────────────
   This is the moment a letter stops being in-transit Supabase mail and
   becomes a real user document — a plain .md file, readable with Notepad,
   per docs/PRINCIPLE.md §2/§4. Reuses the exact same helpers the rest of
   the app uses to write documents (js/sync.js's findOrCreateDriveFolder/
   createDriveFile, js/config.js's buildStoredName) rather than inventing a
   parallel save path.

   Decision log (2026-08-08): if the user is signed into Google Drive, the
   letter is saved to Drive and only THEN archived out of Supabase (saving
   free-tier storage). If not, it's saved as a local note instead — and the
   Supabase original is left in place, since a local note lives on one
   device only and shouldn't be the sole copy. */

async function letterExportToDrive(letterId) {
  const letter = letterFindOpenLetter(letterId);
  if (!letter) return;
  setSyncStatus("saving", t("letter.exporting"));
  try {
    const folderId = await findOrCreateDriveFolder(LETTER_FOLDER_NAME, andysNoteRootId);
    const filename = buildStoredName(letterExportTitle(letter), ".md", new Date(letter.sent_at));
    await createDriveFile(filename, folderId, letterBuildMarkdown(letter));

    // Drive save is confirmed (createDriveFile didn't throw) — safe to free
    // the Supabase copy now. letterApiArchive only clears this user's side;
    // the sender/recipient keeps theirs until they export too.
    await letterApiArchive(letter.id);
    letterRemoveFromCache(letter.id);
    letterCloseDetail();
    setSyncStatus("saved", t("letter.exportDone"));
  } catch (e) {
    console.error("letterExportToDrive failed", e);
    setSyncStatus("error", t("letter.exportFailed"), true);
  }
}

async function letterExportToLocal(letterId) {
  const letter = letterFindOpenLetter(letterId);
  if (!letter) return;
  setSyncStatus("saving", t("letter.exporting"));
  try {
    const folderId = await letterResolveLocalFolderId();
    await letterCreateLocalFile(folderId, letterExportTitle(letter), ".md", letterBuildMarkdown(letter));
    // Deliberately NOT archiving out of Supabase here — a local note only
    // exists on this device/browser, so the Supabase copy stays as the
    // reachable-from-anywhere original (see decision log above).
    letterCloseDetail();
    setSyncStatus("saved", t("letter.exportDone"));
  } catch (e) {
    console.error("letterExportToLocal failed", e);
    setSyncStatus("error", t("letter.exportFailed"), true);
  }
}

/* Removes a letter from AndysLetter without exporting it anywhere — uses
   the same per-side archive RPC as export, just without a save first. */
async function letterDeleteOpenLetter() {
  const letter = letterFindOpenLetter(letterOpenId);
  if (!letter) return;
  if (!confirm(t("letter.deleteConfirm"))) return;
  try {
    await letterApiArchive(letter.id);
    letterRemoveFromCache(letter.id);
    letterCloseDetail();
  } catch (e) {
    console.error("letterDeleteOpenLetter failed", e);
    setSyncStatus("error", t("letter.actionFailed"));
  }
}

function letterExportTitle(letter) {
  const subject = (letter.subject || "").trim();
  return subject || t("letter.composeHeading");
}

function letterBuildMarkdown(letter) {
  const lines = [
    "---",
    `${t("letter.fromLabel")}: ${letter.sender_name} (${letter.sender_postcode})`,
    `${t("letter.toLabel")}: ${letter.recipient_name} (${letter.recipient_postcode})`,
    `${t("letter.sentAtLabel")}: ${letterFormatDateTime(letter.sent_at)}`,
    `${t("letter.paperLabel")}: ${letterPaperLabel(letter.paper_id)}`,
    "---",
    "",
    letter.body || "",
  ];
  return lines.join("\n");
}

/* ─── LOCAL "Letters" FOLDER (mirrors the Drive side's findOrCreateDriveFolder) ───
   Built entirely on js/local.js's existing public surface (createLocalFolder,
   renameLocalNote, getLocalRootNodes) plus its lower-level real-FS helpers
   (resolveParentDirHandle, uniqueLocalName) — no changes to local.js itself. */
async function letterResolveLocalFolderId() {
  let folder = getLocalRootNodes().find((n) => n.type === "folder" && n.title === LETTER_FOLDER_NAME);
  if (folder) return folder.id;

  const beforeIds = new Set(getLocalRootNodes().map((n) => n.id));
  await createLocalFolder(null);
  const created = getLocalRootNodes().find((n) => n.type === "folder" && !beforeIds.has(n.id));
  if (!created) throw new Error("LOCAL_FOLDER_CREATE_FAILED");
  await renameLocalNote(created.id, LETTER_FOLDER_NAME);
  return created.id;
}

async function letterCreateLocalFile(folderId, title, ext, bodyText) {
  if (localFsSupported && localFsConnected) {
    return letterCreateLocalFileFs(folderId, title, ext, bodyText);
  }
  const now = new Date().toISOString();
  const note = {
    id: genLocalId(),
    type: "note",
    parentId: folderId,
    title,
    body: bodyText,
    createdTime: now,
    modifiedTime: now,
  };
  await localDbPut(note);
  localNotes.push(note);
  renderLocalNotes(currentSearchValue());
  return note.id;
}

async function letterCreateLocalFileFs(folderId, title, ext, bodyText) {
  const dir = resolveParentDirHandle(folderId);
  if (!dir) throw new Error("LOCAL_FOLDER_HANDLE_MISSING");
  const now = new Date();
  const { name, title: dedupedTitle } = await uniqueLocalName(dir, title, (candidate) =>
    buildStoredName(candidate, ext, now),
  );
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bodyText);
  await writable.close();
  const node = {
    id: genLocalId(),
    type: "note",
    parentId: folderId,
    title: dedupedTitle,
    name,
    body: bodyText,
    createdTime: now.toISOString(),
    modifiedTime: now.toISOString(),
    handle,
    ext,
  };
  localNotes.push(node);
  renderLocalNotes(currentSearchValue());
  return node.id;
}
