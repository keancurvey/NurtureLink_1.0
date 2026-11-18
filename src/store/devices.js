// The phone's device side for the patient (spec 3.2, AUTH-07, PAT-H-02, PAT-H-03): the pairing wizard (list what is
// nearby, connect and read the device information, bind the serial to the patient), the Connect button and Check now.
// Binding a serial is the server's decision (spec 10: a device bound to another patient is rejected), so it is made
// here, in the in-process server, and not in the screen. Screens reach it through the wrappers in actions.js.
import { DEVICE_DEFAULTS } from '../config/thresholds.js';
import { voltageForPct } from '../lib/battery.js';
import { checkNowState } from '../lib/checkNow.js';
import { advertisedName } from '../lib/packets.js';
import { byId } from './ops.js';
import { viewerOf } from './selectors.js';

const MODEL = { belt: 'NurtureLink belt', band: 'NurtureLink wrist band' };

/** In range: advertising, or linked for pairing and not yet anyone's (a connected device stops advertising). */
const inRange = (hw) => hw.advertising || (hw.connected && hw.bound_patient_id === null);

/** Devices in range that a patient can choose from: of the type asked for and not already hers. */
export function nearbyDevices(state, patientId, type) {
  const mine = new Set(state.db.devices.filter((d) => d.patient_id === patientId).map((d) => d.serial));
  return Object.values(state.hardware)
    .filter((h) => h.type === type && inRange(h) && !mine.has(h.serial))
    .map((h) => ({ serial: h.serial, type: h.type, name: h.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createDevices({ store, core, link, bridge, now = Date.now }) {
  const state = () => store.getState();
  /** Only the signed-in patient may act, and only on herself. */
  const patient = () => {
    const viewer = viewerOf(state());
    return viewer?.active && viewer.role === 'patient' ? viewer : null;
  };
  const hardware = (serial) => state().hardware[serial] ?? null;
  const infoOf = (hw) => ({ serial: hw.serial, type: hw.type, name: hw.name, model: MODEL[hw.type], fw_version: hw.fw_version, battery_pct: hw.battery });

  return {
    /** The wizard's "Connect": link to the chosen device and read its information (serial, model, firmware; FW-C-03). */
    readInfo(serial) {
      const viewer = patient();
      const hw = hardware(serial);
      if (!viewer || !hw || !inRange(hw)) return { ok: false, error: 'not_found' };
      if (hw.bound_patient_id === null) link.connect(serial); // a device that belongs to someone else keeps her link
      return { ok: true, info: infoOf(hw) };
    },

    /** Let go of a device that was connected for pairing but not paired. Never touches a device that has an owner. */
    release(serial) {
      const hw = hardware(serial);
      if (!hw || hw.bound_patient_id !== null || !hw.connected) return;
      link.disconnect(serial);
      core.commit([{ op: 'hardware', serial, patch: { advertising: true } }]); // a device that lost its link advertises again (FW-W-01)
    },

    /** Bind the serial to the signed-in patient. Answers { ok, device } or { ok: false, error }. */
    pair(serial) {
      const viewer = patient();
      const hw = hardware(serial);
      if (!viewer || !hw || !inRange(hw)) return { ok: false, error: 'not_found' };
      const db = state().db;
      const owned = db.devices.find((d) => d.serial === serial);
      if ((hw.bound_patient_id && hw.bound_patient_id !== viewer.id) || (owned && owned.patient_id !== viewer.id)) {
        return { ok: false, error: 'already_bound' };
      }
      if (db.devices.some((d) => d.patient_id === viewer.id && d.type === hw.type)) return { ok: false, error: 'type_taken' };

      const at = now();
      link.connect(serial);
      const row = {
        id: `dev-${serial}`,
        patient_id: viewer.id,
        type: hw.type,
        serial,
        name: advertisedName(hw.type, serial),
        model: MODEL[hw.type],
        fw_version: hw.fw_version,
        paired_at: at,
        last_seen_at: at,
        battery_pct: hw.battery,
        charging: hw.charging,
        battery_updated_at: at,
        link_state: 'connected',
        last_seq: 0,
        ...(hw.type === 'belt' ? { exposure_left_s: DEVICE_DEFAULTS.belt.exposureCapS } : {}),
      };
      core.commit([
        { op: 'insert', table: 'devices', row },
        {
          op: 'insert',
          table: 'device_status_log',
          row: { id: core.id('dsl'), device_id: row.id, at, battery_pct: hw.battery, vcell_mv: voltageForPct(hw.battery), charging: hw.charging, state: hw.type === 'belt' ? 'ACTIVE_IDLE' : 'CONNECTED_IDLE' },
        },
        { op: 'hardware', serial, patch: { bound_patient_id: viewer.id, advertising: false } },
      ]);
      // Now the device is hers, the link's notifications reach her record: set its clock and read its status.
      link.timeSync(serial, Math.floor(at / 1000));
      link.identify(serial);
      return { ok: true, device: byId(state().db.devices).get(row.id) };
    },

    /** The Connect button on a device row (PAT-H-02). Only her own devices. */
    connect(serial) {
      const viewer = patient();
      const device = viewer ? state().db.devices.find((d) => d.serial === serial && d.patient_id === viewer.id) : null;
      if (!device) return { ok: false, error: 'not_found' };
      return { ok: link.connect(serial) };
    },

    /** The wizard was opened: she has seen it, so the next sign-in goes to Home (she can reopen it from Profile). */
    markPairingSeen() {
      const viewer = patient();
      const row = viewer ? byId(state().db.patients).get(viewer.id) : null;
      if (row && !row.pairing_prompted_at) core.commit([{ op: 'update', table: 'patients', id: viewer.id, patch: { pairing_prompted_at: now() } }]);
    },

    /** Check now (PAT-H-03): the same rule the screen shows, then the belt check and the band burst. */
    startCheck() {
      const viewer = patient();
      if (!viewer) return { started: false, reason: 'not_allowed' };
      const devices = state().db.devices.filter((d) => d.patient_id === viewer.id);
      const verdict = checkNowState({ devices, checking: bridge.isChecking(viewer.id), thresholds: core.thresholds() });
      if (!verdict.allowed) return { started: false, reason: verdict.reason.code, device: verdict.reason.device };
      const outcome = bridge.startCheck(viewer.id);
      return outcome.started ? { started: true } : { started: false, reason: outcome.reason };
    },

    stopCheck() {
      const viewer = patient();
      if (viewer) bridge.stopCheck(viewer.id);
    },

    /** Close the result or failure of a check on screen. A check still running is left alone. */
    dismissCheck() {
      const viewer = patient();
      const check = state().live.check;
      if (!viewer || !check || check.patient_id !== viewer.id) return;
      if (check.phase === 'complete' || check.phase === 'failed') store.dispatch({ type: 'live', patch: { check: null } });
    },
  };
}
