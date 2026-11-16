// Persistence: the data lives in IndexedDB (database nurturelink.v1, one record, versioned) and falls back to memory
// when IndexedDB is missing, blocked or fails. The session and the language use two small localStorage keys.
// Every call is wrapped so a storage problem never stops the app.
import { DB_NAME, SCHEMA_VERSION, SESSION_KEY } from './schema.js';

const STORE = 'state';
const KEY = 'snapshot';
const LOAD_TIMEOUT_MS = 1500;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(indexedDb) {
  return new Promise((resolve, reject) => {
    const req = indexedDb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

export function createPersistence({
  indexedDb = globalThis.indexedDB,
  storage = globalThis.localStorage,
  timeoutMs = LOAD_TIMEOUT_MS,
} = {}) {
  let memory = null; // the fallback copy
  let usingMemory = !indexedDb;
  let database = null;

  async function db() {
    if (!database) database = await openDatabase(indexedDb);
    return database;
  }
  const fail = () => {
    usingMemory = true;
    database = null;
  };

  async function readSnapshot() {
    const handle = await db();
    return request(handle.transaction(STORE, 'readonly').objectStore(STORE).get(KEY));
  }

  return {
    /** The stored data, or null when there is none, it has another schema version, or storage failed. */
    async load() {
      let snapshot = null;
      if (!usingMemory) {
        try {
          snapshot = await Promise.race([
            readSnapshot(),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('IndexedDB timed out')), timeoutMs);
            }),
          ]);
        } catch {
          fail();
        }
      }
      if (usingMemory) snapshot = memory;
      return snapshot && snapshot.schemaVersion === SCHEMA_VERSION ? snapshot : null;
    },

    async save(snapshot) {
      memory = snapshot;
      if (usingMemory) return;
      try {
        const handle = await db();
        await request(handle.transaction(STORE, 'readwrite').objectStore(STORE).put(snapshot, KEY));
      } catch {
        fail();
      }
    },

    async clear() {
      memory = null;
      if (usingMemory) return;
      try {
        const handle = await db();
        await request(handle.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY));
      } catch {
        fail();
      }
    },

    isUsingMemory: () => usingMemory,

    loadSession() {
      try {
        const raw = storage?.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    saveSession(session) {
      try {
        if (session) storage?.setItem(SESSION_KEY, JSON.stringify(session));
        else storage?.removeItem(SESSION_KEY);
      } catch {
        // storage unavailable: the session lasts until the page is closed
      }
    },
  };
}

/**
 * Save the data when it changes. The first change after a quiet moment is saved on the next tick, so a refresh right
 * after an action keeps it (a page that is closing cannot finish a write); changes in a burst, such as the packets of a
 * check, are saved at most once every delayMs. The page being hidden or closed saves straight away.
 * Returns a function that stops it.
 */
export function attachPersistence(store, persistence, { delayMs = 400, snapshotOf, target = globalThis } = {}) {
  let timer = null;
  let dirty = false;
  let lastWrite = -Infinity;
  const write = () => {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;
    lastWrite = Date.now();
    persistence.save(snapshotOf(store.getState()));
  };
  const unsubscribe = store.subscribe((state, action) => {
    if (action.type === 'live' || action.type === 'session') return;
    dirty = true;
    if (!timer) timer = setTimeout(write, Math.max(0, lastWrite + delayMs - Date.now()));
  });
  const onPageHide = () => write();
  const onVisibility = () => {
    if (target.document?.visibilityState === 'hidden') write();
  };
  target.addEventListener?.('pagehide', onPageHide);
  target.document?.addEventListener?.('visibilitychange', onVisibility);
  return () => {
    unsubscribe();
    clearTimeout(timer);
    target.removeEventListener?.('pagehide', onPageHide);
    target.document?.removeEventListener?.('visibilitychange', onVisibility);
  };
}
