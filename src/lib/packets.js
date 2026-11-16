// Packet formats of spec 7.2, command opcodes and result codes of spec 7.3.
// All multi-byte values are little-endian and every packet is 20 bytes or less (spec 7.1).
// The simulated link emits these bytes and the app decodes them here, so a Web Bluetooth adapter
// can replace the simulation without touching screens.

/** Result of the last command (spec 7.3). */
export const RESULT = {
  OK: 0,
  BUSY: 1,
  CHARGING: 2,
  LOW_BATTERY: 3,
  EXPOSURE_CAP: 4,
  NO_CONTACT: 5,
  FAULT: 6,
  CLOCK_NOT_SYNCED: 7,
  NOT_ALLOWED: 8,
};
export const RESULT_NAMES = Object.fromEntries(Object.entries(RESULT).map(([name, code]) => [code, name]));

/** Control characteristic opcodes (spec 7.3). */
export const OPCODE = {
  START_CHECK: 0x01, // belt check or band burst (START_MEASURE); argument duration_s (u16)
  STOP: 0x02,
  TIME_SYNC: 0x03, // argument unix_time (u32)
  REQUEST_STORED: 0x04, // argument from_seq (u32)
  ACK_STORED: 0x05, // argument up_to_seq (u32)
  IDENTIFY: 0x06,
  ACK_SOS: 0x07, // band only; argument seq (u32)
};
const COMMAND_ARGUMENT = {
  [OPCODE.START_CHECK]: 2,
  [OPCODE.STOP]: 0,
  [OPCODE.TIME_SYNC]: 4,
  [OPCODE.REQUEST_STORED]: 4,
  [OPCODE.ACK_STORED]: 4,
  [OPCODE.IDENTIFY]: 0,
  [OPCODE.ACK_SOS]: 4,
};
const OPCODE_NAMES = Object.fromEntries(Object.entries(OPCODE).map(([name, code]) => [code, name]));

// Firmware states in the order of the tables in spec 8.2.1 and 8.3.1. The spec lists names only,
// so these numeric codes are a proposal.
export const BELT_STATE = {
  DEEP_SLEEP: 0,
  WAKE: 1,
  CHARGING: 2,
  SELF_TEST: 3,
  CONTACT_CHECK: 4,
  ACQUIRE: 5,
  PROCESS: 6,
  REPORT: 7,
  SYNC: 8,
  ACTIVE_IDLE: 9,
  FAULT: 10,
};
export const BAND_STATE = {
  CONNECTED_IDLE: 0,
  ADVERTISING: 1,
  MEASURE: 2,
  PROCESS: 3,
  REPORT: 4,
  SOS: 5,
  CHARGING: 6,
  DEEP_SLEEP: 7,
};

/** Status flags (spec 7.2, Belt Status). The band Status uses the same bits it has a use for. */
export const STATUS_FLAG = {
  CHARGING: 1 << 0,
  LOW_BATTERY: 1 << 1,
  TIME_SYNCED: 1 << 2,
  EXPOSURE_CAPPED: 1 << 3,
  FAULT: 1 << 4,
};
/** Belt FHR Result flags. */
export const FHR_FLAG = {
  MOTION: 1 << 0,
  POOR_CONTACT: 1 << 1,
  LOW_SIGNAL: 1 << 2,
  CLOCK_UNSYNCED: 1 << 3,
  OUT_OF_RANGE: 1 << 4,
  PARTIAL: 1 << 5,
};
/** Band Vitals flags. */
export const VITALS_FLAG = {
  MOTION_REJECTED: 1 << 0,
  WEAK_SIGNAL: 1 << 1,
  CLOCK_UNSYNCED: 1 << 2,
  ABNORMAL: 1 << 3,
  PARTIAL: 1 << 4,
};

export const FHR_TYPE = { WINDOW: 1, SUMMARY: 2 };
export const VITALS_TYPE = { BURST: 1 };
export const SOS_TYPE = { PRESSED: 1, CANCELLED: 2 };

/** Records replayed on Stored Records carry the same packet prefixed by this byte. */
export const STORED_PREFIX = 0x01;
/** A packet of this type ends a replay and carries the last sequence number sent. */
export const END_OF_REPLAY = 0xff;

export const PACKET_LENGTH = {
  beltStatus: 8,
  beltFhr: 16,
  bandVitals: 14,
  bandSos: 10,
  bandStatus: 5, // proposed: spec 7.1 lists the fields (state, flags, battery, fault), not the layout
  endOfReplay: 5,
};

function writer(length) {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}

function int(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** Accepts the byte containers a BLE stack hands over: Uint8Array, ArrayBuffer, DataView or a plain array. */
export function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return Uint8Array.from(input);
}

function reader(input, length, name) {
  const bytes = asBytes(input);
  if (bytes.length !== length) throw new RangeError(`${name} packet must be ${length} bytes, got ${bytes.length}`);
  return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

export function bytesToHex(input) {
  return Array.from(asBytes(input), (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

// ---------- Belt Status (8 bytes) ----------

export function encodeBeltStatus({ state, flags = 0, contact = 0, battery, exposureLeft, faultCode = 0, resultCode = 0 }) {
  const { bytes, view } = writer(PACKET_LENGTH.beltStatus);
  view.setUint8(0, int(state, 0, 255, 'state'));
  view.setUint8(1, int(flags, 0, 255, 'flags'));
  view.setUint8(2, int(contact, 0, 7, 'contact'));
  view.setUint8(3, int(battery, 0, 100, 'battery'));
  view.setUint16(4, int(exposureLeft, 0, 65535, 'exposureLeft'), true);
  view.setUint8(6, int(faultCode, 0, 255, 'faultCode'));
  view.setUint8(7, int(resultCode, 0, 255, 'resultCode'));
  return bytes;
}

export function decodeBeltStatus(input) {
  const { view } = reader(input, PACKET_LENGTH.beltStatus, 'Belt Status');
  const flags = view.getUint8(1);
  const contact = view.getUint8(2) & 0b111;
  return {
    state: view.getUint8(0),
    flags,
    contact,
    pads: [Boolean(contact & 1), Boolean(contact & 2), Boolean(contact & 4)],
    battery: view.getUint8(3),
    exposureLeft: view.getUint16(4, true),
    faultCode: view.getUint8(6),
    resultCode: view.getUint8(7),
    charging: Boolean(flags & STATUS_FLAG.CHARGING),
    lowBattery: Boolean(flags & STATUS_FLAG.LOW_BATTERY),
    timeSynced: Boolean(flags & STATUS_FLAG.TIME_SYNCED),
    exposureCapped: Boolean(flags & STATUS_FLAG.EXPOSURE_CAPPED),
    fault: Boolean(flags & STATUS_FLAG.FAULT),
  };
}

// ---------- Band Status (5 bytes, proposed layout) ----------

export function encodeBandStatus({ state, flags = 0, battery, faultCode = 0, resultCode = 0 }) {
  const { bytes, view } = writer(PACKET_LENGTH.bandStatus);
  view.setUint8(0, int(state, 0, 255, 'state'));
  view.setUint8(1, int(flags, 0, 255, 'flags'));
  view.setUint8(2, int(battery, 0, 100, 'battery'));
  view.setUint8(3, int(faultCode, 0, 255, 'faultCode'));
  view.setUint8(4, int(resultCode, 0, 255, 'resultCode'));
  return bytes;
}

export function decodeBandStatus(input) {
  const { view } = reader(input, PACKET_LENGTH.bandStatus, 'Band Status');
  const flags = view.getUint8(1);
  return {
    state: view.getUint8(0),
    flags,
    battery: view.getUint8(2),
    faultCode: view.getUint8(3),
    resultCode: view.getUint8(4),
    charging: Boolean(flags & STATUS_FLAG.CHARGING),
    lowBattery: Boolean(flags & STATUS_FLAG.LOW_BATTERY),
    timeSynced: Boolean(flags & STATUS_FLAG.TIME_SYNCED),
    fault: Boolean(flags & STATUS_FLAG.FAULT),
  };
}

// ---------- Belt FHR Result (16 bytes) ----------

export function encodeBeltFhr({ type, sessionId, seq, tEpoch, fhr, confidence, sqi, element, flags = 0 }) {
  const { bytes, view } = writer(PACKET_LENGTH.beltFhr);
  view.setUint8(0, int(type, 1, 2, 'type'));
  view.setUint16(1, int(sessionId, 0, 65535, 'sessionId'), true);
  view.setUint32(3, int(seq, 0, 0xffffffff, 'seq'), true);
  view.setUint32(7, int(tEpoch, 0, 0xffffffff, 't_epoch'), true);
  view.setUint8(11, int(fhr, 0, 255, 'fhr'));
  view.setUint8(12, int(confidence, 0, 100, 'confidence'));
  view.setUint8(13, int(sqi, 0, 100, 'sqi'));
  view.setUint8(14, int(element, 0, 3, 'element'));
  view.setUint8(15, int(flags, 0, 255, 'flags'));
  return bytes;
}

export function decodeBeltFhr(input) {
  const { view } = reader(input, PACKET_LENGTH.beltFhr, 'Belt FHR Result');
  const flags = view.getUint8(15);
  return {
    type: view.getUint8(0),
    sessionId: view.getUint16(1, true),
    seq: view.getUint32(3, true),
    tEpoch: view.getUint32(7, true),
    fhr: view.getUint8(11),
    confidence: view.getUint8(12),
    sqi: view.getUint8(13),
    element: view.getUint8(14),
    flags,
    motion: Boolean(flags & FHR_FLAG.MOTION),
    poorContact: Boolean(flags & FHR_FLAG.POOR_CONTACT),
    lowSignal: Boolean(flags & FHR_FLAG.LOW_SIGNAL),
    clockUnsynced: Boolean(flags & FHR_FLAG.CLOCK_UNSYNCED),
    outOfRange: Boolean(flags & FHR_FLAG.OUT_OF_RANGE),
    partial: Boolean(flags & FHR_FLAG.PARTIAL),
  };
}

// ---------- Band Vitals (14 bytes) ----------

export function encodeBandVitals({ seq, tEpoch, hr, spo2, skinTempC, flags = 0 }) {
  const { bytes, view } = writer(PACKET_LENGTH.bandVitals);
  view.setUint8(0, VITALS_TYPE.BURST);
  view.setUint32(1, int(seq, 0, 0xffffffff, 'seq'), true);
  view.setUint32(5, int(tEpoch, 0, 0xffffffff, 't_epoch'), true);
  view.setUint8(9, int(hr, 0, 255, 'hr'));
  view.setUint8(10, int(spo2, 0, 100, 'spo2'));
  view.setInt16(11, int(Math.round(skinTempC * 100), -32768, 32767, 'skin_temp'), true);
  view.setUint8(13, int(flags, 0, 255, 'flags'));
  return bytes;
}

export function decodeBandVitals(input) {
  const { view } = reader(input, PACKET_LENGTH.bandVitals, 'Band Vitals');
  const flags = view.getUint8(13);
  const skinTemp = view.getInt16(11, true);
  return {
    type: view.getUint8(0),
    seq: view.getUint32(1, true),
    tEpoch: view.getUint32(5, true),
    hr: view.getUint8(9),
    spo2: view.getUint8(10),
    skinTemp,
    skinTempC: skinTemp / 100,
    flags,
    motionRejected: Boolean(flags & VITALS_FLAG.MOTION_REJECTED),
    weakSignal: Boolean(flags & VITALS_FLAG.WEAK_SIGNAL),
    clockUnsynced: Boolean(flags & VITALS_FLAG.CLOCK_UNSYNCED),
    abnormal: Boolean(flags & VITALS_FLAG.ABNORMAL),
    partial: Boolean(flags & VITALS_FLAG.PARTIAL),
  };
}

// ---------- Band SOS (10 bytes) ----------

export function encodeBandSos({ type, seq, tEpoch, battery }) {
  const { bytes, view } = writer(PACKET_LENGTH.bandSos);
  view.setUint8(0, int(type, 1, 2, 'type'));
  view.setUint32(1, int(seq, 0, 0xffffffff, 'seq'), true);
  view.setUint32(5, int(tEpoch, 0, 0xffffffff, 't_epoch'), true);
  view.setUint8(9, int(battery, 0, 100, 'battery'));
  return bytes;
}

export function decodeBandSos(input) {
  const { view } = reader(input, PACKET_LENGTH.bandSos, 'Band SOS');
  const type = view.getUint8(0);
  return {
    type,
    seq: view.getUint32(1, true),
    tEpoch: view.getUint32(5, true),
    battery: view.getUint8(9),
    pressed: type === SOS_TYPE.PRESSED,
    cancelled: type === SOS_TYPE.CANCELLED,
  };
}

// ---------- Stored records and the end-of-replay packet ----------

/** A record replayed from the ring buffer: the original packet prefixed by 0x01. */
export function wrapStored(packet) {
  const bytes = asBytes(packet);
  const out = new Uint8Array(bytes.length + 1);
  out[0] = STORED_PREFIX;
  out.set(bytes, 1);
  return out;
}

/** End of a replay: type 0xFF followed by the last sequence number sent. */
export function encodeEndOfReplay(lastSeq) {
  const { bytes, view } = writer(PACKET_LENGTH.endOfReplay);
  view.setUint8(0, END_OF_REPLAY);
  view.setUint32(1, int(lastSeq, 0, 0xffffffff, 'lastSeq'), true);
  return bytes;
}

/**
 * Decode one notification from the Stored Records characteristic.
 * Returns { kind: 'end', lastSeq } or { kind: 'record', packetType, packet }.
 * The belt replays FHR results (17 bytes); the band replays vitals (15 bytes) or SOS events (11 bytes),
 * told apart by length because both start with type 1.
 */
export function decodeStored(input, deviceType) {
  const bytes = asBytes(input);
  if (bytes.length === PACKET_LENGTH.endOfReplay && bytes[0] === END_OF_REPLAY) {
    return { kind: 'end', lastSeq: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, true) };
  }
  if (bytes.length === 0 || bytes[0] !== STORED_PREFIX) throw new RangeError('A stored record starts with 0x01');
  const body = bytes.subarray(1);
  if (deviceType === 'belt' && body.length === PACKET_LENGTH.beltFhr) {
    return { kind: 'record', packetType: 'fhr', packet: decodeBeltFhr(body) };
  }
  if (deviceType === 'band' && body.length === PACKET_LENGTH.bandVitals) {
    return { kind: 'record', packetType: 'vitals', packet: decodeBandVitals(body) };
  }
  if (deviceType === 'band' && body.length === PACKET_LENGTH.bandSos) {
    return { kind: 'record', packetType: 'sos', packet: decodeBandSos(body) };
  }
  throw new RangeError(`Unexpected stored record length ${bytes.length} for the ${deviceType}`);
}

// ---------- Control commands (spec 7.3) ----------

/** Bytes for the Control characteristic: the opcode followed by its little-endian argument, if any. */
export function encodeCommand(name, argument = 0) {
  const opcode = OPCODE[name];
  if (opcode === undefined) throw new RangeError(`Unknown command ${name}`);
  const size = COMMAND_ARGUMENT[opcode];
  const { bytes, view } = writer(1 + size);
  view.setUint8(0, opcode);
  if (size === 2) view.setUint16(1, int(argument, 0, 65535, 'argument'), true);
  if (size === 4) view.setUint32(1, int(argument, 0, 0xffffffff, 'argument'), true);
  return bytes;
}

export function decodeCommand(input) {
  const bytes = asBytes(input);
  const opcode = bytes[0];
  const size = COMMAND_ARGUMENT[opcode];
  if (size === undefined) throw new RangeError(`Unknown opcode 0x${(opcode ?? 0).toString(16)}`);
  if (bytes.length !== 1 + size) throw new RangeError(`Command ${OPCODE_NAMES[opcode]} must be ${1 + size} bytes`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let argument = 0;
  if (size === 2) argument = view.getUint16(1, true);
  if (size === 4) argument = view.getUint32(1, true);
  return { opcode, name: OPCODE_NAMES[opcode], argument };
}

// ---------- Names ----------

/** Advertised name from the serial: NL-BELT-xxxx or NL-BAND-xxxx, the last four characters of the serial (FW-C-02). */
export function advertisedName(type, serial) {
  return `NL-${type === 'belt' ? 'BELT' : 'BAND'}-${serial.slice(-4)}`;
}
