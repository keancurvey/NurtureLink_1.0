import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAND_STATE, BELT_STATE, FHR_FLAG, FHR_TYPE, OPCODE, PACKET_LENGTH, RESULT, SOS_TYPE, STATUS_FLAG, VITALS_FLAG,
  advertisedName, asBytes, bytesToHex, decodeBandSos, decodeBandStatus, decodeBandVitals, decodeBeltFhr,
  decodeBeltStatus, decodeCommand, decodeStored, encodeBandSos, encodeBandStatus, encodeBandVitals, encodeBeltFhr,
  encodeBeltStatus, encodeCommand, encodeEndOfReplay, wrapStored,
} from '../src/lib/packets.js';

test('packet sizes match spec 7.2 and stay within the 20-byte BLE payload', () => {
  assert.equal(PACKET_LENGTH.beltStatus, 8);
  assert.equal(PACKET_LENGTH.beltFhr, 16);
  assert.equal(PACKET_LENGTH.bandVitals, 14);
  assert.equal(PACKET_LENGTH.bandSos, 10);
  for (const length of Object.values(PACKET_LENGTH)) assert.ok(length + 1 <= 20);
});

test('Belt Status: exact bytes, little-endian exposure, flags and contact bits', () => {
  const bytes = encodeBeltStatus({
    state: BELT_STATE.ACQUIRE, flags: STATUS_FLAG.TIME_SYNCED, contact: 0b111, battery: 76, exposureLeft: 240,
  });
  assert.equal(bytesToHex(bytes), '05 04 07 4c f0 00 00 00');
  const status = decodeBeltStatus(bytes);
  assert.equal(status.state, BELT_STATE.ACQUIRE);
  assert.equal(status.battery, 76);
  assert.equal(status.exposureLeft, 240);
  assert.equal(status.timeSynced, true);
  assert.equal(status.charging, false);
  assert.deepEqual(status.pads, [true, true, true]);
});

test('Belt Status: every flag and a result code round trip; exposure above 255 uses both bytes', () => {
  const flags = STATUS_FLAG.CHARGING | STATUS_FLAG.LOW_BATTERY | STATUS_FLAG.EXPOSURE_CAPPED | STATUS_FLAG.FAULT;
  const bytes = encodeBeltStatus({
    state: BELT_STATE.FAULT, flags, contact: 0b010, battery: 18, exposureLeft: 360, faultCode: 6, resultCode: RESULT.CHARGING,
  });
  assert.equal(bytesToHex(bytes), '0a 1b 02 12 68 01 06 02');
  const status = decodeBeltStatus(bytes);
  assert.equal(status.exposureLeft, 360);
  assert.equal(status.charging && status.lowBattery && status.exposureCapped && status.fault, true);
  assert.equal(status.timeSynced, false);
  assert.deepEqual(status.pads, [false, true, false]);
  assert.equal(status.faultCode, 6);
  assert.equal(status.resultCode, RESULT.CHARGING);
});

test('Belt FHR Result: exact bytes with u16 session, u32 sequence and u32 time', () => {
  const bytes = encodeBeltFhr({
    type: FHR_TYPE.WINDOW, sessionId: 0x0102, seq: 0x01020304, tEpoch: 0x65a1b2c3, fhr: 144, confidence: 85, sqi: 80,
    element: 2, flags: FHR_FLAG.OUT_OF_RANGE,
  });
  assert.equal(bytes.length, 16);
  assert.equal(bytesToHex(bytes), '01 02 01 04 03 02 01 c3 b2 a1 65 90 55 50 02 10');
  const packet = decodeBeltFhr(bytes);
  assert.deepEqual(
    [packet.type, packet.sessionId, packet.seq, packet.tEpoch, packet.fhr, packet.confidence, packet.sqi, packet.element],
    [1, 0x0102, 0x01020304, 0x65a1b2c3, 144, 85, 80, 2],
  );
  assert.equal(packet.outOfRange, true);
  assert.equal(packet.motion, false);
});

test('Belt FHR Result: each flag bit maps to its meaning', () => {
  const flagsFor = (flags) => decodeBeltFhr(encodeBeltFhr({
    type: 2, sessionId: 1, seq: 1, tEpoch: 1, fhr: 0, confidence: 0, sqi: 0, element: 1, flags,
  }));
  assert.equal(flagsFor(FHR_FLAG.MOTION).motion, true);
  assert.equal(flagsFor(FHR_FLAG.POOR_CONTACT).poorContact, true);
  assert.equal(flagsFor(FHR_FLAG.LOW_SIGNAL).lowSignal, true);
  assert.equal(flagsFor(FHR_FLAG.CLOCK_UNSYNCED).clockUnsynced, true);
  assert.equal(flagsFor(FHR_FLAG.OUT_OF_RANGE).outOfRange, true);
  assert.equal(flagsFor(FHR_FLAG.PARTIAL).partial, true);
  assert.equal(flagsFor(0).motion, false);
});

test('Band Vitals: exact bytes, temperature in 0.01 degrees as a signed 16-bit value', () => {
  const bytes = encodeBandVitals({ seq: 7, tEpoch: 256, hr: 84, spo2: 98, skinTempC: 36.7 });
  assert.equal(bytes.length, 14);
  assert.equal(bytesToHex(bytes), '01 07 00 00 00 00 01 00 00 54 62 56 0e 00');
  const vitals = decodeBandVitals(bytes);
  assert.equal(vitals.hr, 84);
  assert.equal(vitals.spo2, 98);
  assert.equal(vitals.skinTemp, 3670);
  assert.equal(vitals.skinTempC, 36.7);
  assert.equal(vitals.seq, 7);
  assert.equal(vitals.tEpoch, 256);
});

test('Band Vitals: a negative temperature round trips and flags map to bits', () => {
  const bytes = encodeBandVitals({ seq: 1, tEpoch: 2, hr: 0, spo2: 0, skinTempC: -0.5, flags: VITALS_FLAG.ABNORMAL | VITALS_FLAG.PARTIAL });
  assert.equal(bytesToHex(bytes.subarray(11, 13)), 'ce ff');
  const vitals = decodeBandVitals(bytes);
  assert.equal(vitals.skinTempC, -0.5);
  assert.equal(vitals.abnormal, true);
  assert.equal(vitals.partial, true);
  assert.equal(vitals.motionRejected, false);
});

test('Band SOS: exact bytes for pressed and cancelled', () => {
  const pressed = encodeBandSos({ type: SOS_TYPE.PRESSED, seq: 0x102, tEpoch: 1, battery: 55 });
  assert.equal(bytesToHex(pressed), '01 02 01 00 00 01 00 00 00 37');
  assert.equal(decodeBandSos(pressed).pressed, true);
  const cancelled = decodeBandSos(encodeBandSos({ type: SOS_TYPE.CANCELLED, seq: 3, tEpoch: 4, battery: 55 }));
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.seq, 3);
});

test('Band Status (proposed layout) round trips', () => {
  const bytes = encodeBandStatus({ state: BAND_STATE.CHARGING, flags: STATUS_FLAG.CHARGING | STATUS_FLAG.TIME_SYNCED, battery: 64 });
  assert.equal(bytes.length, 5);
  const status = decodeBandStatus(bytes);
  assert.equal(status.state, BAND_STATE.CHARGING);
  assert.equal(status.charging, true);
  assert.equal(status.timeSynced, true);
  assert.equal(status.battery, 64);
});

test('stored records carry the 0x01 prefix and decode back by device and length', () => {
  const fhr = encodeBeltFhr({ type: 1, sessionId: 5, seq: 9, tEpoch: 10, fhr: 140, confidence: 90, sqi: 70, element: 1 });
  const storedFhr = wrapStored(fhr);
  assert.equal(storedFhr.length, 17);
  assert.equal(storedFhr[0], 0x01);
  const belt = decodeStored(storedFhr, 'belt');
  assert.equal(belt.kind, 'record');
  assert.equal(belt.packetType, 'fhr');
  assert.equal(belt.packet.seq, 9);

  const vitals = decodeStored(wrapStored(encodeBandVitals({ seq: 4, tEpoch: 5, hr: 80, spo2: 97, skinTempC: 36.5 })), 'band');
  assert.equal(vitals.packetType, 'vitals');
  assert.equal(vitals.packet.hr, 80);

  const sos = decodeStored(wrapStored(encodeBandSos({ type: 1, seq: 6, tEpoch: 7, battery: 50 })), 'band');
  assert.equal(sos.packetType, 'sos');
  assert.equal(sos.packet.seq, 6);
});

test('the 0xFF packet ends a replay and carries the last sequence number', () => {
  const end = encodeEndOfReplay(9);
  assert.equal(bytesToHex(end), 'ff 09 00 00 00');
  assert.deepEqual(decodeStored(end, 'belt'), { kind: 'end', lastSeq: 9 });
  assert.deepEqual(decodeStored(encodeEndOfReplay(0x01020304), 'band'), { kind: 'end', lastSeq: 0x01020304 });
});

test('a stored packet of the wrong size or prefix is refused', () => {
  assert.throws(() => decodeStored(new Uint8Array([0x02, 1, 2, 3]), 'belt'), RangeError);
  assert.throws(() => decodeStored(new Uint8Array([0x01, 1, 2, 3]), 'belt'), RangeError);
  assert.throws(() => decodeStored(new Uint8Array(), 'band'), RangeError);
});

test('commands: opcode plus little-endian argument (spec 7.3)', () => {
  assert.equal(bytesToHex(encodeCommand('START_CHECK', 120)), '01 78 00');
  assert.equal(bytesToHex(encodeCommand('STOP')), '02');
  assert.equal(bytesToHex(encodeCommand('TIME_SYNC', 0x12345678)), '03 78 56 34 12');
  assert.equal(bytesToHex(encodeCommand('REQUEST_STORED', 1)), '04 01 00 00 00');
  assert.equal(bytesToHex(encodeCommand('ACK_STORED', 258)), '05 02 01 00 00');
  assert.equal(bytesToHex(encodeCommand('IDENTIFY')), '06');
  assert.equal(bytesToHex(encodeCommand('ACK_SOS', 5)), '07 05 00 00 00');
  for (const [name, opcode] of Object.entries(OPCODE)) {
    const decoded = decodeCommand(encodeCommand(name, name === 'START_CHECK' ? 30 : 0));
    assert.equal(decoded.opcode, opcode);
    assert.equal(decoded.name, name);
  }
  assert.deepEqual(decodeCommand(encodeCommand('TIME_SYNC', 1700000000)), { opcode: 3, name: 'TIME_SYNC', argument: 1700000000 });
});

test('result codes are the values of spec 7.3', () => {
  assert.deepEqual(Object.values(RESULT), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(RESULT.EXPOSURE_CAP, 4);
  assert.equal(RESULT.LOW_BATTERY, 3);
});

test('wrong lengths and out-of-range fields are refused instead of being decoded wrongly', () => {
  assert.throws(() => decodeBeltStatus(new Uint8Array(7)), RangeError);
  assert.throws(() => decodeBeltFhr(new Uint8Array(15)), RangeError);
  assert.throws(() => decodeBandVitals(new Uint8Array(13)), RangeError);
  assert.throws(() => decodeBandSos(new Uint8Array(11)), RangeError);
  assert.throws(() => encodeBeltStatus({ state: 1, battery: 101, exposureLeft: 0 }), RangeError);
  assert.throws(() => encodeBeltFhr({ type: 1, sessionId: 70000, seq: 1, tEpoch: 1, fhr: 1, confidence: 1, sqi: 1, element: 1 }), RangeError);
  assert.throws(() => encodeCommand('REBOOT'), RangeError);
  assert.throws(() => decodeCommand(new Uint8Array([0x09])), RangeError);
});

test('byte containers from a BLE stack are accepted: DataView, ArrayBuffer and plain arrays', () => {
  const bytes = encodeBandSos({ type: 1, seq: 1, tEpoch: 1, battery: 90 });
  const view = new DataView(bytes.buffer.slice(0));
  assert.equal(decodeBandSos(view).battery, 90);
  assert.equal(decodeBandSos(bytes.buffer.slice(0)).battery, 90);
  assert.equal(decodeBandSos(Array.from(bytes)).battery, 90);
  assert.equal(asBytes(bytes), bytes);
});

test('advertised names use the last four characters of the serial', () => {
  assert.equal(advertisedName('belt', 'NLB-2026-0412'), 'NL-BELT-0412');
  assert.equal(advertisedName('band', 'NLW-2026-0555'), 'NL-BAND-0555');
});
