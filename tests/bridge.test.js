import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAND, BELT, MARICEL, NOW, makeApp } from './helpers.js';
import { patientRecord, checkSessions, fetalReadings, alertsOf, viewerOf } from '../src/store/selectors.js';
import { dedupeKey } from '../src/lib/offlineQueue.js';
import { RESULT } from '../src/lib/packets.js';

const SECOND = 1000;
const maricelBelt = 'NLB-2026-0412';
const maricelBand = 'NLW-2026-0412';
const setBeltSignal = (app, signal) => app.control.setSignal(maricelBelt, signal);
const setBandSignal = (app, signal) => app.control.setSignal(maricelBand, signal);
const lastSession = (app, patientId = MARICEL) => app.sessions(patientId).at(-1);
const profile = (app, id) => app.db().profiles.find((p) => p.id === id);

test('a normal check: saved on the phone, uploaded a moment later, verified by the band, no alert', () => {
  const app = makeApp();
  const before = app.sessions().length;
  const started = app.bridge.startCheck(MARICEL);
  assert.equal(started.started, true);
  assert.equal(app.state().live.check.phase, 'starting');
  assert.equal(app.bridge.isChecking(MARICEL), true);

  app.sched.advance(1000);
  assert.equal(app.state().live.check.phase, 'contact');
  app.sched.advance(60 * SECOND);
  const live = app.state().live.check;
  assert.equal(live.phase, 'acquiring');
  assert.ok(live.windows > 10 && live.windows < 20, `windows so far: ${live.windows}`);
  assert.equal(live.total, 30);

  app.sched.advance(61.5 * SECOND); // 122.5 s: the summary arrived at about 122.1 s, the upload follows 0.6 s later
  assert.equal(app.state().live.check.phase, 'complete');
  assert.equal(app.sessions().length, before + 1);
  const saved = lastSession(app);
  assert.equal(saved.syncState, 'queued', 'on the phone first');
  assert.equal(app.state().live.check.session_id, saved.id);

  app.sched.flush(); // the upload
  const uploaded = lastSession(app);
  assert.equal(uploaded.syncState, 'synced');
  assert.equal(uploaded.source, 'on_demand');
  assert.equal(uploaded.status, 'completed');
  assert.equal(uploaded.belt_serial, maricelBelt);
  assert.equal(uploaded.band_serial, maricelBand);
  assert.ok(uploaded.ended_at <= NOW, 'never in the future');
  assert.ok(uploaded.started_at < uploaded.ended_at);
  assert.equal(uploaded.summary.unverified, false);
  assert.equal(uploaded.summary.hr_bpm, 84);
  assert.equal(uploaded.summary.spo2_pct, 98);
  assert.equal(uploaded.summary.skin_temp_c, 36.7);
  assert.equal(uploaded.summary.valid_windows, 30);
  assert.ok(uploaded.summary.fhr_bpm >= 140 && uploaded.summary.fhr_bpm <= 148);

  const windows = app.db().fetal_readings.filter((r) => r.session_id === uploaded.id);
  assert.equal(windows.length, 30);
  assert.ok(windows.every((w) => w.syncState === 'synced' && w.maternal_match === false));
  assert.ok(windows.every((w) => w.taken_at <= NOW));
  assert.equal(app.db().maternal_readings.filter((r) => r.session_id === uploaded.id).length, 1);
  assert.equal(app.alerts().length, 0);
  assert.equal(app.bridge.isChecking(MARICEL), false);
});

test('the devices keep nothing the app already holds, and the sequence numbers move on', () => {
  const app = makeApp();
  const lastSeq = app.db().devices.find((d) => d.serial === maricelBelt).last_seq;
  app.bridge.startCheck(MARICEL);
  app.sched.flush();
  assert.equal(app.world.get(maricelBelt).ring.length, 0);
  assert.equal(app.world.get(maricelBand).ring.length, 0);
  assert.equal(app.db().devices.find((d) => d.serial === maricelBelt).last_seq, lastSeq + 31);
  assert.equal(app.db().devices.find((d) => d.serial === maricelBand).last_seq, app.world.get(maricelBand).next_seq - 1);
});

test('adjust belt: the prompt shows while contact is incomplete and clears when it is good, then the check completes', () => {
  const app = makeApp();
  setBeltSignal(app, { contact: 'poor', contactDelayS: 6 });
  app.bridge.startCheck(MARICEL);
  app.sched.advance(2000);
  assert.equal(app.state().live.check.phase, 'contact');
  assert.equal(app.state().live.check.prompt, 'adjust_belt');
  app.sched.advance(7000);
  assert.equal(app.state().live.check.prompt, null);
  assert.equal(app.state().live.check.phase, 'acquiring');
  app.sched.flush();
  assert.equal(app.state().live.check.phase, 'complete');
  assert.equal(lastSession(app).summary.valid_windows, 30);
});

test('rest: motion windows raise the rest prompt, which clears; those windows do not count', () => {
  const app = makeApp();
  setBeltSignal(app, { events: [{ from: 6, to: 9, kind: 'motion' }] });
  app.bridge.startCheck(MARICEL);
  app.sched.advance(32 * SECOND); // windows arrive at 1.8 s + 4 s each: window 8 is at 33.8 s
  assert.equal(app.state().live.check.prompt, 'rest');
  app.sched.advance(10 * SECOND);
  assert.equal(app.state().live.check.prompt, null);
  app.sched.flush();
  const saved = lastSession(app);
  assert.equal(saved.summary.valid_windows, 26);
  assert.equal(saved.summary.confidence, 87);
  assert.equal(app.alerts().length, 0);
});

test('no band: the belt completes and the FHR is unverified, not rejected (PAT-H-05)', () => {
  const app = makeApp();
  app.bridge.startCheck(MARICEL, { useBand: false });
  app.sched.flush();
  const saved = lastSession(app);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.band_serial, null);
  assert.equal(saved.summary.unverified, true);
  assert.equal(saved.summary.hr_bpm, null);
  assert.ok(saved.summary.fhr_bpm >= 140);
  assert.equal(app.db().maternal_readings.filter((r) => r.session_id === saved.id).length, 0);
});

test('a band that refuses (charging) leaves the check running, unverified', () => {
  const app = makeApp();
  app.control.setCharging(maricelBand, true);
  assert.equal(app.bridge.startCheck(MARICEL).started, true);
  app.sched.flush();
  const saved = lastSession(app);
  assert.equal(saved.band_serial, null);
  assert.equal(saved.summary.unverified, true);
});

test('maternal signal: windows near the band rate and time are flagged and left out; no alert follows', () => {
  const app = makeApp();
  setBeltSignal(app, { maternalHr: 84, events: [{ from: 6, to: 9, kind: 'maternal' }] });
  app.bridge.startCheck(MARICEL);
  app.sched.flush();
  const saved = lastSession(app);
  const windows = app.db().fetal_readings.filter((r) => r.session_id === saved.id).sort((a, b) => a.device_seq - b.device_seq);
  const flagged = windows.filter((w) => w.maternal_match);
  assert.ok(flagged.length >= 3, `flagged ${flagged.length}`);
  assert.ok(flagged.every((w) => Math.abs(w.fhr_bpm - 84) <= 5));
  assert.equal(saved.summary.maternal_excluded, flagged.length);
  assert.equal(saved.summary.valid_windows, 30 - flagged.length);
  assert.ok(saved.summary.fhr_bpm >= 140, 'the rate comes from the real windows');
  assert.equal(app.alerts().length, 0);
});

test('FHR out of range: the alert reaches the barangay accounts and the patient, not the super accounts', () => {
  const app = makeApp();
  setBeltSignal(app, { events: [{ from: 9, to: 24, kind: 'fhr', base: 98, jitter: 4 }] });
  app.bridge.startCheck(MARICEL);
  app.sched.flush();
  const alerts = app.alerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'fhr_out_of_range');
  assert.equal(alerts[0].severity, 'critical');
  assert.equal(alerts[0].status, 'new');
  assert.equal(alerts[0].reading_ref, lastSession(app).id);
  assert.equal(alerts[0].payload.direction, 'low');
  const got = (id) => app.inbox(id).filter((n) => n.payload.alert_id === alerts[0].id);
  assert.equal(got('lourdes-magpantay').length, 1);
  assert.equal(got('jocelyn-landicho').length, 1);
  assert.equal(got(MARICEL)[0].type, 'alert_notice');
  assert.equal(got('rowena-macaraig').length, 0);
  assert.equal(got('nora-marasigan').length, 0, 'another barangay is not told');
});

test('maternal vitals: SpO2 92 raises the alert; heart rate 118 and temperature 38.4 do too', () => {
  const cases = [
    [{ spo2: 92 }, 'spo2'],
    [{ hr: 118 }, 'heart_rate'],
    [{ tempC: 38.4 }, 'skin_temperature'],
  ];
  for (const [signal, metric] of cases) {
    const app = makeApp();
    setBandSignal(app, signal);
    app.bridge.startCheck(MARICEL);
    app.sched.flush();
    const alerts = app.alerts();
    assert.equal(alerts.length, 1, metric);
    assert.equal(alerts[0].type, 'maternal_vitals');
    assert.equal(alerts[0].payload.metrics[0].metric, metric);
  }
});

test('refusals come back as reasons and nothing is saved: exposure cap, charging, battery cutoff', () => {
  const run = (prepare) => {
    const app = makeApp();
    prepare(app);
    const before = app.sessions().length;
    const result = app.bridge.startCheck(MARICEL);
    assert.equal(app.sessions().length, before);
    assert.equal(app.bridge.isChecking(MARICEL), false);
    return { result, live: app.state().live.check };
  };
  let outcome = run((app) => app.control.fillExposure(maricelBelt));
  assert.deepEqual([outcome.result.started, outcome.result.reason, outcome.live.phase], [false, 'exposure_cap', 'failed']);
  outcome = run((app) => app.control.setCharging(maricelBelt, true));
  assert.equal(outcome.result.reason, 'charging');
  outcome = run((app) => app.control.setBattery(maricelBelt, 4));
  assert.equal(outcome.result.reason, 'low_battery');
});

test('no contact ends the check with a reason and saves nothing', () => {
  const app = makeApp();
  setBeltSignal(app, { contact: 'none' });
  const before = app.sessions().length;
  app.bridge.startCheck(MARICEL);
  app.sched.flush();
  assert.equal(app.sessions().length, before);
  assert.equal(app.state().live.check.phase, 'failed');
  assert.equal(app.state().live.check.reason, 'no_contact');
});

test('a check cannot start twice, and stop ends it', () => {
  const app = makeApp();
  app.bridge.startCheck(MARICEL);
  assert.deepEqual(app.bridge.startCheck(MARICEL), { started: false, reason: 'busy' });
  app.sched.advance(10000);
  app.bridge.stopCheck(MARICEL);
  assert.equal(app.state().live.check.reason, 'stopped');
  app.sched.flush();
  assert.equal(app.bridge.isChecking(MARICEL), false);
  assert.equal(lastSession(app).source !== undefined, true);
});

test('a patient without devices has nothing to start', () => {
  const app = makeApp();
  assert.deepEqual(app.bridge.startCheck('shiela-marie-aguila'), { started: false, reason: 'no_belt' });
});

test('three checks in an hour use the exposure allowance; the fourth is refused', () => {
  const app = makeApp();
  for (let i = 0; i < 3; i += 1) {
    assert.equal(app.bridge.startCheck(MARICEL).started, true, `check ${i + 1}`);
    app.sched.flush();
  }
  assert.equal(app.bridge.startCheck(MARICEL).reason, 'exposure_cap');
});

test('devices disconnected: the check connects them first', () => {
  const app = makeApp();
  app.link.disconnect(maricelBelt);
  app.link.disconnect(maricelBand);
  assert.equal(app.db().devices.find((d) => d.serial === maricelBelt).link_state, 'disconnected');
  assert.equal(app.bridge.startCheck(MARICEL).started, true);
  app.sched.flush();
  assert.equal(app.db().devices.find((d) => d.serial === maricelBelt).link_state, 'connected');
  assert.equal(lastSession(app).syncState, 'synced');
});

test('device records follow the status packets: battery, charging, last seen and a log entry on change', () => {
  const app = makeApp();
  const logBefore = app.db().device_status_log.length;
  app.setClock(NOW + 5 * 60000);
  app.control.heartbeat();
  let belt = app.db().devices.find((d) => d.serial === maricelBelt);
  assert.equal(belt.last_seen_at, NOW + 5 * 60000);
  assert.equal(belt.battery_pct, 76);
  assert.equal(app.db().device_status_log.length, logBefore, 'no change, no log entry');

  app.control.setBattery(maricelBelt, 61);
  belt = app.db().devices.find((d) => d.serial === maricelBelt);
  assert.equal(belt.battery_pct, 61);
  assert.equal(app.db().device_status_log.length, logBefore + 1);
  app.control.setCharging(maricelBelt, true);
  assert.equal(app.db().devices.find((d) => d.serial === maricelBelt).charging, true);
});

test('battery low tells the patient once; critical raises the alert for the barangay and the patient', () => {
  const app = makeApp();
  app.control.setBattery(maricelBelt, 18);
  const low = app.inbox(MARICEL).filter((n) => n.type === 'battery_low');
  assert.equal(low.length, 1);
  assert.deepEqual(low[0].payload, { serial: maricelBelt, device: 'belt', pct: 18 });
  assert.equal(app.alerts().length, 0);
  app.control.setBattery(maricelBelt, 17);
  assert.equal(app.inbox(MARICEL).filter((n) => n.type === 'battery_low').length, 1, 'not again while it stays low');

  app.control.setBattery(maricelBelt, 8);
  const alerts = app.alerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'battery_critical');
  assert.equal(alerts[0].payload.level, 'critical');
  assert.equal(app.inbox('lourdes-magpantay').filter((n) => n.payload.alert_id === alerts[0].id).length, 1);

  app.control.setBattery(maricelBelt, 4); // cutoff: the same open alert absorbs it
  assert.equal(app.alerts().length, 1);
  assert.equal(app.alerts()[0].merged_count, 1);
});

test('charging at critical raises no alert', () => {
  const app = makeApp();
  app.control.setCharging(maricelBelt, true);
  app.control.setBattery(maricelBelt, 8);
  assert.equal(app.alerts().length, 0);
});

// ---------- Offline ----------

test('offline: the check is kept on the phone, hidden from providers, and no alert exists until reconnection', () => {
  const app = makeApp();
  app.core.setConnection('offline');
  setBeltSignal(app, { events: [{ from: 9, to: 24, kind: 'fhr', base: 98, jitter: 4 }] });
  app.bridge.startCheck(MARICEL);
  app.sched.flush();
  const saved = lastSession(app);
  assert.equal(saved.syncState, 'queued');
  assert.ok(app.db().fetal_readings.filter((r) => r.session_id === saved.id).every((r) => r.syncState === 'queued'));
  assert.equal(app.alerts().length, 0);

  const patient = profile(app, MARICEL);
  const lourdes = profile(app, 'lourdes-magpantay');
  const state = app.state();
  assert.ok(checkSessions(state, patient, MARICEL).some((s) => s.id === saved.id), 'the patient sees her own');
  assert.ok(!checkSessions(state, lourdes, MARICEL).some((s) => s.id === saved.id), 'her barangay account does not');
  assert.equal(fetalReadings(state, lourdes, saved.id).length, 0);
  assert.equal(fetalReadings(state, patient, saved.id).length, 30);
});

test('reconnecting uploads in order, removes nothing twice and raises the alert then', () => {
  const app = makeApp();
  app.core.setConnection('offline');
  setBeltSignal(app, { events: [{ from: 9, to: 24, kind: 'fhr', base: 98, jitter: 4 }] });
  app.bridge.startCheck(MARICEL);
  app.sched.flush();
  app.bridge.startCheck(MARICEL);
  app.sched.flush();
  assert.equal(app.sessions().filter((s) => s.syncState === 'queued').length, 2);

  const summary = app.core.setConnection('online');
  assert.equal(summary.checks, 2);
  assert.equal(app.sessions().filter((s) => s.syncState === 'queued').length, 0);
  assert.equal(app.db().fetal_readings.filter((r) => r.syncState === 'queued').length, 0);
  const alerts = app.alerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'fhr_out_of_range');

  const again = app.core.flushQueue();
  assert.equal(again.checks, 0);
  assert.equal(app.alerts().length, 1);
  const keys = app.db().fetal_readings.map((r) => dedupeKey(r, app.db().check_sessions.find((s) => s.id === r.session_id).belt_serial));
  assert.equal(new Set(keys).size, keys.length, 'no duplicate (serial, sequence)');
});

// ---------- Checks while apart ----------

function apart(app) {
  app.link.disconnect(maricelBelt);
  app.link.disconnect(maricelBand);
  for (const minutesAgo of [170, 110, 50]) {
    app.control.storeCheck({ beltSerial: maricelBelt, bandSerial: maricelBand, atMs: NOW - minutesAgo * 60000 });
  }
}

test('checks while apart: three stored checks sync on reconnection with their band readings and no duplicates', () => {
  const app = makeApp();
  const before = app.sessions().length;
  apart(app);
  assert.equal(app.world.get(maricelBelt).ring.length, 93);
  assert.equal(app.sessions().length, before);

  app.link.connect(maricelBelt);
  app.link.connect(maricelBand);
  app.sched.flush();
  const added = app.sessions().slice(before);
  const stored = app.sessions().filter((s) => s.source === 'stored');
  assert.equal(stored.length, 3);
  assert.ok(stored.every((s) => s.syncState === 'synced' && s.status === 'completed'));
  assert.ok(stored.every((s) => s.summary.unverified === false && s.summary.hr_bpm === 84), 'paired with the band readings');
  assert.deepEqual(stored.map((s) => Math.round((NOW - s.started_at) / 60000)).sort((a, b) => b - a).map((m) => m > 40), [true, true, true]);
  assert.ok(stored.every((s) => s.ended_at <= NOW));
  assert.equal(added.length >= 3, true);
  assert.equal(app.world.get(maricelBelt).ring.length, 0, 'acknowledged');
  assert.equal(app.world.get(maricelBand).ring.length, 0);
  assert.equal(app.db().devices.find((d) => d.serial === maricelBelt).last_seq, app.world.get(maricelBelt).next_seq - 1);
  assert.equal(app.alerts().length, 0);

  // reconnecting again brings nothing new
  app.link.disconnect(maricelBelt);
  app.link.connect(maricelBelt);
  app.sched.flush();
  assert.equal(app.sessions().filter((s) => s.source === 'stored').length, 3);
});

test('a lost acknowledgement replays the same records and still no duplicates appear', () => {
  const app = makeApp();
  const seq = app.db().devices.find((d) => d.serial === maricelBelt).last_seq;
  apart(app);
  app.link.connect(maricelBelt);
  app.link.connect(maricelBand);
  app.sched.flush();
  assert.equal(app.sessions().filter((s) => s.source === 'stored').length, 3);
  // the device "lost" the acknowledgement: put the records back and ask again from the start
  app.control.storeCheck({ beltSerial: maricelBelt, atMs: NOW - 170 * 60000 });
  const ring = app.world.get(maricelBelt).ring;
  app.world.patch(maricelBelt, { ring: ring.map((r, i) => ({ ...r, seq: seq + 1 + i })), next_seq: seq + 1 + ring.length });
  app.link.requestStored(maricelBelt, seq);
  app.sched.flush();
  const stored = app.sessions().filter((s) => s.source === 'stored');
  assert.equal(stored.length, 4, 'the new one counts once');
  const keys = app.db().fetal_readings.filter((r) => stored.some((s) => s.id === r.session_id)).map((r) => `${r.session_id}:${r.device_seq}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('offline while apart: stored checks wait on the phone and sync with the connection', () => {
  const app = makeApp();
  apart(app);
  app.core.setConnection('offline');
  app.link.connect(maricelBelt);
  app.link.connect(maricelBand);
  app.sched.flush();
  assert.equal(app.sessions().filter((s) => s.source === 'stored' && s.syncState === 'queued').length, 3);
  app.core.setConnection('online');
  assert.equal(app.sessions().filter((s) => s.source === 'stored' && s.syncState === 'synced').length, 3);
});

// ---------- SOS ----------

test('SOS pressed with the app open: the alert reaches the barangay accounts and all super accounts; the band is told', () => {
  const app = makeApp();
  app.control.pressSos(maricelBand);
  const alerts = app.alerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'sos');
  assert.equal(alerts[0].severity, 'critical');
  const got = (id) => app.inbox(id).filter((n) => n.payload.alert_id === alerts[0].id);
  for (const id of ['lourdes-magpantay', 'jocelyn-landicho', 'rowena-macaraig', 'cynthia-dimayuga']) assert.equal(got(id).length, 1, id);
  assert.equal(got('nora-marasigan').length, 0);
  assert.equal(app.world.get(maricelBand).sos.acked, true);
  assert.equal(app.state().live.sos.state, 'sent');
  app.sched.advance(60 * SECOND);
  assert.equal(app.alerts().length, 1, 'the repeats stopped');
  assert.equal(app.alerts()[0].merged_count, 0);
});

test('SOS cancelled: the alert is marked cancelled by the patient and closed', () => {
  const app = makeApp();
  app.control.pressSos(maricelBand);
  app.control.cancelSos(maricelBand);
  const alert = app.alerts()[0];
  assert.equal(alert.status, 'resolved');
  assert.equal(alert.outcome_code, 'cancelled_by_patient');
  assert.equal(alert.resolved_by, MARICEL);
  assert.ok(alert.cancelled_at);
  assert.equal(app.state().live.sos, null);
  assert.ok(app.inbox('lourdes-magpantay').some((n) => n.payload.cancelled === true));
});

test('SOS with the phone offline is not delivered; the band keeps repeating and it goes out when online again', () => {
  const app = makeApp();
  app.core.setConnection('offline');
  app.control.pressSos(maricelBand);
  assert.equal(app.alerts().length, 0);
  assert.equal(app.state().live.sos.state, 'undelivered');
  assert.equal(app.world.get(maricelBand).sos.acked, false);
  app.sched.advance(25 * SECOND);
  assert.equal(app.alerts().length, 0);
  app.core.setConnection('online');
  app.sched.advance(11 * SECOND);
  assert.equal(app.alerts().length, 1);
  assert.equal(app.state().live.sos.state, 'sent');
  assert.equal(app.world.get(maricelBand).sos.acked, true);
});

test('SOS with the band out of range is stored, then relayed when the band returns', () => {
  const app = makeApp();
  app.link.disconnect(maricelBand);
  app.control.pressSos(maricelBand);
  assert.equal(app.alerts().length, 0);
  assert.equal(app.world.get(maricelBand).ring.length, 1);
  assert.equal(app.db().devices.find((d) => d.serial === maricelBand).link_state, 'disconnected');
  app.link.connect(maricelBand);
  app.sched.flush();
  assert.equal(app.alerts().length, 1);
  assert.equal(app.alerts()[0].type, 'sos');
  assert.equal(app.world.get(maricelBand).sos.acked, true);
  assert.equal(app.world.get(maricelBand).ring.length, 0);
  assert.equal(app.inbox('rowena-macaraig').filter((n) => n.payload.alert_id === app.alerts()[0].id).length, 1);
});

test('a second SOS while one is open merges into it', () => {
  const app = makeApp();
  app.control.pressSos(maricelBand);
  app.world.patch(maricelBand, { sos: null });
  app.control.pressSos(maricelBand);
  assert.equal(app.alerts().length, 1);
  assert.equal(app.alerts()[0].merged_count, 1);
});

test('SOS goes to the super accounts when the barangay has no active account', () => {
  const app = makeApp();
  for (const id of ['lourdes-magpantay', 'jocelyn-landicho']) {
    app.store.dispatch({ type: 'ops', ops: [{ op: 'update', table: 'profiles', id, patch: { active: false } }] });
  }
  setBeltSignal(app, { events: [{ from: 9, to: 24, kind: 'fhr', base: 98, jitter: 4 }] });
  app.bridge.startCheck(MARICEL);
  app.sched.flush();
  const alert = app.alerts()[0];
  assert.equal(app.inbox('rowena-macaraig').filter((n) => n.payload.alert_id === alert.id).length, 1);
  assert.equal(app.inbox('cynthia-dimayuga').filter((n) => n.payload.alert_id === alert.id).length, 1);
  assert.equal(app.inbox('lourdes-magpantay').filter((n) => n.payload.alert_id === alert.id).length, 0);
});

test('devices that belong to nobody are ignored', () => {
  const app = makeApp();
  app.link.connect('NLB-2026-0555');
  app.sched.flush();
  assert.equal(app.world.get('NLB-2026-0555').connected, true);
  assert.equal(app.sessions().length, app.sessions().length);
});

test('after a reset of the bridge nothing is in flight', () => {
  const app = makeApp();
  app.bridge.startCheck(MARICEL);
  app.bridge.reset();
  assert.equal(app.bridge.isBusy(), false);
  assert.equal(app.state().live.check, null);
  assert.equal(RESULT.OK, 0);
  assert.equal(BELT, maricelBelt);
  assert.equal(BAND, maricelBand);
  assert.ok(patientRecord(app.state(), viewerOf({ ...app.state(), session: null }) ?? profile(app, 'rowena-macaraig'), MARICEL));
  assert.equal(alertsOf(app.state(), profile(app, 'rowena-macaraig')).length >= 14, true);
});
