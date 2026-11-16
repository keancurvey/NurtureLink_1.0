// The store: one state object, a reducer and subscribers. Plain JavaScript so the logic runs in Node tests and
// the React provider stays a thin layer. Replacing the actions with a real backend later leaves this untouched.
import { applyOps } from './ops.js';

/**
 * State: { schemaVersion, seededAt, db, hardware, meta, session, live }
 *   db        the tables of spec 6.1
 *   hardware  the state of each belt and band (what the firmware knows); used by the device link only
 *   meta      connection, timing mode, focus patient, video usage and the run in progress
 *   session   who is signed in (kept in localStorage, not in the stored data)
 *   live      what is happening now and is never stored: the check in progress, the SOS in flight
 */
export function reducer(state, action) {
  switch (action.type) {
    case 'ops':
      return applyOps(state, action.ops);
    case 'live':
      return { ...state, live: { ...state.live, ...action.patch } };
    case 'session':
      return { ...state, session: action.session };
    case 'replace':
      return action.state;
    default:
      return state;
  }
}

export function createStore(initialState, rootReducer = reducer) {
  let state = initialState;
  const listeners = new Set();
  return {
    getState: () => state,
    dispatch(action) {
      const next = rootReducer(state, action);
      if (next !== state) {
        state = next;
        for (const listener of [...listeners]) listener(state, action);
      }
      return action;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** What gets stored in IndexedDB: everything except the session and the live state. */
export function snapshotOf(state) {
  return {
    schemaVersion: state.schemaVersion,
    seededAt: state.seededAt,
    db: state.db,
    hardware: state.hardware,
    meta: state.meta,
  };
}
