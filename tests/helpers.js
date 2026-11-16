// Shared helpers for the tests. Not a test file (the name does not match the runner's patterns).
import { createScheduler } from '../src/sim/scheduler.js';
import { createDeviceSim } from '../src/sim/deviceSim.js';
import { createSeed } from '../src/sim/seed.js';
import { createStore } from '../src/store/store.js';
import { createCore } from '../src/store/core.js';
import { createCheckBridge } from '../src/store/checkBridge.js';
import { buildState, createRuntime } from '../src/store/runtime.js';

export function makeWorld(initial) {
  const data = { ...initial };
  return {
    get: (serial) => data[serial],
    patch(serial, patch) {
      data[serial] = { ...data[serial], ...patch };
    },
    list: () => Object.values(data),
    data,
  };
}

const base = {
  bound_patient_id: 'maricel-dimaculangan',
  advertising: false,
  connected: false,
  charging: false,
  exposure: [],
  ring: [],
  next_seq: 100,
  session_counter: 5,
  clock_synced: true,
  fault: 0,
  fw_version: '1.2.0',
  signal: null,
  sos: null,
};
export const beltHardware = (overrides = {}) => ({
  ...base, serial: 'NLB-2026-0412', type: 'belt', name: 'NL-BELT-0412', state: 'ACTIVE_IDLE', battery: 76, ...overrides,
});
export const bandHardware = (overrides = {}) => ({
  ...base, serial: 'NLW-2026-0412', type: 'band', name: 'NL-BAND-0412', state: 'ADVERTISING', battery: 64, next_seq: 40, ...overrides,
});

/** A device sim over an in-memory world with a scheduler whose timers never fire: tests call flush() or advance(ms). */
export function makeSim({ hardware = [beltHardware(), bandHardware()], now = () => NOW } = {}) {
  const world = makeWorld(Object.fromEntries(hardware.map((h) => [h.serial, h])));
  const sched = createScheduler({ setTimer: () => 0, clearTimer: () => {} });
  const sim = createDeviceSim({ world, sched, now });
  const events = [];
  sim.link.onNotification((event) => events.push(event));
  return { world, sched, events, ...sim };
}

export const NOW = Date.parse('2026-11-08T08:00:00Z');
export const BELT = 'NLB-2026-0412';
export const BAND = 'NLW-2026-0412';

// ---------- The app without the engine: seed, store, server core, devices and the check bridge ----------

export const MARICEL = 'maricel-dimaculangan';

/** Everything the check flow needs, with a clock the test controls and a scheduler that only runs when told to. */
export function makeApp({ now = NOW } = {}) {
  let clock = now;
  const nowFn = () => clock;
  const store = createStore(createSeed({ now }));
  const sched = createScheduler({ setTimer: () => 0, clearTimer: () => {} });
  const core = createCore({ store, now: nowFn });
  const world = {
    get: (serial) => store.getState().hardware[serial],
    patch: (serial, patch) => store.dispatch({ type: 'ops', ops: [{ op: 'hardware', serial, patch }] }),
    list: () => Object.values(store.getState().hardware),
  };
  const { link, control } = createDeviceSim({ world, sched, now: nowFn });
  const bridge = createCheckBridge({ store, core, link, sched, now: nowFn });
  return {
    store, core, sched, link, control, bridge, world,
    state: () => store.getState(),
    db: () => store.getState().db,
    setClock: (ms) => { clock = ms; },
    advanceClock: (ms) => { clock += ms; },
    /** Sessions of a patient, oldest first. */
    sessions: (patientId = MARICEL) =>
      store.getState().db.check_sessions.filter((s) => s.patient_id === patientId).sort((a, b) => a.started_at - b.started_at),
    alerts: (patientId = MARICEL) => store.getState().db.alerts.filter((a) => a.patient_id === patientId),
    inbox: (profileId) => store.getState().db.notifications.filter((n) => n.profile_id === profileId),
  };
}

// ---------- The whole runtime, with a clock and timers the test controls ----------

/** Timers never fire by themselves: tests call sched.flush() or sched.advance(ms). `delays` records what was asked of them. */
export function makeRuntime({ now = NOW, session = null, snapshot = null } = {}) {
  let clock = now;
  const delays = [];
  const runtime = createRuntime({
    state: buildState({ now, session, snapshot }),
    now: () => clock,
    setTimer: (fn, ms) => {
      delays.push(ms);
      return delays.length;
    },
    clearTimer: () => {},
    setRepeat: () => 0,
    clearRepeat: () => {},
    onError: (error) => {
      throw error;
    },
  });
  const events = [];
  runtime.engine.subscribe((event) => events.push(event));
  return {
    ...runtime,
    events,
    delays,
    setClock: (ms) => { clock = ms; },
    advanceClock: (ms) => { clock += ms; },
    db: () => runtime.store.getState().db,
    state: () => runtime.store.getState(),
    finished: () => events.filter((e) => e.type === 'finished'),
    failed: () => events.filter((e) => e.type === 'failed'),
    inbox: (id) => runtime.store.getState().db.notifications.filter((n) => n.profile_id === id),
  };
}
