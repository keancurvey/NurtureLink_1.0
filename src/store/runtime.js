// The runtime: the store, the server core, the simulated devices, the check bridge and the scenario engine, wired
// together. The React provider builds one; tests build their own with a clock and timers they control.
import { TIMING, buildThresholds } from '../config/thresholds.js';
import { MS_MINUTE } from '../lib/dates.js';
import { isProviderRole } from '../lib/permissions.js';
import { createDeviceSim } from '../sim/deviceSim.js';
import { createEngine } from '../sim/engine.js';
import { createSeed } from '../sim/seed.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { createScheduler } from '../sim/scheduler.js';
import { createAlerts } from './alerts.js';
import { createAuth } from './auth.js';
import { createBarangay } from './barangay.js';
import { createCheckBridge } from './checkBridge.js';
import { createConsult } from './consult.js';
import { createCore } from './core.js';
import { createDevices } from './devices.js';
import { createOffice } from './office.js';
import { createProfileService } from './profile.js';
import { createRequests } from './requests.js';
import { createStore } from './store.js';

// notice: why the sign-in screen has something to say ('session_expired'); it is never stored.
export const initialLive = () => ({ check: null, sos: null, notice: null });

/**
 * A complete state from a stored copy (or a fresh seed) and the saved session. A provider's saved session that has been
 * idle for longer than the timeout is not restored (AUTH-08): the sign-in screen says the session ended.
 */
export function buildState({ snapshot = null, session = null, now = Date.now() } = {}) {
  const base = snapshot ?? createSeed({ now });
  const profile = session ? base.db.profiles.find((p) => p.id === session.profile_id) : null;
  const timeoutMs = buildThresholds(base.db.thresholds).providerSession.timeoutMinutes * MS_MINUTE;
  const idleSince = session?.last_active_at ?? session?.signed_in_at ?? now;
  const expired = Boolean(profile) && isProviderRole(profile.role) && now - idleSince >= timeoutMs;
  return { ...base, session: profile && !expired ? session : null, live: { ...initialLive(), notice: expired ? 'session_expired' : null } };
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
  sweepMs = 1000,
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
  /** Who is signed in. The session is kept in its own small localStorage key, not in the stored data. */
  const setSession = (session) => {
    persistence?.saveSession(session);
    store.dispatch({ type: 'session', session });
  };
  const auth = createAuth({ store, core, setSession, now });
  const devices = createDevices({ store, core, link, bridge, now });
  const alerts = createAlerts({ store, core, now });
  const profile = createProfileService({ store, core, now });
  const requests = createRequests({ store, core, now });
  const consult = createConsult({ store, core, now });
  const barangay = createBarangay({ store, core, now });
  const office = createOffice({ store, core, now });
  const engine = createEngine({ store, core, sched, bridge, link, control, scenarios: SCENARIOS, now });
  let heartbeat = null;
  let sweeper = null;

  return {
    store,
    core,
    sched,
    link,
    control,
    bridge,
    engine,
    auth,
    devices,
    alerts,
    profile,
    requests,
    consult,
    barangay,
    office,

    /**
     * Start up: finish a run a reload cut short, upload what is still queued (when online), keep devices' last-seen
     * time fresh. Returns a function that stops the heartbeat.
     */
    start() {
      // A session that was not restored (it timed out) must not come back on the next reload either.
      if (!store.getState().session) persistence?.saveSession(null);
      engine.resume();
      if (core.isOnline()) core.flushQueue();
      if (!heartbeat) heartbeat = setRepeat(() => control.heartbeat(), heartbeatMs);
      // The escalation sweep (ALR-05) looks every second for an alert nobody acknowledged in time; the same sweep sends the
      // reminders that have come due (PAT-S-04).
      const sweep = () => {
        core.sweepEscalations();
        core.sweepReminders();
      };
      sweep();
      if (!sweeper) sweeper = setRepeat(sweep, sweepMs);
      return () => {
        if (heartbeat) clearRepeat(heartbeat);
        if (sweeper) clearRepeat(sweeper);
        heartbeat = null;
        sweeper = null;
      };
    },

    setTiming: (timing) => core.commit([{ op: 'meta', patch: { timing } }]),
    setFocusPatient: (patientId) => core.commit([{ op: 'meta', patch: { focus_patient_id: patientId } }]),
    /** Online brings the queue up to date and sends an SOS that waited on the phone. */
    setConnection(connection) {
      const result = core.setConnection(connection);
      if (connection === 'online') alerts.relayPending();
      return result;
    },

    setSession,

    /** Reset data: stop the run, build the seed again from now, sign out. */
    reset() {
      engine.stop();
      bridge.reset();
      persistence?.saveSession(null);
      store.dispatch({ type: 'replace', state: buildState({ now: now() }) });
    },
  };
}

