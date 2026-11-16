import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW } from './helpers.js';
import { createSeed } from '../src/sim/seed.js';
import { attachPersistence, createPersistence } from '../src/store/persist.js';
import { createStore, snapshotOf } from '../src/store/store.js';
import { SCHEMA_VERSION, SESSION_KEY } from '../src/store/schema.js';

function respond(value) {
  const req = { result: value };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

/** The part of IndexedDB the app uses: open, a transaction, one object store with get, put and delete. */
function fakeIndexedDb({ failOpen = false, hang = false, failWrite = false } = {}) {
  const data = new Map();
  return {
    data,
    opened: 0,
    open() {
      this.opened += 1;
      const req = { result: null, error: null };
      queueMicrotask(() => {
        if (hang) return;
        if (failOpen) {
          req.error = new Error('denied');
          req.onerror?.();
          return;
        }
        req.result = {
          createObjectStore() {},
          transaction: () => ({
            objectStore: () => ({
              get: (key) => respond(structuredClone(data.get(key))),
              put(value, key) {
                if (failWrite) {
                  const failing = { error: new Error('quota') };
                  queueMicrotask(() => failing.onerror?.());
                  return failing;
                }
                data.set(key, structuredClone(value));
                return respond(key);
              },
              delete: (key) => {
                data.delete(key);
                return respond(undefined);
              },
            }),
          }),
        };
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function fakeStorage() {
  const map = new Map();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
}

const snapshot = () => snapshotOf({ ...createSeed({ now: NOW }), session: null });

test('the data round trips through IndexedDB', async () => {
  const idb = fakeIndexedDb();
  const persistence = createPersistence({ indexedDb: idb, storage: fakeStorage() });
  assert.equal(await persistence.load(), null, 'nothing stored yet');
  const saved = snapshot();
  await persistence.save(saved);
  assert.deepEqual(await persistence.load(), saved);
  assert.equal(persistence.isUsingMemory(), false);
  // a second visit with a new object reads the same data
  const second = createPersistence({ indexedDb: idb, storage: fakeStorage() });
  assert.deepEqual(await second.load(), saved);
});

test('clearing removes the stored data', async () => {
  const persistence = createPersistence({ indexedDb: fakeIndexedDb(), storage: fakeStorage() });
  await persistence.save(snapshot());
  await persistence.clear();
  assert.equal(await persistence.load(), null);
});

test('data stored with another schema version is dropped so the seed is built again', async () => {
  const idb = fakeIndexedDb();
  const persistence = createPersistence({ indexedDb: idb, storage: fakeStorage() });
  await persistence.save({ ...snapshot(), schemaVersion: SCHEMA_VERSION + 1 });
  assert.equal(await persistence.load(), null);
  await persistence.save({ ...snapshot(), schemaVersion: SCHEMA_VERSION });
  assert.ok(await persistence.load());
});

test('when IndexedDB is missing the data lives in memory and nothing breaks', async () => {
  const persistence = createPersistence({ indexedDb: undefined, storage: fakeStorage() });
  assert.equal(persistence.isUsingMemory(), true);
  assert.equal(await persistence.load(), null);
  const saved = snapshot();
  await persistence.save(saved);
  assert.deepEqual(await persistence.load(), saved);
  await persistence.clear();
  assert.equal(await persistence.load(), null);
});

test('when IndexedDB refuses to open the app falls back to memory and keeps the data', async () => {
  const persistence = createPersistence({ indexedDb: fakeIndexedDb({ failOpen: true }), storage: fakeStorage() });
  assert.equal(await persistence.load(), null);
  assert.equal(persistence.isUsingMemory(), true);
  const saved = snapshot();
  await persistence.save(saved);
  assert.deepEqual(await persistence.load(), saved);
});

test('a write that fails (storage full) switches to memory without losing the copy', async () => {
  const persistence = createPersistence({ indexedDb: fakeIndexedDb({ failWrite: true }), storage: fakeStorage() });
  const saved = snapshot();
  await persistence.save(saved);
  assert.equal(persistence.isUsingMemory(), true);
  assert.deepEqual(await persistence.load(), saved);
});

test('an IndexedDB that never answers does not hold the app up', async () => {
  const persistence = createPersistence({ indexedDb: fakeIndexedDb({ hang: true }), storage: fakeStorage(), timeoutMs: 25 });
  const started = Date.now();
  assert.equal(await persistence.load(), null);
  assert.ok(Date.now() - started < 1000);
  assert.equal(persistence.isUsingMemory(), true);
});

test('the session uses its own small localStorage key', () => {
  const storage = fakeStorage();
  const persistence = createPersistence({ indexedDb: undefined, storage });
  assert.equal(SESSION_KEY, 'nurturelink.session');
  assert.equal(persistence.loadSession(), null);
  persistence.saveSession({ profile_id: 'maricel-dimaculangan', signed_in_at: 5 });
  assert.deepEqual(JSON.parse(storage.map.get('nurturelink.session')), { profile_id: 'maricel-dimaculangan', signed_in_at: 5 });
  assert.deepEqual(persistence.loadSession(), { profile_id: 'maricel-dimaculangan', signed_in_at: 5 });
  persistence.saveSession(null);
  assert.equal(storage.map.has('nurturelink.session'), false);
  assert.equal(persistence.loadSession(), null);
});

test('a damaged or unavailable localStorage gives no session and no error', () => {
  const broken = fakeStorage();
  broken.map.set('nurturelink.session', '{not json');
  assert.equal(createPersistence({ indexedDb: undefined, storage: broken }).loadSession(), null);
  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const persistence = createPersistence({ indexedDb: undefined, storage: throwing });
  assert.equal(persistence.loadSession(), null);
  assert.doesNotThrow(() => persistence.saveSession({ profile_id: 'x' }));
  assert.doesNotThrow(() => persistence.saveSession(null));
  assert.equal(createPersistence({ indexedDb: undefined, storage: undefined }).loadSession(), null);
});

function fakeTarget() {
  const handlers = {};
  return {
    handlers,
    addEventListener: (name, fn) => { handlers[name] = fn; },
    removeEventListener: (name) => { delete handlers[name]; },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => { handlers[`doc:${name}`] = fn; }, removeEventListener: (name) => { delete handlers[`doc:${name}`]; } },
  };
}
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('changes are saved a moment later, once, and not for live or session changes', async () => {
  const store = createStore({ ...createSeed({ now: NOW }), session: null });
  const saves = [];
  const persistence = { save: async (s) => { saves.push(s); } };
  const stop = attachPersistence(store, persistence, { delayMs: 10, snapshotOf, target: fakeTarget() });

  store.dispatch({ type: 'live', patch: { check: { phase: 'starting' } } });
  store.dispatch({ type: 'session', session: { profile_id: 'x' } });
  await wait(30);
  assert.equal(saves.length, 0, 'what is never stored does not trigger a save');

  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { timing: 'realistic' } }] });
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { connection: 'offline' } }] });
  assert.equal(saves.length, 0, 'not at once');
  await wait(30);
  assert.equal(saves.length, 1, 'one save for both changes');
  assert.equal(saves[0].meta.timing, 'realistic');
  assert.equal(saves[0].meta.connection, 'offline');
  assert.equal(saves[0].session, undefined, 'the session is not part of the stored data');
  assert.equal(saves[0].live, undefined);
  stop();
});

test('the first change after a quiet moment is saved at once; a burst is saved at most once per delay', async () => {
  const store = createStore({ ...createSeed({ now: NOW }), session: null });
  const saves = [];
  // generous margins: a slow machine can stall for a while without changing what this test shows
  const stop = attachPersistence(store, { save: async (s) => { saves.push(s.meta.timing); } }, { delayMs: 600, snapshotOf, target: fakeTarget() });
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { timing: 'one' } }] });
  assert.equal(saves.length, 0, 'not inside the same tick, so changes made together are one save');
  await wait(40);
  assert.deepEqual(saves, ['one'], 'saved at once, without waiting for the delay');
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { timing: 'two' } }] });
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { timing: 'three' } }] });
  await wait(40);
  assert.deepEqual(saves, ['one'], 'a burst has to wait for the delay');
  await wait(700);
  assert.deepEqual(saves, ['one', 'three'], 'one save for the whole burst');
  stop();
});

test('hiding or closing the page saves straight away', async () => {
  const store = createStore({ ...createSeed({ now: NOW }), session: null });
  const target = fakeTarget();
  const saves = [];
  attachPersistence(store, { save: async (s) => { saves.push(s); } }, { delayMs: 10000, snapshotOf, target });
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { timing: 'realistic' } }] });
  target.document.visibilityState = 'visible';
  target.handlers['doc:visibilitychange']();
  assert.equal(saves.length, 0, 'becoming visible saves nothing');
  target.document.visibilityState = 'hidden';
  target.handlers['doc:visibilitychange']();
  assert.equal(saves.length, 1);
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { timing: 'quick' } }] });
  target.handlers.pagehide();
  assert.equal(saves.length, 2);
  target.handlers.pagehide();
  assert.equal(saves.length, 2, 'nothing new, nothing to save');
});

test('stopping removes the listeners and the pending save', async () => {
  const store = createStore({ ...createSeed({ now: NOW }), session: null });
  const target = fakeTarget();
  const saves = [];
  const stop = attachPersistence(store, { save: async (s) => { saves.push(s); } }, { delayMs: 10, snapshotOf, target });
  store.dispatch({ type: 'ops', ops: [{ op: 'meta', patch: { timing: 'realistic' } }] });
  stop();
  await wait(30);
  assert.equal(saves.length, 0);
  assert.deepEqual(Object.keys(target.handlers), []);
});
