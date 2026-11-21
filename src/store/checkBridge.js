// The app side of the device link (spec 3.2, PAT-H-03 to PAT-H-06): starts checks, reads the packets that come back,
// builds the check session with the maternal-reference comparison, saves it on the phone as queued, uploads it when
// online, replays what the devices stored while apart, and relays an SOS. It speaks only the device link, so it works the
// same with the simulated devices and with a Bluetooth adapter later.
import { DEVICE_DEFAULTS } from '../config/thresholds.js';
import { CHANNEL } from '../lib/deviceLink.js';
import {
  BELT_STATE,
  FHR_TYPE,
  RESULT,
  RESULT_NAMES,
  asBytes,
  decodeBandSos,
  decodeBandStatus,
  decodeBandVitals,
  decodeBeltFhr,
  decodeBeltStatus,
  decodeStored,
} from '../lib/packets.js';
import { flagMaternalMatches, summarizeCheck } from '../lib/readings.js';

const WINDOW_MS = DEVICE_DEFAULTS.belt.windowS * 1000;
const FIRST_WINDOW_LEAD_MS = WINDOW_MS + 1800; // from the start of a check to its first window
const UPLOAD_MS = 600;
const VITALS_KEEP_MS = 24 * 60 * 60 * 1000;
const VITALS_BEFORE_MS = 5 * 60 * 1000; // a band reading up to 5 minutes before a check still describes it
const VITALS_AFTER_MS = 60 * 1000;

export function createCheckBridge({ store, core, link, sched, now = Date.now }) {
  const active = new Map(); // patient id -> the check in progress
  const vitals = new Map(); // patient id -> recent band readings
  const replays = new Map(); // serial -> stored records received so far
  const used = new Set(); // band readings already given to a check: each belongs to one check only
  const listeners = new Set();
  const state = () => store.getState();
  const emit = (event) => {
    for (const listener of [...listeners]) listener(event);
  };

  // ---------- What the screens watch: live.check and live.sos ----------
  const setCheck = (patch) => store.dispatch({ type: 'live', patch: { check: { ...state().live.check, ...patch } } });

  function begin(patientId, beltSerial, bandSerial, { durationS, source }) {
    const run = { patientId, beltSerial, bandSerial, source, windows: [], bandFailed: false, startedAt: now() };
    active.set(patientId, run);
    store.dispatch({
      type: 'live',
      patch: {
        check: {
          patient_id: patientId,
          phase: 'starting',
          windows: 0,
          total: Math.floor(durationS / DEVICE_DEFAULTS.belt.windowS),
          prompt: null, // 'adjust_belt' or 'rest' while the belt needs something from the wearer
          started_at: run.startedAt,
          session_id: null,
          reason: null,
        },
      },
    });
    return run;
  }

  function fail(run, reason) {
    active.delete(run.patientId);
    setCheck({ phase: 'failed', prompt: null, reason });
    emit({ type: 'check-failed', patientId: run.patientId, reason });
  }

  const deviceOf = (serial) => state().db.devices.find((d) => d.serial === serial) ?? null;
  const bandOf = (patientId) => state().db.devices.find((d) => d.patient_id === patientId && d.type === 'band') ?? null;

  // ---------- Band readings ----------
  function addVitals(patientId, packet, serial) {
    const list = (vitals.get(patientId) ?? []).filter((v) => now() - v.taken_at < VITALS_KEEP_MS);
    list.push({
      serial,
      device_seq: packet.seq,
      taken_at: packet.tEpoch * 1000,
      hr_bpm: packet.hr,
      spo2_pct: packet.spo2,
      skin_temp_c: packet.skinTempC,
      flags: packet.flags,
    });
    vitals.set(patientId, list.slice(-100));
  }
  const vitalsKey = (v) => `${v.serial}:${v.device_seq}`;
  const vitalsAround = (patientId, from, to) =>
    (vitals.get(patientId) ?? []).filter(
      (v) => v.taken_at >= from - VITALS_BEFORE_MS && v.taken_at <= to + VITALS_AFTER_MS && !used.has(vitalsKey(v)),
    );

  // ---------- Saving a check ----------
  /**
   * Build the check session from its packets, keep it on the phone as queued, and upload it when online (a moment
   * later, as a real network would). Never saves the same check twice: its client id comes from the device.
   */
  function saveCheck({ patientId, beltSerial, bandSerial, windowPackets, summaryPacket, source }) {
    const clientId = `${beltSerial}:${summaryPacket.sessionId}:${windowPackets[0].seq}`;
    if (state().db.check_sessions.some((s) => s.client_id === clientId)) return null;

    const first = windowPackets[0].tEpoch * 1000;
    const last = summaryPacket.tEpoch * 1000;
    const band = vitalsAround(patientId, first, last).map((v) => ({ ...v }));
    for (const v of band) used.add(vitalsKey(v));
    const windowRows = flagMaternalMatches(
      windowPackets.map((p) => ({
        device_seq: p.seq, taken_at: p.tEpoch * 1000, fhr_bpm: p.fhr, confidence: p.confidence, sqi: p.sqi, element: p.element, flags: p.flags,
      })),
      band,
      core.thresholds().maternalMatch,
    );
    const summary = summarizeCheck({ windows: windowRows, vitals: band });

    // Device time can run ahead of the clock when a check is shortened or finished at once: never save the future.
    const shift = Math.min(0, now() - last);
    const at = now();
    const sessionId = core.id('chk');
    const db = state().db;
    const belt = db.devices.find((d) => d.serial === beltSerial);
    const bandDevice = bandSerial ? db.devices.find((d) => d.serial === bandSerial) : null;
    const session = {
      id: sessionId,
      patient_id: patientId,
      started_at: first - FIRST_WINDOW_LEAD_MS + shift,
      ended_at: last + shift,
      source,
      belt_serial: beltSerial,
      band_serial: bandSerial,
      battery_belt_pct: belt.battery_pct,
      battery_band_pct: bandDevice ? bandDevice.battery_pct : null,
      device_session_id: summaryPacket.sessionId,
      status: 'completed',
      summary,
      syncState: 'queued',
      queued_at: at,
      client_id: clientId,
    };
    const fetal = windowRows.map((row) => ({
      id: core.id('fr'),
      session_id: sessionId,
      device_seq: row.device_seq,
      taken_at: row.taken_at + shift,
      fhr_bpm: row.fhr_bpm,
      confidence: row.confidence,
      sqi: row.sqi,
      element: row.element,
      flags: row.flags,
      maternal_match: row.maternal_match,
      syncState: 'queued',
      queued_at: at,
    }));
    const maternal = band.map((v) => ({
      id: core.id('mr'),
      session_id: sessionId,
      device_seq: v.device_seq,
      taken_at: v.taken_at + shift,
      hr_bpm: v.hr_bpm,
      spo2_pct: v.spo2_pct,
      skin_temp_c: v.skin_temp_c,
      flags: v.flags,
      syncState: 'queued',
      queued_at: at,
    }));
    const ops = [
      { op: 'insert', table: 'check_sessions', row: session },
      { op: 'insertMany', table: 'fetal_readings', rows: fetal },
      { op: 'insertMany', table: 'maternal_readings', rows: maternal },
    ];
    core.commit(ops);
    core.evaluateOnPhone(patientId, { session, fetal, maternal }); // ALR-02: the patient's notice at once, even offline
    raiseHighestSeq(beltSerial, summaryPacket.seq);
    for (const v of band) raiseHighestSeq(v.serial, v.device_seq);

    // Upload when online. Offline, it stays queued and hidden from providers until reconnection (flushQueue).
    sched.after(UPLOAD_MS, () => {
      if (core.isOnline()) core.ingestReadings({ patient_id: patientId, checks: [{ session, fetal, maternal }] });
    });
    emit({ type: 'check-saved', patientId, sessionId, source });
    return session;
  }

  /** The highest sequence number the app holds from a device, so the next replay starts after it. */
  function raiseHighestSeq(serial, seq) {
    const device = deviceOf(serial);
    if (device && seq > device.last_seq) core.commit([{ op: 'update', table: 'devices', id: device.id, patch: { last_seq: seq } }]);
  }

  // ---------- Notifications from the link ----------
  function onStatus(device, bytes) {
    const isBelt = device.type === 'belt';
    const status = isBelt ? decodeBeltStatus(bytes) : decodeBandStatus(bytes);
    core.recordDeviceStatus(device.serial, { battery: status.battery, charging: status.charging, exposureLeft: isBelt ? status.exposureLeft : undefined });
    const run = active.get(device.patient_id);
    if (!run) return;
    if (!isBelt) {
      if (run.bandSerial === device.serial && status.resultCode !== RESULT.OK) run.bandFailed = true;
      return;
    }
    if (run.beltSerial !== device.serial) return;
    if (status.resultCode !== RESULT.OK && status.resultCode !== RESULT.CLOCK_NOT_SYNCED) {
      fail(run, RESULT_NAMES[status.resultCode].toLowerCase());
    } else if (status.state === BELT_STATE.CONTACT_CHECK) {
      setCheck({ phase: 'contact', prompt: status.pads.filter(Boolean).length < 2 ? 'adjust_belt' : null });
    } else if (status.state === BELT_STATE.ACQUIRE) {
      setCheck({ phase: 'acquiring', prompt: null });
    }
  }

  function onFhr(device, bytes) {
    const packet = decodeBeltFhr(bytes);
    let run = active.get(device.patient_id);
    if (!run) {
      if (packet.type !== FHR_TYPE.WINDOW) return;
      // A scheduled check the belt began on its own while the phone was connected.
      run = begin(device.patient_id, device.serial, bandOf(device.patient_id)?.serial ?? null, { durationS: DEVICE_DEFAULTS.belt.checkDurationS, source: 'scheduled' });
    }
    if (run.beltSerial !== device.serial) return;
    if (packet.type === FHR_TYPE.WINDOW) {
      run.windows.push(packet);
      setCheck({ phase: 'acquiring', windows: run.windows.length, prompt: packet.motion ? 'rest' : null });
      return;
    }
    active.delete(run.patientId);
    if (run.windows.length === 0) {
      setCheck({ phase: 'failed', prompt: null, reason: packet.poorContact ? 'no_contact' : 'no_reading' });
      emit({ type: 'check-failed', patientId: run.patientId, reason: 'no_contact' });
      return;
    }
    setCheck({ phase: 'finishing', prompt: null });
    const session = saveCheck({
      patientId: run.patientId,
      beltSerial: run.beltSerial,
      bandSerial: run.bandSerial && !run.bandFailed ? run.bandSerial : null,
      windowPackets: run.windows,
      summaryPacket: packet,
      source: run.source,
    });
    if (session) link.ackStored(run.beltSerial, packet.seq);
    setCheck({ phase: 'complete', windows: run.windows.length, session_id: session?.id ?? null });
  }

  function onVitals(device, bytes) {
    const packet = decodeBandVitals(bytes);
    addVitals(device.patient_id, packet, device.serial);
    link.ackStored(device.serial, packet.seq);
  }

  /** SOS relay (spec 3.2): the alert goes out only while the app is online; the band repeats until it is acknowledged. */
  function handleSos(device, packet) {
    const patientId = device.patient_id;
    if (!core.isOnline()) {
      store.dispatch({ type: 'live', patch: { sos: packet.pressed ? { patient_id: patientId, state: 'undelivered', seq: packet.seq } : null } });
      return;
    }
    core.relaySos(patientId, packet);
    link.ackSos(device.serial, packet.seq);
    store.dispatch({ type: 'live', patch: { sos: packet.pressed ? { patient_id: patientId, state: 'sent', seq: packet.seq, at: now() } : null } });
    emit({ type: packet.pressed ? 'sos-sent' : 'sos-cancelled', patientId });
  }

  function processReplay(device, records, lastSeq) {
    const patientId = device.patient_id;
    if (device.type === 'band') {
      for (const record of records) {
        if (record.packetType === 'vitals') addVitals(patientId, record.packet, device.serial);
        if (record.packetType === 'sos') handleSos(device, record.packet);
      }
    } else {
      const sessions = new Map();
      for (const record of records) {
        if (record.packetType !== 'fhr') continue;
        const group = sessions.get(record.packet.sessionId) ?? { windows: [], summary: null };
        if (record.packet.type === FHR_TYPE.WINDOW) group.windows.push(record.packet);
        else group.summary = record.packet;
        sessions.set(record.packet.sessionId, group);
      }
      for (const group of sessions.values()) {
        if (!group.summary || group.windows.length === 0) continue;
        saveCheck({
          patientId,
          beltSerial: device.serial,
          bandSerial: bandOf(patientId)?.serial ?? null,
          windowPackets: group.windows.sort((a, b) => a.seq - b.seq),
          summaryPacket: group.summary,
          source: 'stored',
        });
      }
    }
    if (records.length > 0) {
      link.ackStored(device.serial, lastSeq);
      raiseHighestSeq(device.serial, lastSeq);
    }
  }

  function onStored(device, bytes) {
    const decoded = decodeStored(bytes, device.type);
    if (decoded.kind === 'record') {
      replays.set(device.serial, [...(replays.get(device.serial) ?? []), decoded]);
      return;
    }
    const records = replays.get(device.serial) ?? [];
    replays.delete(device.serial);
    processReplay(device, records, decoded.lastSeq);
  }

  /** A link came up: synchronise the clock and ask for what the device kept while apart (FW-C-06, FW-C-07). */
  function onConnection(device, connected) {
    core.recordLink(device.serial, connected);
    if (connected) {
      link.timeSync(device.serial, Math.floor(now() / 1000));
      link.requestStored(device.serial, deviceOf(device.serial).last_seq);
      return;
    }
    const run = active.get(device.patient_id);
    if (run && run.beltSerial === device.serial) fail(run, 'disconnected');
  }

  link.onNotification((event) => {
    const device = deviceOf(event.serial);
    if (!device) return; // a device that is not paired to anyone yet
    if (event.channel === CHANNEL.CONNECTION) onConnection(device, event.connected);
    else if (event.channel === CHANNEL.STATUS) onStatus(device, event.data);
    else if (event.channel === CHANNEL.BATTERY) core.recordDeviceStatus(device.serial, { battery: asBytes(event.data)[0], charging: device.charging });
    else if (event.channel === CHANNEL.FHR) onFhr(device, event.data);
    else if (event.channel === CHANNEL.VITALS) onVitals(device, event.data);
    else if (event.channel === CHANNEL.SOS) handleSos(device, decodeBandSos(event.data));
    else if (event.channel === CHANNEL.STORED) onStored(device, event.data);
  });

  return {
    /**
     * Check now (PAT-H-03): connect what is not connected, then start the belt, and the band for the maternal reference.
     * Returns { started, reason }. A refusal (charging, battery cutoff, exposure cap, busy) comes back as the reason.
     */
    startCheck(patientId, { durationS = DEVICE_DEFAULTS.belt.checkDurationS, useBand = true, source = 'on_demand' } = {}) {
      const belt = state().db.devices.find((d) => d.patient_id === patientId && d.type === 'belt');
      const band = useBand ? bandOf(patientId) : null;
      if (!belt) return { started: false, reason: 'no_belt' };
      if (active.has(patientId)) return { started: false, reason: 'busy' };
      for (const device of [belt, band].filter(Boolean)) if (!link.isConnected(device.serial)) link.connect(device.serial);
      const run = begin(patientId, belt.serial, band ? band.serial : null, { durationS, source });
      link.startCheck(belt.serial, durationS);
      if (!active.has(patientId)) return { started: false, reason: state().live.check.reason };
      if (band) link.startCheck(band.serial, DEVICE_DEFAULTS.band.burstLengthS);
      return { started: true, run };
    },

    stopCheck(patientId) {
      const run = active.get(patientId);
      if (!run) return;
      link.stop(run.beltSerial);
      fail(run, 'stopped');
    },

    /** The band was pressed while it was out of reach: the app tells the patient it could not be delivered (until it is relayed). */
    markSosUndelivered(patientId) {
      store.dispatch({ type: 'live', patch: { sos: { patient_id: patientId, state: 'undelivered', seq: null } } });
    },
    isChecking: (patientId) => active.has(patientId),
    isBusy: () => active.size > 0,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Forget everything in flight (reset, or after a reload). */
    reset() {
      active.clear();
      vitals.clear();
      replays.clear();
      used.clear();
      store.dispatch({ type: 'live', patch: { check: null, sos: null } });
    },
  };
}
