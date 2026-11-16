// The runtime: the store, the server core, the simulated devices, the check bridge and the scenario engine, wired
// together. The React provider builds one; tests build their own with a clock and timers they control.
import { TIMING } from '../config/thresholds.js';
import { createDeviceSim } from '../sim/deviceSim.js';
import { createEngine } from '../sim/engine.js';
import { createSeed } from '../sim/seed.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { createScheduler } from '../sim/scheduler.js';
import { createCheckBridge } from './checkBridge.js';
import { createCore } from './core.js';
import { createStore } from './store.js';

export const initialLive = () => ({ check: null, sos: null });

/** A complete state from a stored copy (or a fresh seed) and the saved session. */
export function buildState({ snapshot = null, session = null, now = Date.now() } = {}) {
  const base = snapshot ?? createSeed({ now });
  const known = session && base.db.profiles.some((p) => p.id === session.profile_id);
  return { ...base, session: known ? session : null, live: initialLive() };
}

export function createRuntime({
  state,
  now = Date.now,
  persistence = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
  setRepeat = (fn, ms) => setInterval(fn, ms),
  clearRepeat = (handle) => clearInterval(handle),
  heartbeatMs = 30000,
  onError = (error) => {
    console.error(error);
  },
} = {}) {
  const store = createStore(state);
  const speed = () => TIMING[store.getState().meta.timing]?.speed ?? 1;
  const sched = createScheduler({ getSpeed: speed, setTimer, clearTimer, onError });
  const core = createCore({ store, now });
  const world = {
    get: (serial) => store.getState().hardware[serial],
    patch: (serial, patch) => store.dispatch({ type: 'ops', ops: [{ op: 'hardware', serial, patch }] }),
    list: () => Object.values(store.getState().hardware),
  };
  const { link, control } = createDeviceSim({ world, sched, now });
  const bridge = createCheckBridge({ store, core, link, sched, now });
  const engine = createEngine({ store, core, sched, bridge, link, control, scenarios: SCENARIOS, now });
  let heartbeat = null;

  return {
    store,
    core,
    sched,
    link,
    control,
    bridge,
    engine,

    /**
     * Start up: finish a run a reload cut short, upload what is still queued (when online), keep devices' last-seen
     * time fresh. Returns a function that stops the heartbeat.
     */
    start() {
      engine.resume();
      if (core.isOnline()) core.flushQueue();
      if (!heartbeat) heartbeat = setRepeat(() => control.heartbeat(), heartbeatMs);
      return () => {
        if (heartbeat) clearRepeat(heartbeat);
        heartbeat = null;
      };
    },

    setTiming: (timing) => core.commit([{ op: 'meta', patch: { timing } }]),
    setFocusPatient: (patientId) => core.commit([{ op: 'meta', patch: { focus_patient_id: patientId } }]),
    setConnection: (connection) => core.setConnection(connection),

    /** Who is signed in. The session is kept in its own small localStorage key, not in the stored data. */
    setSession(session) {
      persistence?.saveSession(session);
      store.dispatch({ type: 'session', session });
    },

    /** Reset data: stop the run, build the seed again from now, sign out. */
    reset() {
      engine.stop();
      bridge.reset();
      persistence?.saveSession(null);
      store.dispatch({ type: 'replace', state: buildState({ now: now() }) });
    },
  };
}

