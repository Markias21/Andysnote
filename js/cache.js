/* ─── DRIVE CACHE (IndexedDB performance layer) ───
   Persists the Drive folder tree (per-folder direct children) and opened note
   bodies so navigation is instant across reloads and Drive API calls are
   minimized. This is a performance layer only: Drive stays the source of truth,
   and every cached value is revalidated against Drive in the background after
   it has been shown. All helpers fail soft (resolve null / no-op on error) so a
   cache miss or a blocked IndexedDB never breaks the app. */

function cacheOpenDb() {
  if (driveCacheDbPromise) return driveCacheDbPromise;
  driveCacheDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DRIVE_CACHE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_TREE_STORE))
        db.createObjectStore(CACHE_TREE_STORE, { keyPath: "folderId" });
      if (!db.objectStoreNames.contains(CACHE_DOC_STORE))
        db.createObjectStore(CACHE_DOC_STORE, { keyPath: "fileId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return driveCacheDbPromise;
}

function cacheIdbGet(store, key) {
  return cacheOpenDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }),
  );
}

function cacheIdbPut(store, value) {
  return cacheOpenDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function cacheIdbDelete(store, key) {
  return cacheOpenDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/* ── Tree children cache ── */
// Store only lightweight descriptors (no nested children) per folder.
function cacheGetChildren(folderId) {
  return cacheIdbGet(CACHE_TREE_STORE, folderId)
    .then((rec) => (rec && Array.isArray(rec.children) ? rec.children : null))
    .catch(() => null);
}

function cachePutChildren(folderId, items) {
  const light = (items || []).map((c) => ({
    id: c.id,
    name: c.name,
    mimeType: c.mimeType,
    createdTime: c.createdTime,
    modifiedTime: c.modifiedTime,
  }));
  return cacheIdbPut(CACHE_TREE_STORE, {
    folderId,
    children: light,
    cachedAt: Date.now(),
  }).catch(() => {});
}

/* ── Document body cache ── */
function cacheGetDoc(fileId) {
  return cacheIdbGet(CACHE_DOC_STORE, fileId).catch(() => null);
}

function cachePutDoc(fileId, text, modifiedTime) {
  return cacheIdbPut(CACHE_DOC_STORE, {
    fileId,
    text,
    modifiedTime: modifiedTime || null,
    cachedAt: Date.now(),
  }).catch(() => {});
}

function cacheDeleteDoc(fileId) {
  return cacheIdbDelete(CACHE_DOC_STORE, fileId).catch(() => {});
}
