/**
 * db-browser.js – IndexedDB + OPFS wrapper for MyOwnHub
 * Stores book metadata + shortcut data in IndexedDB.
 * Stores actual ebook files in OPFS (falls back to IndexedDB blobs).
 */

const DB_NAME = "myownhub";
const DB_VERSION = 1;
let _db = null;

// ─── Open DB ─────────────────────────────────────────────────

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("books")) {
        const bs = db.createObjectStore("books", { keyPath: "id", autoIncrement: true });
        bs.createIndex("title", "title");
        bs.createIndex("added_at", "added_at");
      }
      if (!db.objectStoreNames.contains("shortcuts")) {
        db.createObjectStore("shortcuts", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("files")) {
        // Fallback file storage when OPFS unavailable
        db.createObjectStore("files", { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const req = fn(store);
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
      }),
  );
}

// ─── Books ───────────────────────────────────────────────────

function addBook(meta) {
  return tx("books", "readwrite", (s) => s.add(meta));
}

function getBook(id) {
  return tx("books", "readonly", (s) => s.get(Number(id)));
}

function getAllBooks() {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const t = db.transaction("books", "readonly");
      const req = t.objectStore("books").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function updateBook(id, patch) {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const t = db.transaction("books", "readwrite");
      const store = t.objectStore("books");
      const getReq = store.get(Number(id));
      getReq.onsuccess = () => {
        const updated = Object.assign({}, getReq.result, patch);
        store.put(updated);
      };
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  });
}

function deleteBook(id) {
  return tx("books", "readwrite", (s) => s.delete(Number(id)));
}

// ─── Shortcuts ───────────────────────────────────────────────

function addShortcut(data) {
  return tx("shortcuts", "readwrite", (s) => s.add(data));
}

function getAllShortcuts() {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const t = db.transaction("shortcuts", "readonly");
      const req = t.objectStore("shortcuts").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function updateShortcut(id, patch) {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const t = db.transaction("shortcuts", "readwrite");
      const store = t.objectStore("shortcuts");
      const getReq = store.get(Number(id));
      getReq.onsuccess = () => {
        const updated = Object.assign({}, getReq.result, patch);
        store.put(updated);
      };
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  });
}

function deleteShortcut(id) {
  return tx("shortcuts", "readwrite", (s) => s.delete(Number(id)));
}

// ─── File storage (OPFS with IndexedDB fallback) ─────────────

const hasOPFS =
  typeof navigator !== "undefined" &&
  "storage" in navigator &&
  "getDirectory" in navigator.storage;

async function _opfsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("books", { create: true });
}

async function saveBookFile(id, arrayBuffer) {
  if (hasOPFS) {
    try {
      const dir = await _opfsDir();
      const fh = await dir.getFileHandle(String(id), { create: true });
      const w = await fh.createWritable();
      await w.write(arrayBuffer);
      await w.close();
      return;
    } catch (e) {
      console.warn("OPFS write failed, falling back to IndexedDB", e);
    }
  }
  // Fallback: store ArrayBuffer in IndexedDB
  await new Promise((resolve, reject) => {
    openDb().then((db) => {
      const t = db.transaction("files", "readwrite");
      t.objectStore("files").put({ id: Number(id), data: arrayBuffer });
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  });
}

async function loadBookFile(id) {
  if (hasOPFS) {
    try {
      const dir = await _opfsDir();
      const fh = await dir.getFileHandle(String(id));
      const file = await fh.getFile();
      return file.arrayBuffer();
    } catch (e) {
      // fall through to IndexedDB
    }
  }
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const t = db.transaction("files", "readonly");
      const req = t.objectStore("files").get(Number(id));
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => reject(req.error);
    });
  });
}

async function deleteBookFile(id) {
  if (hasOPFS) {
    try {
      const dir = await _opfsDir();
      await dir.removeEntry(String(id));
    } catch (_) {}
  }
  await tx("files", "readwrite", (s) => s.delete(Number(id)));
}
