import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAND, BELT, NOW, bandHardware, beltHardware, makeSim } from './helpers.js';
import {
  BELT_STATE, FHR_FLAG, FHR_TYPE, RESULT, STATUS_FLAG, decodeBandSos, decodeBandStatus, decodeBandVitals,
  decodeBeltFhr, decodeBeltStatus, decodeStored,
} from '../src/lib/packets.js';
import { exposureLeft, planBeltCheck } from '../src/sim/deviceSim.js';
import { ADAPTER_METHODS, CHANNEL, createDeviceLink } from '../src/lib/deviceLink.js';

const of = (events, channel, device) => events.filter((e) => e.channel === channel && (!device || e.device === device));
const beltStatuses = (events) => of(events, CHANNEL.STATUS, 'belt').map((e) => decodeBeltStatus(e.data));
const windows = (events) => of(events, CHANNEL.FHR, 'belt').map((e) => decodeBeltFhr(e.data));

function connected(options) {
  const sim = makeSim(options);
  sim.link.connect(BELT);
  sim.link.connect(BAND);
  sim.events.length = 0;
  return sim;
}

test('the adapter contract is enforced: a link needs all five methods', () => {
  assert.deepEqual(ADAPTER_METHODS, ['connect', 'disconnect', 'isConnected', 'write', 'onNotification']);
  assert.throws(() => createDeviceLink({ connect() {} }), TypeError);
});

test('connecting wakes the device, announces the link and sends its status and battery', () => {
  const sim = makeSim();
  sim.link.connect(BELT);
  assert.equal(sim.link.isConnected(BELT), true);
  assert.deepEqual(sim.events.map((e) => e.channel), [CHANNEL.CONNECTION, CHANNEL.STATUS, CHANNEL.BATTERY]);
  assert.equal(sim.events[0].connected, true);
  const status = decodeBeltStatus(sim.events[1].data);
  assert.equal(status.state, BELT_STATE.ACTIVE_IDLE);
  assert.equal(status.battery, 76);
  assert.equal(status.exposureLeft, 360);
  assert.equal(status.timeSynced, true);
  assert.deepEqual([...sim.events[2].data], [76]);
  assert.equal(sim.link.connect('NLB-unknown'), false);
});

test('a normal check: states in order, 30 windows, one summary, sequence numbers carry on, exposure is used', () => {
  const sim = connected();
  sim.link.startCheck(BELT, 120);
  sim.sched.flush();

  const states = beltStatuses(sim.events).map((s) => s.state);
  assert.deepEqual(states, [BELT_STATE.SELF_TEST, BELT_STATE.CONTACT_CHECK, BELT_STATE.ACQUIRE, BELT_STATE.ACTIVE_IDLE]);
  const packets = windows(sim.events);
  const live = packets.filter((p) => p.type === FHR_TYPE.WINDOW);
  const summary = packets.filter((p) => p.type === FHR_TYPE.SUMMARY);
  assert.equal(live.length, 30);
  assert.equal(summary.length, 1);
  assert.deepEqual(live.map((p) => p.seq), Array.from({ length: 30 }, (_, i) => 100 + i));
  assert.equal(summary[0].seq, 130);
  assert.ok(live.every((p) => p.sessionId === 6), 'one session id for the check');
  assert.ok(live.every((p) => p.fhr >= 140 && p.fhr <= 148 && p.flags === 0), 'a normal check reads 140 to 148');
  assert.equal(summary[0].confidence, 100);
  assert.ok(summary[0].fhr >= 140 && summary[0].fhr <= 148);
  // four seconds apart
  for (let i = 1; i < live.length; i += 1) assert.equal(live[i].tEpoch - live[i - 1].tEpoch, 4);

  const hw = sim.world.get(BELT);
  assert.equal(hw.next_seq, 131);
  assert.equal(hw.session_counter, 6);
  assert.equal(hw.ring.length, 31);
  assert.equal(hw.state, 'ACTIVE_IDLE');
  assert.equal(exposureLeft(hw, NOW), 240);
  assert.equal(hw.signal, null);
});

test('a check needs about 122 seconds of device time; Quick shortens it, not the data', () => {
  const sim = connected();
  sim.link.startCheck(BELT, 120);
  sim.sched.advance(60000);
  assert.ok(windows(sim.events).length > 10 && windows(sim.events).length < 20, 'about half way after a minute');
  sim.sched.advance(70000);
  assert.equal(windows(sim.events).length, 31);
});

test('contact: poor contact shows incomplete pads for the delay, then good contact; a normal check never shows poor contact', () => {
  const sim = connected();
  sim.control.setSignal(BELT, { contact: 'poor', contactDelayS: 6 });
  sim.link.startCheck(BELT, 120);
  sim.sched.flush();
  const contact = beltStatuses(sim.events).filter((s) => s.state === BELT_STATE.CONTACT_CHECK);
  assert.equal(contact.length, 1);
  assert.deepEqual(contact[0].pads, [true, false, false]);
  assert.deepEqual(beltStatuses(sim.events).find((s) => s.state === BELT_STATE.ACQUIRE).pads, [true, true, true]);

  const normal = connected();
  normal.link.startCheck(BELT, 120);
  normal.sched.flush();
  const pads = beltStatuses(normal.events).find((s) => s.state === BELT_STATE.CONTACT_CHECK).pads;
  assert.ok(pads.filter(Boolean).length >= 2);
});

test('no contact within the timeout ends the check with result code 5 and uses no exposure', () => {
  const sim = connected();
  sim.control.setSignal(BELT, { contact: 'none' });
  sim.link.startCheck(BELT, 120);
  sim.sched.flush();
  const all = windows(sim.events);
  assert.equal(all.filter((p) => p.type === FHR_TYPE.WINDOW).length, 0);
  assert.equal(all[0].type, FHR_TYPE.SUMMARY);
  assert.equal(all[0].poorContact, true);
  assert.equal(all[0].fhr, 0);
  const last = beltStatuses(sim.events).at(-1);
  assert.equal(last.resultCode, RESULT.NO_CONTACT);
  assert.equal(exposureLeft(sim.world.get(BELT), NOW), 360);
});

test('motion windows carry the motion flag and no rate; maternal-looking windows copy the band rate', () => {
  const sim = connected();
  sim.control.setSignal(BELT, { maternalHr: 84, events: [{ from: 6, to: 9, kind: 'motion' }, { from: 12, to: 14, kind: 'maternal' }] });
  sim.link.startCheck(BELT, 120);
  sim.sched.flush();
  const live = windows(sim.events).filter((p) => p.type === FHR_TYPE.WINDOW);
  for (const index of [5, 6, 7, 8]) {
    assert.equal(live[index].motion, true);
    assert.equal(live[index].fhr, 0);
  }
  assert.equal(live[4].motion, false);
  for (const index of [11, 12, 13]) {
    // a rate near 84 is below the belt's own range, so it only gets the out-of-range flag; the belt cannot tell whose it is
    assert.ok(Math.abs(live[index].fhr - 84) <= 2, 'copies the band rate');
    assert.equal(live[index].flags, FHR_FLAG.OUT_OF_RANGE);
  }
  const summary = windows(sim.events).find((p) => p.type === FHR_TYPE.SUMMARY);
  assert.equal(summary.confidence, 87, '26 of 30 windows are valid for the belt');
});

test('windows outside 110 to 160 carry the out-of-range flag', () => {
  const sim = connected();
  sim.control.setSignal(BELT, { events: [{ from: 9, to: 24, kind: 'fhr', base: 98, jitter: 4 }] });
  sim.link.startCheck(BELT, 120);
  sim.sched.flush();
  const live = windows(sim.events).filter((p) => p.type === FHR_TYPE.WINDOW);
  for (let i = 8; i < 24; i += 1) {
    assert.ok(live[i].fhr >= 94 && live[i].fhr <= 102);
    assert.equal(live[i].outOfRange, true);
  }
  assert.equal(live[7].outOfRange, false);
});

test('exposure interlock: three 120 s checks use the 360 s allowance, the fourth is refused with code 4', () => {
  const sim = connected();
  for (let i = 0; i < 3; i += 1) {
    sim.link.startCheck(BELT, 120);
    sim.sched.flush();
  }
  assert.equal(exposureLeft(sim.world.get(BELT), NOW), 0);
  sim.events.length = 0;
  sim.link.startCheck(BELT, 120);
  const status = beltStatuses(sim.events).at(-1);
  assert.equal(status.resultCode, RESULT.EXPOSURE_CAP);
  assert.equal(status.exposureCapped, true);
  assert.equal(status.exposureLeft, 0);
  assert.equal(sim.sched.size(), 0, 'nothing was started');
  // after the rolling hour the allowance comes back
  const later = exposureLeft(sim.world.get(BELT), NOW + 61 * 60 * 1000);
  assert.equal(later, 360);
});

test('the gear can use up the allowance at once', () => {
  const sim = connected();
  sim.control.fillExposure(BELT);
  sim.events.length = 0;
  sim.link.startCheck(BELT, 120);
  assert.equal(beltStatuses(sim.events).at(-1).resultCode, RESULT.EXPOSURE_CAP);
});

test('refusals: charging (2), battery cutoff (3), busy (1), fault (6); critical battery still measures', () => {
  const run = (overrides, prepare) => {
    const sim = connected({ hardware: [beltHardware(overrides), bandHardware()] });
    prepare?.(sim);
    sim.events.length = 0;
    sim.link.startCheck(BELT, 120);
    return beltStatuses(sim.events).at(-1);
  };
  assert.equal(run({ charging: true, state: 'CHARGING' }).resultCode, RESULT.CHARGING);
  assert.equal(run({ battery: 4 }).resultCode, RESULT.LOW_BATTERY);
  assert.equal(run({ battery: 5 }).resultCode, RESULT.LOW_BATTERY);
  assert.equal(run({ battery: 8 }).resultCode, RESULT.OK);
  assert.equal(run({ battery: 18 }).resultCode, RESULT.OK);
  assert.equal(run({ fault: 6 }).resultCode, RESULT.FAULT);
  const busy = run({}, (sim) => sim.link.startCheck(BELT, 120));
  assert.equal(busy.resultCode, RESULT.BUSY);
});

test('charging on stops new checks and reports the charging flag; off brings the device back to idle', () => {
  const sim = connected();
  sim.control.setCharging(BELT, true);
  const on = beltStatuses(sim.events).at(-1);
  assert.equal(on.charging, true);
  assert.equal(on.state, BELT_STATE.CHARGING);
  sim.control.setCharging(BELT, false);
  const off = beltStatuses(sim.events).at(-1);
  assert.equal(off.charging, false);
  assert.equal(off.state, BELT_STATE.ACTIVE_IDLE);
});

test('battery changes notify the level and set the low-battery flag from 20% down', () => {
  const sim = connected();
  sim.control.setBattery(BELT, 18);
  assert.deepEqual([...of(sim.events, CHANNEL.BATTERY, 'belt').at(-1).data], [18]);
  assert.equal(beltStatuses(sim.events).at(-1).lowBattery, true);
  sim.control.setBattery(BELT, 80);
  assert.equal(beltStatuses(sim.events).at(-1).lowBattery, false);
});

test('commands only reach a connected device', () => {
  const sim = makeSim();
  sim.link.startCheck(BELT, 120);
  assert.equal(sim.events.length, 0);
  assert.equal(sim.sched.size(), 0);
});

test('a time sync sets the synced flag; windows made before it carry the clock flag', () => {
  const sim = connected({ hardware: [beltHardware({ clock_synced: false }), bandHardware()] });
  sim.link.startCheck(BELT, 40);
  sim.sched.flush();
  assert.ok(windows(sim.events).every((p) => p.clockUnsynced));
  sim.events.length = 0;
  sim.link.timeSync(BELT, Math.floor(NOW / 1000));
  assert.equal(beltStatuses(sim.events).at(-1).timeSynced, true);
  assert.equal(sim.world.get(BELT).clock_synced, true);
});

test('stop ends a check early, back to idle', () => {
  const sim = connected();
  sim.link.startCheck(BELT, 120);
  sim.sched.advance(20000);
  sim.link.stop(BELT);
  sim.sched.flush();
  assert.equal(sim.world.get(BELT).state, 'ACTIVE_IDLE');
  assert.ok(windows(sim.events).length < 10);
  assert.equal(windows(sim.events).filter((p) => p.type === FHR_TYPE.SUMMARY).length, 0);
});

test('a check carries on and is stored when the phone drops; nothing is sent while apart', () => {
  const sim = connected();
  sim.link.startCheck(BELT, 40);
  sim.sched.advance(10000);
  const before = windows(sim.events).length;
  sim.link.disconnect(BELT);
  sim.sched.flush();
  assert.equal(windows(sim.events).length, before, 'nothing live after the drop');
  assert.equal(sim.world.get(BELT).ring.length, 11, '10 windows and the summary are kept');
  assert.equal(sim.world.get(BELT).state, 'ACTIVE_IDLE');
});

test('store and forward: checks made while apart replay with the 0x01 prefix, then the end packet; acknowledging empties the buffer', () => {
  const sim = makeSim();
  for (const minutesAgo of [170, 110, 50]) {
    sim.control.storeCheck({ beltSerial: BELT, bandSerial: BAND, atMs: NOW - minutesAgo * 60000 });
  }
  const hw = sim.world.get(BELT);
  assert.equal(hw.ring.length, 93);
  assert.equal(hw.next_seq, 100 + 93);
  assert.equal(sim.world.get(BAND).ring.length, 3);

  sim.link.connect(BELT);
  sim.events.length = 0;
  sim.link.requestStored(BELT, 99);
  sim.sched.flush();
  const stored = of(sim.events, CHANNEL.STORED, 'belt').map((e) => decodeStored(e.data, 'belt'));
  assert.equal(stored.length, 94);
  assert.equal(stored.at(-1).kind, 'end');
  assert.equal(stored.at(-1).lastSeq, 192);
  const records = stored.filter((s) => s.kind === 'record');
  assert.ok(records.every((r) => r.packetType === 'fhr'));
  assert.deepEqual(records.map((r) => r.packet.seq), Array.from({ length: 93 }, (_, i) => 100 + i));
  assert.equal(records.filter((r) => r.packet.type === FHR_TYPE.SUMMARY).length, 3);

  sim.link.ackStored(BELT, 192);
  assert.equal(sim.world.get(BELT).ring.length, 0);
  sim.events.length = 0;
  sim.link.requestStored(BELT, 192);
  sim.sched.flush();
  assert.deepEqual(of(sim.events, CHANNEL.STORED).map((e) => decodeStored(e.data, 'belt')), [{ kind: 'end', lastSeq: 192 }]);
});

test('a replay resumes after the highest sequence the app holds', () => {
  const sim = makeSim();
  sim.control.storeCheck({ beltSerial: BELT, atMs: NOW - 3600000, durationS: 40 });
  sim.link.connect(BELT);
  sim.events.length = 0;
  sim.link.requestStored(BELT, 104);
  sim.sched.flush();
  const records = of(sim.events, CHANNEL.STORED).map((e) => decodeStored(e.data, 'belt')).filter((s) => s.kind === 'record');
  assert.equal(records[0].packet.seq, 105);
});

test('band burst: vitals after 30 seconds with the sensed values', () => {
  const sim = connected();
  sim.control.setSignal(BAND, { hr: 118, spo2: 92, tempC: 38.4 });
  sim.link.startCheck(BAND, 30);
  const status = decodeBandStatus(of(sim.events, CHANNEL.STATUS, 'band').at(-1).data);
  assert.equal(status.resultCode, RESULT.OK);
  sim.sched.advance(29000);
  assert.equal(of(sim.events, CHANNEL.VITALS).length, 0);
  sim.sched.advance(2000);
  const vitals = decodeBandVitals(of(sim.events, CHANNEL.VITALS)[0].data);
  assert.deepEqual([vitals.hr, vitals.spo2, vitals.skinTempC, vitals.seq], [118, 92, 38.4, 40]);
  assert.equal(sim.world.get(BAND).next_seq, 41);
  assert.equal(sim.world.get(BAND).signal, null);
  assert.equal(sim.world.get(BAND).ring.length, 1);
});

test('band refusals: charging and cutoff', () => {
  const charging = connected({ hardware: [beltHardware(), bandHardware({ charging: true, state: 'CHARGING' })] });
  charging.link.startCheck(BAND, 30);
  assert.equal(decodeBandStatus(of(charging.events, CHANNEL.STATUS, 'band').at(-1).data).resultCode, RESULT.CHARGING);
  const flat = connected({ hardware: [beltHardware(), bandHardware({ battery: 3 })] });
  flat.link.startCheck(BAND, 30);
  assert.equal(decodeBandStatus(of(flat.events, CHANNEL.STATUS, 'band').at(-1).data).resultCode, RESULT.LOW_BATTERY);
});

test('SOS while connected repeats every 10 seconds until acknowledged', () => {
  const sim = connected();
  const seq = sim.control.pressSos(BAND);
  assert.equal(seq, 40);
  assert.equal(of(sim.events, CHANNEL.SOS).length, 1);
  assert.equal(decodeBandSos(of(sim.events, CHANNEL.SOS)[0].data).pressed, true);
  sim.sched.advance(25000);
  assert.equal(of(sim.events, CHANNEL.SOS).length, 3, 'now, +10 s, +20 s');
  assert.ok(of(sim.events, CHANNEL.SOS).every((e) => decodeBandSos(e.data).seq === 40));
  sim.link.ackSos(BAND, 40);
  sim.sched.advance(60000);
  assert.equal(of(sim.events, CHANNEL.SOS).length, 3, 'the repeats stop');
  assert.equal(sim.world.get(BAND).sos.acked, true);
  assert.equal(sim.world.get(BAND).ring.length, 0, 'a delivered SOS is not stored');
});

test('SOS repeats do not block a flush, and a second hold sends a cancel and stops the repeats', () => {
  const sim = connected();
  sim.control.pressSos(BAND);
  sim.sched.flush(); // must return
  assert.equal(of(sim.events, CHANNEL.SOS).length, 1);
  sim.control.cancelSos(BAND);
  const packets = of(sim.events, CHANNEL.SOS).map((e) => decodeBandSos(e.data));
  assert.equal(packets.at(-1).cancelled, true);
  assert.equal(packets.at(-1).seq, 41);
  sim.sched.advance(60000);
  assert.equal(of(sim.events, CHANNEL.SOS).length, 2);
  assert.equal(sim.world.get(BAND).sos, null);
});

test('SOS while apart is stored, then replayed as a stored record when the phone returns', () => {
  const sim = makeSim();
  sim.control.pressSos(BAND);
  assert.equal(sim.events.length, 0);
  assert.equal(sim.world.get(BAND).ring.length, 1);
  assert.equal(sim.world.get(BAND).state, 'SOS', 'the band keeps its local indication');
  sim.link.connect(BAND);
  sim.events.length = 0;
  sim.link.requestStored(BAND, 39);
  sim.sched.flush();
  const stored = of(sim.events, CHANNEL.STORED).map((e) => decodeStored(e.data, 'band'));
  assert.equal(stored[0].packetType, 'sos');
  assert.equal(stored[0].packet.pressed, true);
  assert.equal(stored[1].kind, 'end');
});

test('the heartbeat sends status and battery for connected devices only', () => {
  const sim = makeSim();
  sim.link.connect(BELT);
  sim.events.length = 0;
  sim.control.heartbeat();
  assert.deepEqual(sim.events.map((e) => `${e.device}:${e.channel}`), ['belt:status', 'belt:battery']);
});

test('settling after a reload puts a half-finished run back to idle', () => {
  const sim = connected();
  sim.link.startCheck(BELT, 120);
  sim.sched.advance(10000);
  assert.equal(sim.world.get(BELT).state, 'ACQUIRE');
  sim.sched.cancelAll(); // the timers are gone after a reload
  sim.control.settle();
  assert.equal(sim.world.get(BELT).state, 'ACTIVE_IDLE');
  assert.equal(sim.world.get(BELT).run_token, null);
  sim.events.length = 0;
  sim.link.startCheck(BELT, 40);
  assert.equal(beltStatuses(sim.events).at(-1).resultCode, RESULT.OK, 'a new check can start');
});

test('the plan of a check is pure: the same inputs give the same bytes', () => {
  const args = { serial: BELT, firstSeq: 7, sessionId: 3, startMs: NOW, durationS: 40 };
  const a = planBeltCheck(args);
  const b = planBeltCheck(args);
  assert.deepEqual(a.steps.map((s) => s.bytes && Array.from(s.bytes)), b.steps.map((s) => s.bytes && Array.from(s.bytes)));
  assert.equal(a.nextSeq, 7 + 10 + 1);
  assert.equal(a.exposureS, 40);
  const different = planBeltCheck({ ...args, firstSeq: 8 });
  assert.notDeepEqual(a.steps.filter((s) => s.bytes).map((s) => Array.from(s.bytes).slice(11, 14)), different.steps.filter((s) => s.bytes).map((s) => Array.from(s.bytes).slice(11, 14)));
});

test('status flags describe the device honestly', () => {
  const sim = connected({ hardware: [beltHardware({ battery: 18, clock_synced: false }), bandHardware()] });
  sim.link.identify(BELT);
  const status = beltStatuses(sim.events).at(-1);
  assert.equal(status.flags & STATUS_FLAG.LOW_BATTERY, STATUS_FLAG.LOW_BATTERY);
  assert.equal(status.timeSynced, false);
  assert.equal(status.fault, false);
  assert.equal(FHR_FLAG.OUT_OF_RANGE, 16);
});
