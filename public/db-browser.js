"use strict";

const DB_NAME = "myownhub";
const DB_VERSION = 1;
let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("websites")) {
        const ws = db.createObjectStore("websites", { keyPath: "id", autoIncrement: true });
        ws.createIndex("added_at", "added_at");
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
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

function addWebsite(data) {
  return tx("websites", "readwrite", (s) => s.add(data));
}

function getAllWebsites() {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const t = db.transaction("websites", "readonly");
      const req = t.objectStore("websites").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function updateWebsite(id, patch) {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const t = db.transaction("websites", "readwrite");
      const store = t.objectStore("websites");
      const getReq = store.get(Number(id));
      getReq.onsuccess = () => {
        store.put(Object.assign({}, getReq.result, patch));
      };
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  });
}

function deleteWebsite(id) {
  return tx("websites", "readwrite", (s) => s.delete(Number(id)));
}
