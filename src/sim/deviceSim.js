// The simulated belt and band (spec 8): the firmware states of 8.2 and 8.3, the contact test, the exposure interlock
// (FW-B-09), battery levels (9.5), store-and-forward with a ring buffer (FW-C-06) and SOS repeats (FW-D). It sits behind
// the device link of lib/deviceLink.js, takes the command bytes of spec 7.3 and emits the packet bytes of 7.2, which the
// app decodes with lib/packets.js. Replacing it with a Web Bluetooth adapter changes nothing else.
//
// The state of every device lives in the store (`hardware`), reached through `world`, so it survives a reload.
import { DEVICE_DEFAULTS, THRESHOLDS } from '../config/thresholds.js';
import { batteryLevel, voltageForPct } from '../lib/battery.js';
import { CHANNEL, createDeviceLink } from '../lib/deviceLink.js';
import {
  BAND_STATE,
  BELT_STATE,
  FHR_FLAG,
  FHR_TYPE,
  RESULT,
  SOS_TYPE,
  STATUS_FLAG,
  VITALS_FLAG,
  decodeCommand,
  encodeBandSos,
  encodeBandStatus,
  encodeBandVitals,
  encodeBeltFhr,
  encodeBeltStatus,
  encodeEndOfReplay,
  wrapStored,
} from '../lib/packets.js';
import { median } from '../lib/readings.js';
import { createRng } from './prng.js';

const BELT = DEVICE_DEFAULTS.belt;
const BAND = DEVICE_DEFAULTS.band;
const BELT_BUSY = new Set(['SELF_TEST', 'CONTACT_CHECK', 'ACQUIRE', 'PROCESS', 'REPORT', 'SYNC']);
const BAND_BUSY = new Set(['MEASURE', 'PROCESS', 'REPORT']);
const DISCARDED = FHR_FLAG.MOTION | FHR_FLAG.POOR_CONTACT | FHR_FLAG.LOW_SIGNAL | FHR_FLAG.PARTIAL;
const RING_LIMIT = 4000;

/** What the belt "senses" in the next check. Scenarios replace it; a check uses it once and then it goes back to normal. */
export const NORMAL_BELT_SIGNAL = {
  fhr: { base: 144, jitter: 4 }, // a window is the base plus or minus the jitter
  confidence: [72, 92],
  sqi: [65, 90],
  contact: 'ok', // 'ok', 'poor' (poor for contactDelayS, then good) or 'none' (never, the check ends after the contact timeout)
  contactDelayS: 0,
  lowSignalAll: false, // every window has no usable signal
  maternalHr: 84, // the rate a 'maternal' event copies
  events: [], // windows (counted from 1): { from, to, kind: 'motion' | 'fhr' | 'maternal', base?, jitter? }
};
/** What the band senses in the next burst. */
export const NORMAL_BAND_SIGNAL = { hr: 84, spo2: 98, tempC: 36.7, flags: 0 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function hashSeed(text, n) {
  let hash = 2166136261;
  for (const ch of `${text}:${n}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Seconds of exposure left in the rolling window (FW-B-09). */
export function exposureLeft(hardware, nowMs) {
  const since = nowMs - BELT.exposureWindowMin * 60 * 1000;
  const used = (hardware.exposure ?? []).filter((entry) => entry.at > since).reduce((sum, entry) => sum + entry.s, 0);
  return Math.max(0, BELT.exposureCapS - used);
}

function statusFlags(hardware, nowMs) {
  let flags = 0;
  if (hardware.charging) flags |= STATUS_FLAG.CHARGING;
  if (batteryLevel(hardware.battery, null) !== 'normal') flags |= STATUS_FLAG.LOW_BATTERY;
  if (hardware.clock_synced) flags |= STATUS_FLAG.TIME_SYNCED;
  if (hardware.type === 'belt' && exposureLeft(hardware, nowMs) === 0) flags |= STATUS_FLAG.EXPOSURE_CAPPED;
  if (hardware.fault) flags |= STATUS_FLAG.FAULT;
  return flags;
}

function windowValues(k, signal, rng, clockSynced) {
  let fhr = clamp(Math.round(signal.fhr.base + (rng.next() - rng.next()) * signal.fhr.jitter), 40, 240);
  let flags = 0;
  let confidence = rng.int(signal.confidence[0], signal.confidence[1]);
  let sqi = rng.int(signal.sqi[0], signal.sqi[1]);
  const weak = () => {
    confidence = rng.int(0, 25);
    sqi = rng.int(10, 35);
  };
  if (signal.lowSignalAll) {
    fhr = 0;
    flags = FHR_FLAG.LOW_SIGNAL;
    weak();
  }
  for (const event of signal.events) {
    if (k < event.from || k > event.to) continue;
    if (event.kind === 'motion') {
      fhr = 0;
      flags = FHR_FLAG.MOTION;
      weak();
    } else if (event.kind === 'fhr') {
      fhr = clamp(Math.round(event.base + (rng.next() - rng.next()) * event.jitter), 40, 240);
    } else if (event.kind === 'maternal') {
      fhr = signal.maternalHr + rng.int(-2, 2); // looks like a heartbeat, but it is the mother's
    }
  }
  if (fhr > 0 && (fhr < THRESHOLDS.fhr.min || fhr > THRESHOLDS.fhr.max)) flags |= FHR_FLAG.OUT_OF_RANGE;
  if (!clockSynced) flags |= FHR_FLAG.CLOCK_UNSYNCED;
  return { fhr, confidence, sqi, flags };
}

/**
 * The timeline of one belt check, as steps { at (ms from the start), kind, ... } with the packet bytes. Pure: the
 * same inputs give the same check. The live path runs it on the scheduler; the stored path (checks made while apart)
 * appends it to the ring buffer at once.
 */
export function planBeltCheck({ serial, firstSeq, sessionId, startMs, durationS, signal = {}, clockSynced = true }) {
  const sig = { ...NORMAL_BELT_SIGNAL, ...signal };
  const rng = createRng(hashSeed(serial, firstSeq));
  const windowMs = BELT.windowS * 1000;
  const count = Math.floor(durationS / BELT.windowS);
  const stamp = (at) => Math.floor((startMs + at) / 1000);
  const unsynced = clockSynced ? 0 : FHR_FLAG.CLOCK_UNSYNCED;
  const steps = [];

  let at = 800;
  steps.push({ at, kind: 'state', state: 'CONTACT_CHECK', contact: sig.contact === 'ok' ? 0b011 : 0b001 });

  if (sig.contact === 'none') {
    const timeout = at + BELT.contactTimeoutS * 1000;
    const bytes = encodeBeltFhr({
      type: FHR_TYPE.SUMMARY, sessionId, seq: firstSeq, tEpoch: stamp(timeout), fhr: 0, confidence: 0, sqi: 0, element: 1,
      flags: FHR_FLAG.POOR_CONTACT | unsynced,
    });
    steps.push({ at: timeout, kind: 'summary', seq: firstSeq, bytes });
    steps.push({ at: timeout + 400, kind: 'state', state: 'IDLE', contact: 0, resultCode: RESULT.NO_CONTACT });
    return { steps, nextSeq: firstSeq + 1, sessionId, exposureS: 0, windowCount: 0 };
  }

  at += sig.contact === 'poor' ? sig.contactDelayS * 1000 : 1000;
  steps.push({ at, kind: 'state', state: 'ACQUIRE', contact: 0b111 });

  const windows = [];
  for (let k = 1; k <= count; k += 1) {
    const value = windowValues(k, sig, rng, clockSynced);
    windows.push(value);
    const seq = firstSeq + k - 1;
    const bytes = encodeBeltFhr({ type: FHR_TYPE.WINDOW, sessionId, seq, tEpoch: stamp(at + k * windowMs), element: 1 + (k % 3), ...value });
    steps.push({ at: at + k * windowMs, kind: 'window', seq, bytes });
  }

  // The belt's own summary: median of the valid windows and the share of valid windows (spec 7.2).
  const valid = windows.filter((w) => w.fhr > 0 && (w.flags & DISCARDED) === 0);
  const end = at + count * windowMs + 300;
  const summaryBytes = encodeBeltFhr({
    type: FHR_TYPE.SUMMARY,
    sessionId,
    seq: firstSeq + count,
    tEpoch: stamp(end),
    fhr: valid.length ? Math.round(median(valid.map((w) => w.fhr))) : 0,
    confidence: count ? Math.round((100 * valid.length) / count) : 0,
    sqi: valid.length ? Math.round(valid.reduce((sum, w) => sum + w.sqi, 0) / valid.length) : 0,
    element: 1,
    flags: valid.length ? unsynced : FHR_FLAG.LOW_SIGNAL | unsynced,
  });
  steps.push({ at: end, kind: 'summary', seq: firstSeq + count, bytes: summaryBytes });
  steps.push({ at: end + 500, kind: 'state', state: 'IDLE', contact: 0, resultCode: RESULT.OK });
  return { steps, nextSeq: firstSeq + count + 1, sessionId, exposureS: count * BELT.windowS, windowCount: count };
}

/** The timeline of one band burst (spec 8.3): measure, then one Vitals packet. */
export function planBandBurst({ firstSeq, startMs, durationS = BAND.burstLengthS, signal = {}, clockSynced = true }) {
  const sig = { ...NORMAL_BAND_SIGNAL, ...signal };
  const end = durationS * 1000;
  const bytes = encodeBandVitals({
    seq: firstSeq,
    tEpoch: Math.floor((startMs + end) / 1000),
    hr: sig.hr,
    spo2: sig.spo2,
    skinTempC: sig.tempC,
    flags: sig.flags | (clockSynced ? 0 : VITALS_FLAG.CLOCK_UNSYNCED),
  });
  return {
    steps: [
      { at: end, kind: 'vitals', seq: firstSeq, bytes },
      { at: end + 400, kind: 'state', state: 'IDLE', contact: 0, resultCode: RESULT.OK },
    ],
    nextSeq: firstSeq + 1,
  };
}

/**
 * world: { get(serial), patch(serial, patch), list() } over the stored hardware state.
 * sched: the shared scheduler. now: the clock in milliseconds.
 * Returns { link, control }: the link is what the app uses; the control is only for the scenarios and the tests.
 */
export function createDeviceSim({ world, sched, now = Date.now }) {
  const listeners = new Set();

  function emit(serial, channel, data, extra = {}) {
    const hardware = world.get(serial);
    if (!hardware || (!hardware.connected && channel !== CHANNEL.CONNECTION)) return;
    for (const listener of [...listeners]) listener({ serial, device: hardware.type, channel, data, ...extra });
  }

  const idleState = (hardware) => {
    if (hardware.charging) return 'CHARGING';
    if (hardware.type === 'belt') return 'ACTIVE_IDLE';
    if (hardware.sos && !hardware.sos.acked) return 'SOS';
    return hardware.connected ? 'CONNECTED_IDLE' : 'ADVERTISING';
  };

  function statusBytes(hardware, resultCode) {
    const flags = statusFlags(hardware, now());
    if (hardware.type === 'belt') {
      return encodeBeltStatus({
        state: BELT_STATE[hardware.state] ?? BELT_STATE.ACTIVE_IDLE,
        flags,
        contact: hardware.contact ?? 0,
        battery: hardware.battery,
        exposureLeft: exposureLeft(hardware, now()),
        faultCode: hardware.fault,
        resultCode,
      });
    }
    return encodeBandStatus({
      state: BAND_STATE[hardware.state] ?? BAND_STATE.CONNECTED_IDLE,
      flags,
      battery: hardware.battery,
      faultCode: hardware.fault,
      resultCode,
    });
  }
  const emitStatus = (serial, resultCode = RESULT.OK) => {
    const hardware = world.get(serial);
    if (hardware) emit(serial, CHANNEL.STATUS, statusBytes(hardware, resultCode));
  };
  const emitBattery = (serial) => {
    const hardware = world.get(serial);
    if (hardware) emit(serial, CHANNEL.BATTERY, Uint8Array.of(hardware.battery));
  };

  /** Every result is kept in the ring buffer until the app acknowledges it (FW-C-06). */
  function ringAppend(serial, seq, bytes) {
    const hardware = world.get(serial);
    const ring = [...hardware.ring, { seq, bytes: Array.from(bytes) }];
    world.patch(serial, { ring: ring.length > RING_LIMIT ? ring.slice(ring.length - RING_LIMIT) : ring });
  }
  const pushExposure = (serial, seconds) => {
    const hardware = world.get(serial);
    world.patch(serial, { exposure: [...(hardware.exposure ?? []).filter((e) => e.at > now() - BELT.exposureWindowMin * 60000), { at: now(), s: seconds }] });
  };

  function runStep(serial, token, plan, step) {
    const hardware = world.get(serial);
    if (!hardware || hardware.run_token !== token) return; // stopped, or a newer run took over
    if (step.kind === 'state') {
      const finished = step.state === 'IDLE';
      world.patch(serial, { state: finished ? idleState(hardware) : step.state, contact: step.contact ?? 0, ...(finished ? { run_token: null } : {}) });
      emitStatus(serial, step.resultCode ?? RESULT.OK);
      return;
    }
    ringAppend(serial, step.seq, step.bytes);
    if (step.kind === 'window') emit(serial, CHANNEL.FHR, step.bytes);
    if (step.kind === 'summary') {
      emit(serial, CHANNEL.FHR, step.bytes);
      if (plan.exposureS) pushExposure(serial, plan.exposureS);
    }
    if (step.kind === 'vitals') emit(serial, CHANNEL.VITALS, step.bytes);
  }

  function schedule(serial, token, plan) {
    for (const step of plan.steps) sched.after(step.at, () => runStep(serial, token, plan, step));
  }

  function beltRefusal(hardware, durationS) {
    if (hardware.fault) return RESULT.FAULT;
    if (BELT_BUSY.has(hardware.state)) return RESULT.BUSY;
    if (hardware.charging) return RESULT.CHARGING;
    if (batteryLevel(hardware.battery, voltageForPct(hardware.battery)) === 'cutoff') return RESULT.LOW_BATTERY;
    if (exposureLeft(hardware, now()) < durationS) return RESULT.EXPOSURE_CAP;
    return RESULT.OK;
  }
  function bandRefusal(hardware) {
    if (hardware.fault) return RESULT.FAULT;
    if (BAND_BUSY.has(hardware.state)) return RESULT.BUSY;
    if (hardware.charging) return RESULT.CHARGING;
    if (batteryLevel(hardware.battery, voltageForPct(hardware.battery)) === 'cutoff') return RESULT.LOW_BATTERY;
    return RESULT.OK;
  }

  function startBeltCheck(serial, durationS) {
    const hardware = world.get(serial);
    const refusal = beltRefusal(hardware, durationS);
    if (refusal !== RESULT.OK) {
      emitStatus(serial, refusal);
      return;
    }
    const startMs = now();
    const plan = planBeltCheck({
      serial,
      firstSeq: hardware.next_seq,
      sessionId: (hardware.session_counter + 1) & 0xffff,
      startMs,
      durationS,
      signal: hardware.signal ?? {},
      clockSynced: hardware.clock_synced,
    });
    const token = `${serial}:${plan.sessionId}:${startMs}`;
    world.patch(serial, { state: 'SELF_TEST', contact: 0, next_seq: plan.nextSeq, session_counter: plan.sessionId, signal: null, run_token: token });
    emitStatus(serial, RESULT.OK);
    schedule(serial, token, plan);
  }

  function startBandBurst(serial, durationS) {
    const hardware = world.get(serial);
    const refusal = bandRefusal(hardware);
    if (refusal !== RESULT.OK) {
      emitStatus(serial, refusal);
      return;
    }
    const startMs = now();
    const plan = planBandBurst({ firstSeq: hardware.next_seq, startMs, durationS: durationS || BAND.burstLengthS, signal: hardware.signal ?? {}, clockSynced: hardware.clock_synced });
    const token = `${serial}:${startMs}`;
    world.patch(serial, { state: 'MEASURE', next_seq: plan.nextSeq, signal: null, run_token: token });
    emitStatus(serial, RESULT.OK);
    schedule(serial, token, plan);
  }

  function stopRun(serial) {
    const hardware = world.get(serial);
    world.patch(serial, { run_token: null, contact: 0, state: idleState(hardware) });
    emitStatus(serial, RESULT.OK);
  }

  /** Replay the ring buffer after from_seq on Stored Records, then the end packet (FW-C-07). */
  function replayStored(serial, fromSeq) {
    sched.after(300, () => {
      const hardware = world.get(serial);
      if (!hardware?.connected) return;
      const records = hardware.ring.filter((r) => r.seq > fromSeq).sort((a, b) => a.seq - b.seq);
      records.forEach((record, index) => {
        sched.after(100 * (index + 1), () => emit(serial, CHANNEL.STORED, wrapStored(Uint8Array.from(record.bytes))));
      });
      const lastSeq = records.length ? records[records.length - 1].seq : fromSeq;
      sched.after(100 * (records.length + 1), () => emit(serial, CHANNEL.STORED, encodeEndOfReplay(lastSeq)));
    });
  }

  function scheduleSosRepeat(serial, seq, bytes) {
    sched.after(BAND.sosRepeatS * 1000, () => {
      const hardware = world.get(serial);
      if (!hardware?.connected || !hardware.sos || hardware.sos.acked || hardware.sos.seq !== seq) return;
      emit(serial, CHANNEL.SOS, bytes);
      scheduleSosRepeat(serial, seq, bytes);
    }, { background: true });
  }

  function ackSos(serial, seq) {
    const hardware = world.get(serial);
    if (!hardware?.sos || seq < hardware.sos.seq) return;
    world.patch(serial, { sos: { ...hardware.sos, acked: true }, state: hardware.charging ? 'CHARGING' : 'CONNECTED_IDLE' });
    emitStatus(serial, RESULT.OK);
  }

  function write(serial, bytes) {
    const hardware = world.get(serial);
    if (!hardware || !hardware.connected) return false;
    const { name, argument } = decodeCommand(bytes);
    if (name === 'START_CHECK') {
      if (hardware.type === 'belt') startBeltCheck(serial, argument);
      else startBandBurst(serial, argument);
    } else if (name === 'STOP') {
      stopRun(serial);
    } else if (name === 'TIME_SYNC') {
      world.patch(serial, { clock_synced: true });
      emitStatus(serial);
    } else if (name === 'REQUEST_STORED') {
      replayStored(serial, argument);
    } else if (name === 'ACK_STORED') {
      world.patch(serial, { ring: hardware.ring.filter((r) => r.seq > argument) });
    } else if (name === 'IDENTIFY') {
      emitStatus(serial);
    } else if (name === 'ACK_SOS') {
      ackSos(serial, argument);
    }
    return true;
  }

  const adapter = {
    connect(serial) {
      const hardware = world.get(serial);
      if (!hardware) return false;
      if (hardware.connected) return true;
      const keep = hardware.type === 'belt' && BELT_BUSY.has(hardware.state);
      world.patch(serial, { connected: true, advertising: false, state: keep ? hardware.state : idleState({ ...hardware, connected: true }) });
      emit(serial, CHANNEL.CONNECTION, undefined, { connected: true });
      emitStatus(serial);
      emitBattery(serial);
      return true;
    },
    disconnect(serial) {
      const hardware = world.get(serial);
      if (!hardware || !hardware.connected) return false;
      const busy = hardware.type === 'belt' ? BELT_BUSY.has(hardware.state) : BAND_BUSY.has(hardware.state) || Boolean(hardware.sos && !hardware.sos.acked);
      world.patch(serial, { connected: false, state: busy ? hardware.state : idleState({ ...hardware, connected: false }) });
      emit(serial, CHANNEL.CONNECTION, undefined, { connected: false });
      return true;
    },
    isConnected: (serial) => world.get(serial)?.connected === true,
    write,
    onNotification(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  // ---------- Controls for the scenarios and tests: the world around the devices ----------
  const control = {
    setSignal: (serial, signal) => world.patch(serial, { signal }),

    setBattery(serial, pct) {
      world.patch(serial, { battery: pct });
      emitStatus(serial);
      emitBattery(serial);
    },

    setCharging(serial, on) {
      const hardware = world.get(serial);
      world.patch(serial, { charging: on, state: idleState({ ...hardware, charging: on }) });
      emitStatus(serial);
    },

    /** Use up the exposure allowance: the next check is refused with result code 4. */
    fillExposure(serial) {
      pushExposure(serial, BELT.exposureCapS);
      emitStatus(serial);
    },

    /** The wearer presses and holds the SOS button (FW-D). Connected, it repeats until acknowledged; apart, it is stored. */
    pressSos(serial) {
      const hardware = world.get(serial);
      if (!hardware || hardware.type !== 'band') return null;
      const seq = hardware.next_seq;
      const bytes = encodeBandSos({ type: SOS_TYPE.PRESSED, seq, tEpoch: Math.floor(now() / 1000), battery: hardware.battery });
      world.patch(serial, { next_seq: seq + 1, state: 'SOS', sos: { seq, acked: false } });
      if (hardware.connected) {
        emit(serial, CHANNEL.SOS, bytes);
        scheduleSosRepeat(serial, seq, bytes);
      } else {
        ringAppend(serial, seq, bytes);
      }
      return seq;
    },

    /** A second hold cancels the SOS. */
    cancelSos(serial) {
      const hardware = world.get(serial);
      if (!hardware || hardware.type !== 'band') return null;
      const seq = hardware.next_seq;
      const bytes = encodeBandSos({ type: SOS_TYPE.CANCELLED, seq, tEpoch: Math.floor(now() / 1000), battery: hardware.battery });
      world.patch(serial, { next_seq: seq + 1, sos: null, state: hardware.charging ? 'CHARGING' : hardware.connected ? 'CONNECTED_IDLE' : 'ADVERTISING' });
      if (hardware.connected) emit(serial, CHANNEL.SOS, bytes);
      else ringAppend(serial, seq, bytes);
      return seq;
    },

    /** A scheduled check the belt (and a band burst) made on its own while no phone was connected: kept in the ring buffer. */
    storeCheck({ beltSerial, bandSerial = null, atMs, beltSignal = {}, bandSignal = {}, durationS = BELT.checkDurationS }) {
      const belt = world.get(beltSerial);
      const plan = planBeltCheck({ serial: beltSerial, firstSeq: belt.next_seq, sessionId: (belt.session_counter + 1) & 0xffff, startMs: atMs, durationS, signal: beltSignal, clockSynced: belt.clock_synced });
      const records = plan.steps.filter((s) => s.kind === 'window' || s.kind === 'summary').map((s) => ({ seq: s.seq, bytes: Array.from(s.bytes) }));
      world.patch(beltSerial, {
        ring: [...belt.ring, ...records],
        next_seq: plan.nextSeq,
        session_counter: plan.sessionId,
        exposure: [...(belt.exposure ?? []), { at: atMs + durationS * 1000, s: plan.exposureS }],
      });
      if (bandSerial) {
        const band = world.get(bandSerial);
        const burst = planBandBurst({ firstSeq: band.next_seq, startMs: atMs, signal: bandSignal, clockSynced: band.clock_synced });
        const vitals = burst.steps.find((s) => s.kind === 'vitals');
        world.patch(bandSerial, { ring: [...band.ring, { seq: vitals.seq, bytes: Array.from(vitals.bytes) }], next_seq: burst.nextSeq });
      }
    },

    /** Keeps connected devices' last-seen time fresh: a status and a battery notification each (spec 9.6). */
    heartbeat() {
      for (const hardware of world.list()) {
        if (!hardware.connected) continue;
        emitStatus(hardware.serial);
        emitBattery(hardware.serial);
      }
    },

    /** After a reload nothing is mid-run: devices go back to idle and any SOS repeat is gone. */
    settle() {
      for (const hardware of world.list()) {
        const busy = hardware.type === 'belt' ? BELT_BUSY.has(hardware.state) : BAND_BUSY.has(hardware.state);
        if (busy || hardware.run_token) world.patch(hardware.serial, { run_token: null, contact: 0, state: idleState(hardware) });
      }
    },
  };

  return { link: createDeviceLink(adapter), control };
}
