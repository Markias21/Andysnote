/* ─── MODAL ─── */
function onModalTypeChange(type) {
  const heading = document.getElementById("modal-heading");
  const titleInput = document.getElementById("modal-title");
  if (type === "folder") {
    heading.textContent = t("modal.newFolder");
    titleInput.placeholder = t("modal.folderNamePlaceholder");
  } else {
    heading.textContent = t("modal.newDocument");
    titleInput.placeholder = t("modal.docTitlePlaceholder");
  }
}

// type ("doc" | "doc-md") -> { ext, mimeType } for the file about to be created.
function docFileSpec(type) {
  return type === "doc-md"
    ? { ext: ".md", mimeType: MARKDOWN_MIME }
    : { ext: ".txt", mimeType: FILE_MIME };
}

function populateModalFolders() {
  const sel = document.getElementById("modal-folder");
  populateDriveFolderSelect(sel, '<option value="">' + escapeHtml(t("modal.rootFolderOption")) + "</option>");
}

function openModal(folderId = null, type = "doc") {
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.add("open");
  const typeEl = document.getElementById("modal-type");
  if (typeEl) {
    typeEl.value = type;
    onModalTypeChange(type);
  }
  document.getElementById("modal-title").value = "";
  document.getElementById("modal-folder").style.borderColor = "";
  populateModalFolders();
  if (folderId) document.getElementById("modal-folder").value = folderId;
  setTimeout(() => document.getElementById("modal-title").focus(), 50);
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}

function closeModalOutside(e) {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
}

async function createItem() {
  const title = document.getElementById("modal-title").value.trim();
  const typeEl = document.getElementById("modal-type");
  const type = typeEl ? typeEl.value : "doc";
  const folderEl = document.getElementById("modal-folder");
  const folderId = folderEl.value || andysNoteRootId;

  if (!title) {
    document.getElementById("modal-title").style.borderColor =
      "var(--accent)";
    return;
  }
  if (!folderId) {
    folderEl.style.borderColor = "var(--accent)";
    return;
  }

  closeModal();
  setSyncStatus("saving", t("sync.creating"));

  try {
    if (type === "folder") {
      const created = await drivePost(
        "https://www.googleapis.com/drive/v3/files",
        { name: title, mimeType: FOLDER_MIME, parents: [folderId] },
      );
      const newNode = {
        id: created.id,
        name: title,
        mimeType: FOLDER_MIME,
        createdTime: new Date().toISOString(),
        modifiedTime: new Date().toISOString(),
        children: [],
        loaded: true,
      };
      insertIntoTree(newNode, folderId);
      syncFolderCache(folderId);
      expandedFolders.add(folderId);
      renderSidebar();
      populateModalFolders();
      setSyncStatus(
        "saved",
        t("sync.folderCreated") + " \u00b7 " + formatTime(new Date()),
      );
    } else {
      const { ext, mimeType } = docFileSpec(type);
      const fileName = title.endsWith(ext) ? title : title + ext;
      const created = await drivePost(
        "https://www.googleapis.com/upload/drive/v3/files",
        { name: fileName, mimeType, parents: [folderId] },
        "",
      );
      const newNode = {
        id: created.id,
        name: fileName,
        mimeType,
        createdTime: new Date().toISOString(),
        modifiedTime: new Date().toISOString(),
        children: [],
        loaded: true,
      };
      insertIntoTree(newNode, folderId);
      syncFolderCache(folderId);
      cachePutDoc(created.id, "", newNode.modifiedTime);
      expandedFolders.add(folderId);
      renderSidebar();
      await openDoc(newNode);
    }
  } catch (e) {
    console.error("createItem error", e);
    setSyncStatus(
      "error",
      t("sync.createFailed") + " \u00b7 " + formatTime(new Date()),
      true,
    );
  }
}

function insertIntoTree(node, parentId) {
  const sort = (arr) => arr.sort((a, b) => a.name.localeCompare(b.name));
  if (parentId === andysNoteRootId) {
    driveTree.push(node);
    sort(driveTree);
    return;
  }
  function insert(nodes) {
    for (const n of nodes) {
      if (n.id === parentId) {
        n.children.push(node);
        sort(n.children);
        return true;
      }
      if (n.mimeType === FOLDER_MIME && insert(n.children)) return true;
    }
    return false;
  }
  insert(driveTree);
}
